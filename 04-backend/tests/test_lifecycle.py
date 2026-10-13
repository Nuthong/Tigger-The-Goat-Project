"""Module 5 - Booking lifecycle: check-in -> check-out -> cancel + state guards."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, cast

from sqlalchemy import text

from tests.conftest import (
    SEED_PASSWORD,
    arrive_now,
    auth_header,
    login,
    make_booking,
    move_stay,
    settle,
    transition,
)


async def _guest_books(client: object, token: str, *, room_id: int, days_ahead: int) -> int:
    start = date.today() + timedelta(days=days_ahead)
    resp = await cast(Any, client).post(
        "/api/v1/bookings",
        json={
            "check_in_date": start.isoformat(),
            "check_out_date": (start + timedelta(days=2)).isoformat(),
            "rooms": [{"room_id": room_id}],
        },
        headers=auth_header(token),
    )
    assert resp.status_code == 201, resp.text
    return int(resp.json()["booking_id"])


async def _age_hold(db: object, booking_id: int, minutes: int) -> None:
    """Backdate a booking so it looks `minutes` old."""
    await cast(Any, db).execute(
        text(
            "UPDATE booking SET booking_date = now() - make_interval(mins => :m) "
            "WHERE booking_id = :b"
        ),
        {"m": minutes, "b": booking_id},
    )
    await cast(Any, db).commit()


async def _pull_check_in_forward(db: object, booking_id: int) -> None:
    """Move a stay to start tomorrow, so the free-cancellation window has passed."""
    await move_stay(booking_id, 1, nights=2)


async def _push_arrival_into_the_past(db: object, booking_id: int) -> None:
    """Backdate a stay so its arrival was yesterday - a no-show candidate."""
    await move_stay(booking_id, -1, nights=2)


async def _guest_pay(client: object, token: str, booking_id: int) -> None:
    resp = await cast(Any, client).post(
        f"/api/v1/bookings/{booking_id}/pay",
        json={"method": "credit_card"},
        headers=auth_header(token),
    )
    assert resp.status_code == 200, resp.text


async def test_happy_path_checkin_then_checkout(client: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    b = await make_booking(client, staff, customer_id=4, room_id=1, days_ahead=2200)
    bid = b["booking_id"]

    assert await transition(client, staff, bid, "check-in") == 409  # arrival is far off
    await arrive_now(bid)
    assert await transition(client, staff, bid, "check-in") == 200
    got = await client.get(f"/api/v1/bookings/{bid}", headers=auth_header(staff))  # type: ignore[attr-defined]
    assert got.json()["status"] == "checked_in"

    assert await transition(client, staff, bid, "check-out") == 200
    got = await client.get(f"/api/v1/bookings/{bid}", headers=auth_header(staff))  # type: ignore[attr-defined]
    assert got.json()["status"] == "checked_out"


async def test_cannot_check_out_before_check_in(client: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    b = await make_booking(client, staff, customer_id=4, room_id=2, days_ahead=2300)
    assert await transition(client, staff, b["booking_id"], "check-out") == 409  # still 'confirmed'


async def test_customer_can_cancel_own_but_not_others(client: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    mine = await make_booking(client, staff, customer_id=1, room_id=3, days_ahead=2400)
    theirs = await make_booking(client, staff, customer_id=2, room_id=4, days_ahead=2400)

    somchai = await login(client, "somchai", SEED_PASSWORD)  # customer 1
    ok = await client.post(  # type: ignore[attr-defined]
        f"/api/v1/bookings/{mine['booking_id']}/cancel", headers=auth_header(somchai)
    )
    assert ok.status_code == 200
    assert ok.json()["status"] == "cancelled"

    nope = await client.post(  # type: ignore[attr-defined]
        f"/api/v1/bookings/{theirs['booking_id']}/cancel", headers=auth_header(somchai)
    )
    assert nope.status_code == 404  # scoped away


async def test_customer_cannot_check_in(client: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    b = await make_booking(client, staff, customer_id=1, room_id=5, days_ahead=2500)
    somchai = await login(client, "somchai", SEED_PASSWORD)
    resp = await client.post(  # type: ignore[attr-defined]
        f"/api/v1/bookings/{b['booking_id']}/check-in", headers=auth_header(somchai)
    )
    assert resp.status_code == 403


async def test_online_booking_is_a_hold_until_it_is_paid(client: object) -> None:
    """A guest's booking opens `pending`; paying it off promotes it to `confirmed`."""
    somchai = await login(client, "somchai", SEED_PASSWORD)  # customer 1
    bid = await _guest_books(client, somchai, room_id=1, days_ahead=2710)

    got = await cast(Any, client).get(f"/api/v1/bookings/{bid}", headers=auth_header(somchai))
    assert got.json()["status"] == "pending"

    paid = await cast(Any, client).post(
        f"/api/v1/bookings/{bid}/pay",
        json={"method": "promptpay"},
        headers=auth_header(somchai),
    )
    assert paid.status_code == 200

    got = await cast(Any, client).get(f"/api/v1/bookings/{bid}", headers=auth_header(somchai))
    assert got.json()["status"] == "confirmed"


