"""Regression tests for the findings of TEST_REPORT_v2 (2026-09-24).

Each test names the finding it pins down. The database-level ones run SQL
straight against the schema - the rule must hold for any client, not only
through the API.
"""

from __future__ import annotations

import time
from decimal import Decimal
from typing import Any, cast

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError

from tests.conftest import (
    SEED_PASSWORD,
    arrive_now,
    auth_header,
    login,
    make_booking,
    settle,
    transition,
)


def _c(client: object) -> Any:
    return cast(Any, client)


# ------------------------------------------------------------------ H2 (BR-5)


async def test_h2_moving_booking_dates_onto_a_taken_room_is_refused(client: object) -> None:
    """The overlap rule also holds when dates change on `booking` itself - e.g.
    an UPDATE from pgAdmin - not only when a booking_room row is written."""
    from app.db.session import SessionLocal

    staff = await login(client, "recep01", SEED_PASSWORD)
    first = await make_booking(client, staff, customer_id=4, room_id=40, days_ahead=9000)
    second = await make_booking(client, staff, customer_id=5, room_id=40, days_ahead=9050)
    async with SessionLocal() as s:
        with pytest.raises(DBAPIError, match="double booking"):
            await s.execute(
                text(
                    "UPDATE booking b SET check_in_date = f.check_in_date, "
                    "check_out_date = f.check_out_date "
                    "FROM booking f WHERE f.booking_id = :f AND b.booking_id = :s"
                ),
                {"f": first["booking_id"], "s": second["booking_id"]},
            )
        await s.rollback()


async def test_h2_reviving_a_cancelled_booking_onto_a_taken_room_is_refused(
    client: object,
) -> None:
    from app.db.session import SessionLocal

    staff = await login(client, "recep01", SEED_PASSWORD)
    old = await make_booking(client, staff, customer_id=4, room_id=41, days_ahead=9100)
    assert await transition(client, staff, old["booking_id"], "cancel") == 200
    # someone else takes the room for exactly the same nights
    async with SessionLocal() as s:
        await s.execute(
            text(
                "WITH nb AS (INSERT INTO booking (customer_id, staff_id, check_in_date, "
                "check_out_date, num_guests, status) "
                "SELECT 5, 2, check_in_date, check_out_date, 1, 'confirmed' "
                "FROM booking WHERE booking_id = :o RETURNING booking_id) "
                "INSERT INTO booking_room (booking_id, room_id, price_per_night) "
                "SELECT booking_id, 41, 900 FROM nb"
            ),
            {"o": old["booking_id"]},
        )
        await s.commit()
        with pytest.raises(DBAPIError, match="double booking"):
            await s.execute(
                text("UPDATE booking SET status = 'confirmed' WHERE booking_id = :o"),
                {"o": old["booking_id"]},
            )
        await s.rollback()


# ------------------------------------------------------------------ H4 / BR-9


async def test_h4_view_balance_matches_the_api_after_a_refund(client: object) -> None:
    """v_booking_bill applies the whole BR-9 rule: refunds are added back and a
    cancelled stay owes nothing - it agrees with the API's balance."""
    from app.db.session import SessionLocal

    staff = await login(client, "recep01", SEED_PASSWORD)
    b = await make_booking(client, staff, customer_id=6, room_id=42, days_ahead=9200)
    bid = b["booking_id"]
    await settle(client, staff, bid)
    assert await transition(client, staff, bid, "cancel") == 200  # early: full refund
    api = (await _c(client).get(f"/api/v1/bookings/{bid}/bill", headers=auth_header(staff))).json()
    async with SessionLocal() as s:
        row = (
            await s.execute(
                text(
                    "SELECT paid_total, refunded_total, balance_due "
                    "FROM v_booking_bill WHERE booking_id = :b"
                ),
                {"b": bid},
            )
        ).one()
    assert Decimal(row.refunded_total) == Decimal(api["refunded_total"]) > 0
    assert Decimal(row.balance_due) == Decimal(api["balance_due"]) == Decimal("0")


# ------------------------------------------------------------------ M1 / BR-18


