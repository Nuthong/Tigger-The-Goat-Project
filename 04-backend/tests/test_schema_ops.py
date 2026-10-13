"""Module 10 - the operations schema: rate plans, invoices, housekeeping,
maintenance and the audit trail.

These assert on the database objects themselves (functions, views, triggers)
rather than on the HTTP API - the DDL in 03-database/schema.sql is the graded
artefact, so it gets its own tests.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any, cast

from sqlalchemy import text

from tests.conftest import SEED_PASSWORD, arrive_now, auth_header, login, settle


async def _scalar(db: object, sql: str, **params: Any) -> Any:
    return await cast(Any, db).scalar(text(sql), params)


# ---------------------------------------------------------------- rate plans


async def test_quote_falls_back_to_base_price(db: object) -> None:
    """A weekday with no plan covering it bills the room type's base price."""
    # Oriental Suite (5) base = 3800; 2026-10-01 is a Thursday, no seasonal plan
    price = await _scalar(db, "SELECT fn_quote_room(5, DATE '2026-10-01')")
    assert Decimal(price) == Decimal("3800.00")


async def test_weekend_plan_beats_base_price(db: object) -> None:
    # 2026-10-03 is a Saturday -> the "Weekend 2026" plan applies
    price = await _scalar(db, "SELECT fn_quote_room(5, DATE '2026-10-03')")
    assert Decimal(price) == Decimal("4400.00")


async def test_higher_priority_plan_wins_on_overlap(db: object) -> None:
    """New Year (priority 50) must beat the weekend plan (priority 10)."""
    saturday_in_high_season = await _scalar(db, "SELECT fn_quote_room(5, DATE '2027-01-02')")
    assert Decimal(saturday_in_high_season) == Decimal("5200.00")


async def test_inactive_plan_is_ignored(db: object) -> None:
    """'Old 2025 rate' has priority 99 but is_active = false."""
    price = await _scalar(db, "SELECT fn_quote_room(5, DATE '2025-06-15')")
    assert Decimal(price) == Decimal("3800.00")  # base, not 3000


async def test_quote_stay_sums_each_night_and_excludes_checkout_day(db: object) -> None:
    # 30 Dec, 31 Dec, 1 Jan at 5200 = 15600; the 2nd is the check-out day
    total = await _scalar(db, "SELECT fn_quote_stay(5, DATE '2026-12-30', DATE '2027-01-02')")
    assert Decimal(total) == Decimal("15600.00")


async def test_weekday_only_promotion_does_not_apply_at_the_weekend(db: object) -> None:
    # Riverview (2): base 1300, midweek green-season promo 990
    monday = await _scalar(db, "SELECT fn_quote_room(2, DATE '2026-09-07')")
    saturday = await _scalar(db, "SELECT fn_quote_room(2, DATE '2026-09-12')")
    assert Decimal(monday) == Decimal("990.00")
    assert Decimal(saturday) == Decimal("1500.00")  # weekend plan, not the promo


# ------------------------------------------------------------------ triggers


async def test_checkout_creates_housekeeping_task_and_dirties_the_room(
    client: object, db: object
) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    resp = await cast(Any, client).post(
        "/api/v1/bookings",
        json={
            "customer_id": 2,
            "check_in_date": (date.today().replace(year=date.today().year + 9)).isoformat(),
            "check_out_date": (
                date.today().replace(year=date.today().year + 9).replace(day=28)
            ).isoformat(),
            "rooms": [{"room_id": 4}],
        },
        headers=auth_header(staff),
    )
    assert resp.status_code == 201, resp.text
    booking_id = resp.json()["booking_id"]

    await arrive_now(booking_id)
    await settle(client, staff, booking_id)
    for action in ("check-in", "check-out"):
        step = await cast(Any, client).post(
            f"/api/v1/bookings/{booking_id}/{action}", headers=auth_header(staff)
        )
        assert step.status_code == 200, step.text

    tasks = await _scalar(
        db,
        "SELECT count(*) FROM housekeeping_task "
        "WHERE booking_id = :b AND task_type = 'checkout_clean'",
        b=booking_id,
    )
    assert tasks == 1

    room_status = await _scalar(db, "SELECT status FROM room WHERE room_id = 4")
    assert room_status == "cleaning"


async def test_booking_changes_are_written_to_the_audit_log(client: object, db: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    resp = await cast(Any, client).post(
        "/api/v1/bookings",
        json={
            "customer_id": 3,
            "check_in_date": "2031-03-01",
            "check_out_date": "2031-03-03",
            "rooms": [{"room_id": 6}],
        },
        headers=auth_header(staff),
    )
    booking_id = resp.json()["booking_id"]

    rows = await _scalar(
        db,
        "SELECT count(*) FROM audit_log "
        "WHERE entity_type = 'booking' AND entity_id = :id AND action = 'booking.create'",
        id=str(booking_id),
    )
    assert rows == 1

    await cast(Any, client).post(
        f"/api/v1/bookings/{booking_id}/cancel", headers=auth_header(staff)
    )
    summary = await _scalar(
        db,
        "SELECT summary FROM audit_log "
        "WHERE entity_type='booking' AND entity_id = :id "
        "AND action='booking.status_change' ORDER BY audit_id DESC LIMIT 1",
        id=str(booking_id),
    )
    assert "cancelled" in summary


# -------------------------------------------------------------------- views


async def test_operations_views_are_queryable(db: object) -> None:
    for view in (
        "v_housekeeping_board",
        "v_maintenance_open",
        "v_daily_revenue",
        "v_invoice_summary",
    ):
        count = await _scalar(db, f"SELECT count(*) FROM {view}")  # noqa: S608 - fixed list
        assert count >= 0


async def test_maintenance_board_orders_urgent_first(db: object) -> None:
    first = await _scalar(db, "SELECT priority FROM v_maintenance_open LIMIT 1")
    assert first == "urgent"


async def test_invoice_totals_reconcile_with_payments(db: object) -> None:
    """The four seeded invoices (B1-B4) are settled in full.

    Scoped to those on purpose - other tests issue invoices for bookings that
    have not been paid, and an outstanding balance there is correct.
    """
    unpaid = await _scalar(
        db,
        "SELECT count(*) FROM v_invoice_summary WHERE booking_id <= 4 AND balance_due <> 0",
    )
    assert unpaid == 0


async def test_invoice_total_equals_subtotal_plus_tax(db: object) -> None:
    mismatched = await _scalar(
        db,
        "SELECT count(*) FROM invoice WHERE round(subtotal + tax_amount, 2) <> total",
    )
    assert mismatched == 0


# -------------------------------------------------------------------- roles


async def test_new_ops_roles_can_sign_in(client: object) -> None:
    for username in ("house01", "acct01", "admin01"):
        token = await login(client, username, SEED_PASSWORD)
        me = await cast(Any, client).get("/api/v1/auth/me", headers=auth_header(token))
        assert me.status_code == 200, username


async def test_housekeeping_cannot_work_the_reservation_desk(client: object) -> None:
    token = await login(client, "house01", SEED_PASSWORD)
    resp = await cast(Any, client).post(
        "/api/v1/bookings",
        json={
            "customer_id": 1,
            "check_in_date": "2032-01-01",
            "check_out_date": "2032-01-02",
            "rooms": [{"room_id": 1}],
        },
        headers=auth_header(token),
    )
    assert resp.status_code == 403


async def test_admin_has_manager_reach(client: object) -> None:
    token = await login(client, "admin01", SEED_PASSWORD)
    resp = await cast(Any, client).get(
        "/api/v1/reports/revenue-by-room-type", headers=auth_header(token)
    )
    assert resp.status_code == 200