async def test_cannot_check_in_before_the_arrival_date(client: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    b = await make_booking(client, staff, customer_id=4, room_id=1, days_ahead=1900)
    bid = b["booking_id"]

    early = await cast(Any, client).post(
        f"/api/v1/bookings/{bid}/check-in", headers=auth_header(staff)
    )
    assert early.status_code == 409
    assert early.json()["code"] == "too_early"

    await arrive_now(bid)
    assert await transition(client, staff, bid, "check-in") == 200


async def test_an_unpaid_hold_cannot_be_checked_in(client: object) -> None:
    """The front desk cannot check a guest into a room they haven't paid for."""
    somchai = await login(client, "somchai", SEED_PASSWORD)
    bid = await _guest_books(client, somchai, room_id=2, days_ahead=2720)

    staff = await login(client, "recep01", SEED_PASSWORD)
    early = await cast(Any, client).post(
        f"/api/v1/bookings/{bid}/check-in", headers=auth_header(staff)
    )
    assert early.status_code == 409
    assert early.json()["code"] == "bad_state"

    await cast(Any, client).post(
        f"/api/v1/bookings/{bid}/pay",
        json={"method": "credit_card"},
        headers=auth_header(somchai),
    )
    await arrive_now(bid)
    assert await transition(client, staff, bid, "check-in") == 200


async def test_front_desk_can_settle_a_pending_hold(client: object) -> None:
    somchai = await login(client, "somchai", SEED_PASSWORD)
    bid = await _guest_books(client, somchai, room_id=3, days_ahead=2730)

    staff = await login(client, "recep01", SEED_PASSWORD)
    bill = await cast(Any, client).get(f"/api/v1/bookings/{bid}/bill", headers=auth_header(staff))
    paid = await cast(Any, client).post(
        f"/api/v1/bookings/{bid}/payments",
        json={"amount": bill.json()["balance_due"], "method": "cash"},
        headers=auth_header(staff),
    )
    assert paid.status_code == 201

    got = await cast(Any, client).get(f"/api/v1/bookings/{bid}", headers=auth_header(staff))
    assert got.json()["status"] == "confirmed"


async def test_a_hold_carries_an_expiry_a_confirmed_booking_does_not(client: object) -> None:
    somchai = await login(client, "somchai", SEED_PASSWORD)
    bid = await _guest_books(client, somchai, room_id=1, days_ahead=2740)
    got = await cast(Any, client).get(f"/api/v1/bookings/{bid}", headers=auth_header(somchai))
    row = got.json()
    assert row["hold_expires_at"] is not None
    made = datetime.fromisoformat(row["booking_date"])
    expires = datetime.fromisoformat(row["hold_expires_at"])
    assert 25 * 60 <= (expires - made).total_seconds() <= 35 * 60  # ~30 min window

    staff = await login(client, "recep01", SEED_PASSWORD)
    b2 = await make_booking(client, staff, customer_id=4, room_id=1, days_ahead=6000)
    assert b2["hold_expires_at"] is None  # desk booking is already a real reservation


async def test_a_fresh_hold_blocks_the_room(client: object) -> None:
    somchai = await login(client, "somchai", SEED_PASSWORD)
    await _guest_books(client, somchai, room_id=2, days_ahead=2745)
    anna = await login(client, "anna", SEED_PASSWORD)
    start = date.today() + timedelta(days=2745)
    clash = await cast(Any, client).post(
        "/api/v1/bookings",
        json={
            "check_in_date": start.isoformat(),
            "check_out_date": (start + timedelta(days=2)).isoformat(),
            "rooms": [{"room_id": 2}],
        },
        headers=auth_header(anna),
    )
    assert clash.status_code == 409  # the hold still owns the room


async def test_a_lapsed_hold_is_released_and_frees_the_room(client: object, db: object) -> None:
    somchai = await login(client, "somchai", SEED_PASSWORD)
    stale = await _guest_books(client, somchai, room_id=3, days_ahead=2750)
    await _age_hold(db, stale, minutes=45)

    # a fresh booking attempt sweeps the lapsed hold, so the room is free again
    anna = await login(client, "anna", SEED_PASSWORD)
    start = date.today() + timedelta(days=2750)
    ok = await cast(Any, client).post(
        "/api/v1/bookings",
        json={
            "check_in_date": start.isoformat(),
            "check_out_date": (start + timedelta(days=2)).isoformat(),
            "rooms": [{"room_id": 3}],
        },
        headers=auth_header(anna),
    )
    assert ok.status_code == 201, ok.text

    gone = await cast(Any, client).get(f"/api/v1/bookings/{stale}", headers=auth_header(somchai))
    assert gone.json()["status"] == "cancelled"


async def test_paying_a_lapsed_hold_is_rejected(client: object, db: object) -> None:
    somchai = await login(client, "somchai", SEED_PASSWORD)
    stale = await _guest_books(client, somchai, room_id=4, days_ahead=2755)
    await _age_hold(db, stale, minutes=45)

    resp = await cast(Any, client).post(
        f"/api/v1/bookings/{stale}/pay",
        json={"method": "promptpay"},
        headers=auth_header(somchai),
    )
    assert resp.status_code == 409
    assert resp.json()["code"] == "hold_expired"


async def test_cancelling_early_refunds_in_full(client: object) -> None:
    somchai = await login(client, "somchai", SEED_PASSWORD)
    bid = await _guest_books(client, somchai, room_id=20, days_ahead=380)
    await _guest_pay(client, somchai, bid)

    resp = await cast(Any, client).post(
        f"/api/v1/bookings/{bid}/cancel", headers=auth_header(somchai)
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "cancelled"
    assert body["amount_refunded"] == body["grand_total"]  # full refund, no fee
    assert body["free_cancellation_deadline"] is None

    bill = (
        await cast(Any, client).get(f"/api/v1/bookings/{bid}/bill", headers=auth_header(somchai))
    ).json()
    assert bill["refunded_total"] == bill["paid_total"]


async def test_cancelling_late_keeps_a_one_night_fee(client: object, db: object) -> None:
    somchai = await login(client, "somchai", SEED_PASSWORD)
    bid = await _guest_books(client, somchai, room_id=21, days_ahead=381)
    await _guest_pay(client, somchai, bid)
    await _pull_check_in_forward(db, bid)  # inside the fee window now

    got = (
        await cast(Any, client).get(f"/api/v1/bookings/{bid}", headers=auth_header(somchai))
    ).json()
    one_night = Decimal(got["rooms"][0]["price_per_night"])
    grand = Decimal(got["grand_total"])

    body = (
        await cast(Any, client).post(f"/api/v1/bookings/{bid}/cancel", headers=auth_header(somchai))
    ).json()
    assert body["status"] == "cancelled"
    assert Decimal(body["amount_refunded"]) == grand - one_night  # one night kept
    assert Decimal(body["amount_refunded"]) >= 0


async def test_staff_move_a_booking_to_new_dates_and_reprice(client: object) -> None:
    """Reschedule keeps the room, re-prices for the new window, and refunds the
    guest if the shorter stay leaves them overpaid."""
    staff = await login(client, "recep01", SEED_PASSWORD)
    booking = await make_booking(
        client, staff, customer_id=6, room_id=25, days_ahead=7100, nights=3
    )
    bid = booking["booking_id"]
    await _guest_pay(client, staff, bid)  # pay the 3-night stay in full

    ci = date.fromisoformat(booking["check_in_date"])
    new_ci = (ci + timedelta(days=5)).isoformat()
    new_co = (ci + timedelta(days=6)).isoformat()  # shrink to 1 night
    resp = await cast(Any, client).patch(
        f"/api/v1/bookings/{bid}/dates",
        json={"check_in_date": new_ci, "check_out_date": new_co},
        headers=auth_header(staff),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["check_in_date"] == new_ci and body["check_out_date"] == new_co
    # 3 nights paid, 1 night owed -> the 2-night difference is refunded, balance 0
    assert Decimal(body["amount_refunded"]) > Decimal("0")
    assert Decimal(body["balance_due"]) == Decimal("0.00")

    bill = (
        await cast(Any, client).get(f"/api/v1/bookings/{bid}/bill", headers=auth_header(staff))
    ).json()
    assert bill["nights"] == 1
    assert Decimal(bill["refunded_total"]) == Decimal(bill["room_total"]) * 2  # 2 nights back


async def test_a_guest_reschedules_their_own_upcoming_stay(client: object, db: object) -> None:
    somchai = await login(client, "somchai", SEED_PASSWORD)
    bid = await _guest_books(client, somchai, room_id=30, days_ahead=395)
    got = (
        await cast(Any, client).get(f"/api/v1/bookings/{bid}", headers=auth_header(somchai))
    ).json()
    ci = date.fromisoformat(got["check_in_date"])
    new_ci = (ci + timedelta(days=2)).isoformat()
    new_co = (ci + timedelta(days=5)).isoformat()

    ok = await cast(Any, client).patch(
        f"/api/v1/bookings/{bid}/dates",
        json={"check_in_date": new_ci, "check_out_date": new_co},
        headers=auth_header(somchai),
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["check_in_date"] == new_ci

    # a guest cannot touch a booking that is not theirs
    staff = await login(client, "recep01", SEED_PASSWORD)
    other = await make_booking(client, staff, customer_id=2, room_id=31, days_ahead=7400)
    denied = await cast(Any, client).patch(
        f"/api/v1/bookings/{other['booking_id']}/dates",
        json={"check_in_date": new_ci, "check_out_date": new_co},
        headers=auth_header(somchai),
    )
    assert denied.status_code == 404

    # once the arrival is here, only the desk can move it
    await _push_arrival_into_the_past(db, bid)
    late = await cast(Any, client).patch(
        f"/api/v1/bookings/{bid}/dates",
        json={
            "check_in_date": (date.today() + timedelta(days=10)).isoformat(),
            "check_out_date": (date.today() + timedelta(days=12)).isoformat(),
        },
        headers=auth_header(somchai),
    )
    assert late.status_code == 409 and late.json()["code"] == "too_late"


async def test_reschedule_rejects_a_clash_and_a_finished_stay(client: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    a = await make_booking(client, staff, customer_id=6, room_id=26, days_ahead=7200, nights=2)
    b = await make_booking(client, staff, customer_id=7, room_id=26, days_ahead=7260, nights=2)

    # move booking A onto booking B's window (same room) -> clash
    clash = await cast(Any, client).patch(
        f"/api/v1/bookings/{a['booking_id']}/dates",
        json={
            "check_in_date": b["check_in_date"],
            "check_out_date": b["check_out_date"],
        },
        headers=auth_header(staff),
    )
    assert clash.status_code == 409 and clash.json()["code"] == "unavailable"

    # a checked-out booking's dates are frozen
    done = await make_booking(client, staff, customer_id=8, room_id=27, days_ahead=7300, nights=1)
    await arrive_now(done["booking_id"])
    await settle(client, staff, done["booking_id"])
    for action in ("check-in", "check-out"):
        await cast(Any, client).post(
            f"/api/v1/bookings/{done['booking_id']}/{action}", headers=auth_header(staff)
        )
    frozen = await cast(Any, client).patch(
        f"/api/v1/bookings/{done['booking_id']}/dates",
        json={
            "check_in_date": (date.today() + timedelta(days=800)).isoformat(),
            "check_out_date": (date.today() + timedelta(days=802)).isoformat(),
        },
        headers=auth_header(staff),
    )
    assert frozen.status_code == 409 and frozen.json()["code"] == "bad_state"

    # inverted dates are rejected at the schema (422), not as a business conflict
    inverted = await cast(Any, client).patch(
        f"/api/v1/bookings/{a['booking_id']}/dates",
        json={"check_in_date": "2030-05-10", "check_out_date": "2030-05-08"},
        headers=auth_header(staff),
    )
    assert inverted.status_code == 422


async def test_a_stale_confirmed_arrival_is_marked_a_no_show(client: object, db: object) -> None:
    """No-show: only for a confirmed booking whose arrival has passed; keeps the
    first night as a fee and records the reason distinctly in the audit trail."""
    staff = await login(client, "recep01", SEED_PASSWORD)
    booking = await make_booking(
        client, staff, customer_id=8, room_id=12, days_ahead=7000, nights=2
    )
    bid = booking["booking_id"]
    await _guest_pay(client, staff, bid)  # money on file to keep a fee against

    early = await cast(Any, client).post(
        f"/api/v1/bookings/{bid}/no-show", headers=auth_header(staff)
    )
    assert early.status_code == 409 and early.json()["code"] == "too_early"

    await _push_arrival_into_the_past(db, bid)
    done = await cast(Any, client).post(
        f"/api/v1/bookings/{bid}/no-show", headers=auth_header(staff)
    )
    assert done.status_code == 200, done.text
    body = done.json()
    assert body["status"] == "cancelled"
    assert Decimal("0") < Decimal(body["amount_refunded"]) < Decimal(body["amount_paid"])

    again = await cast(Any, client).post(
        f"/api/v1/bookings/{bid}/no-show", headers=auth_header(staff)
    )
    assert again.status_code == 409 and again.json()["code"] == "bad_state"

    manager = await login(client, "manager01", SEED_PASSWORD)
    audit = await cast(Any, client).get(
        "/api/v1/admin/audit?entity_type=booking", headers=auth_header(manager)
    )
    assert any(
        r["action"] == "booking.no_show" and r["entity_id"] == str(bid)
        for r in audit.json()["items"]
    )


async def test_a_guest_cannot_mark_their_own_booking_a_no_show(client: object) -> None:
    somchai = await login(client, "somchai", SEED_PASSWORD)
    bid = await _guest_books(client, somchai, room_id=24, days_ahead=383)
    resp = await cast(Any, client).post(
        f"/api/v1/bookings/{bid}/no-show", headers=auth_header(somchai)
    )
    assert resp.status_code == 403


async def test_cancelling_an_unpaid_hold_refunds_nothing(client: object) -> None:
    somchai = await login(client, "somchai", SEED_PASSWORD)
    bid = await _guest_books(client, somchai, room_id=22, days_ahead=382)  # pending, unpaid

    body = (
        await cast(Any, client).post(f"/api/v1/bookings/{bid}/cancel", headers=auth_header(somchai))
    ).json()
    assert body["status"] == "cancelled"
    assert body["amount_refunded"] == "0.00"


async def test_a_desk_paid_booking_is_refunded_on_cancel(client: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    booking = await make_booking(
        client, staff, customer_id=2, room_id=23, days_ahead=6100, nights=2
    )
    bid = booking["booking_id"]
    await cast(Any, client).post(
        f"/api/v1/bookings/{bid}/payments",
        json={"amount": booking["grand_total"], "method": "cash"},
        headers=auth_header(staff),
    )
    body = (
        await cast(Any, client).post(f"/api/v1/bookings/{bid}/cancel", headers=auth_header(staff))
    ).json()
    assert Decimal(body["amount_refunded"]) == Decimal(booking["grand_total"])  # far future: full


async def test_cancelled_booking_frees_the_room(client: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    b = await make_booking(client, staff, customer_id=6, room_id=9, days_ahead=2600, nights=2)
    await client.post(  # type: ignore[attr-defined]
        f"/api/v1/bookings/{b['booking_id']}/cancel", headers=auth_header(staff)
    )
    # same room + dates should now book again without a 409
    again = await client.post(  # type: ignore[attr-defined]
        "/api/v1/bookings",
        json={
            "customer_id": 7,
            "check_in_date": b["check_in_date"],
            "check_out_date": b["check_out_date"],
            "rooms": [{"room_id": 9}],
        },
        headers=auth_header(staff),
    )
    assert again.status_code == 201