async def test_m1_a_void_invoice_can_be_reissued_but_never_two_live_ones(
    client: object,
) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    manager = await login(client, "manager01", SEED_PASSWORD)
    b = await make_booking(client, staff, customer_id=7, room_id=43, days_ahead=9300)
    bid = b["booking_id"]
    first = await _c(client).post(
        f"/api/v1/bookings/{bid}/invoice", json={}, headers=auth_header(staff)
    )
    assert first.status_code == 201, first.text
    again = await _c(client).post(
        f"/api/v1/bookings/{bid}/invoice", json={}, headers=auth_header(staff)
    )
    assert again.status_code == 409  # one live invoice at a time
    void = await _c(client).post(
        f"/api/v1/invoices/{first.json()['invoice_id']}/void", headers=auth_header(manager)
    )
    assert void.status_code == 200
    reissued = await _c(client).post(
        f"/api/v1/bookings/{bid}/invoice", json={}, headers=auth_header(staff)
    )
    assert reissued.status_code == 201, reissued.text
    assert reissued.json()["invoice_no"] != first.json()["invoice_no"]
    current = await _c(client).get(f"/api/v1/bookings/{bid}/invoice", headers=auth_header(staff))
    assert current.json()["invoice_id"] == reissued.json()["invoice_id"]


async def test_invoice_line_amount_must_equal_quantity_times_price(db: object) -> None:
    with pytest.raises(IntegrityError, match="chk_invoice_line_amount"):
        await cast(Any, db).execute(
            text(
                "INSERT INTO invoice_line (invoice_id, line_no, line_type, description, "
                "quantity, unit_price, amount) "
                "SELECT invoice_id, 99, 'room', 'x', 2, 100, 150 FROM invoice LIMIT 1"
            )
        )
    await cast(Any, db).rollback()


# ------------------------------------------------------------------ M2 / M3


async def test_m2_staff_role_and_login_role_stay_equal(db: object) -> None:
    s = cast(Any, db)
    await s.execute(text("UPDATE app_user SET role = 'accounting' WHERE username = 'recep02'"))
    roles = (
        await s.execute(
            text(
                "SELECT u.role, st.role FROM app_user u JOIN staff st USING (staff_id) "
                "WHERE u.username = 'recep02'"
            )
        )
    ).one()
    assert roles[0] == roles[1] == "accounting"
    await s.rollback()


async def test_m3_one_login_per_customer(db: object) -> None:
    with pytest.raises(IntegrityError, match="uq_app_user_customer"):
        await cast(Any, db).execute(
            text(
                "INSERT INTO app_user (username, email, password_hash, role, customer_id) "
                "VALUES ('second_login', 'second@example.com', '$2b$12$x', 'customer', 1)"
            )
        )
    await cast(Any, db).rollback()


# ------------------------------------------------------------------ BR-30 (L6)


async def test_br30_check_out_needs_a_settled_folio(client: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    b = await make_booking(client, staff, customer_id=8, room_id=44, days_ahead=9400)
    bid = b["booking_id"]
    await arrive_now(bid)
    assert await transition(client, staff, bid, "check-in") == 200
    unpaid = await _c(client).post(f"/api/v1/bookings/{bid}/check-out", headers=auth_header(staff))
    assert unpaid.status_code == 409
    assert unpaid.json()["code"] == "balance_due"
    assert await transition(client, staff, bid, "check-out") == 200  # settles first


# ------------------------------------------------------------------ L1


async def test_l1_quote_total_is_what_the_booking_charges(client: object) -> None:
    """Parkview Fri-Sun 2026-10-09..12: plans give 1,300 + 1,500 + 1,500 = 4,300,
    but the booking stores one rounded nightly figure (BR-6), so the quote shows
    the 4,299.99 actually charged and keeps the plan sum alongside."""
    q = await _c(client).get(
        "/api/v1/rate-plans/quote",
        params={"room_type_id": 2, "check_in": "2026-10-09", "check_out": "2026-10-12"},
    )
    body = q.json()
    assert Decimal(body["total"]) == Decimal(body["average_per_night"]) * body["nights"]
    assert Decimal(body["rate_total"]) == sum(Decimal(n["price"]) for n in body["breakdown"])


# ------------------------------------------------------------------ H5


async def test_h5_unknown_username_costs_a_real_bcrypt_compare(client: object) -> None:
    """An unknown name must take about as long as a wrong password, or the
    response time reveals which usernames exist."""
    from app.core.security import verify_password
    from app.services.auth_service import _dummy_hash

    dummy = _dummy_hash()
    assert dummy.startswith("$2") and len(dummy) == 60
    started = time.perf_counter()
    assert verify_password("anything", dummy) is False
    assert time.perf_counter() - started > 0.05  # a real hash, not an instant reject
