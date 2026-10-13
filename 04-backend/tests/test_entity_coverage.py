"""Entities the portal exposes beyond the booking core: the add-on catalog and
folio charges (`service`, `booking_service`), the payment ledger (`payment`),
room-status history (`room_status_log`), the sign-in log (`auth_event`), guest
ID records (`customer.id_card_no`), room-type editing (`room_type`), staff
records (`staff`) and the three views the front office reads directly
(`v_current_guests`, `v_housekeeping_board`, `v_maintenance_open`)."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Any, cast

from sqlalchemy import text

from tests.conftest import (
    SEED_PASSWORD,
    arrive_now,
    auth_header,
    login,
    make_booking,
    transition,
)


def _c(client: object) -> Any:
    return cast(Any, client)


async def _free_room_today(db: object, nights: int = 2) -> int:
    """A room that is sellable from today for `nights` nights - so a booking can
    be slid to arrive today with `arrive_now` and checked in."""
    row = (
        await cast(Any, db).execute(
            text(
                "SELECT room_id FROM fn_available_rooms("
                "CURRENT_DATE, CURRENT_DATE + CAST(:n AS int)) "
                "ORDER BY room_id DESC LIMIT 1"
            ),
            {"n": nights},
        )
    ).first()
    assert row is not None, "no room free today"
    return int(row[0])


# ================================================================ services


async def test_public_service_list_is_active_only_and_catalog_is_manager_only(
    client: object,
) -> None:
    resp = await _c(client).get("/api/v1/services")
    assert resp.status_code == 200
    items = resp.json()
    assert items and all(s["is_active"] for s in items)
    assert {"service_id", "name", "price", "description", "is_active"} <= items[0].keys()

    recep = await login(client, "recep01", SEED_PASSWORD)
    assert (
        await _c(client).get("/api/v1/services/catalog", headers=auth_header(recep))
    ).status_code == 403

    manager = await login(client, "manager01", SEED_PASSWORD)
    cat = await _c(client).get("/api/v1/services/catalog", headers=auth_header(manager))
    assert cat.status_code == 200
    row = cat.json()[0]
    assert {"times_sold", "units_sold", "revenue"} <= row.keys()


async def test_manager_creates_renames_reprices_and_retires_a_service(client: object) -> None:
    manager = await login(client, "manager01", SEED_PASSWORD)
    h = auth_header(manager)

    made = await _c(client).post(
        "/api/v1/services",
        json={"name": "Spa Voucher", "price": "1200.00", "description": "60-minute massage"},
        headers=h,
    )
    assert made.status_code == 201, made.text
    sid = made.json()["service_id"]
    assert made.json()["is_active"] is True

    # names are unique regardless of case
    dup = await _c(client).post(
        "/api/v1/services", json={"name": "spa voucher", "price": "10"}, headers=h
    )
    assert dup.status_code == 409

    upd = await _c(client).patch(
        f"/api/v1/services/{sid}", json={"price": "1350.00", "is_active": False}, headers=h
    )
    assert upd.status_code == 200
    assert Decimal(upd.json()["price"]) == Decimal("1350.00")
    assert upd.json()["is_active"] is False

    # retired: gone from the public list, and it cannot be booked any more
    public = (await _c(client).get("/api/v1/services")).json()
    assert sid not in {s["service_id"] for s in public}

    audit = await _c(client).get(
        "/api/v1/admin/audit", params={"entity_type": "service"}, headers=h
    )
    assert {"service.create", "service.update"} <= {r["action"] for r in audit.json()["items"]}


async def test_service_validation(client: object) -> None:
    manager = await login(client, "manager01", SEED_PASSWORD)
    h = auth_header(manager)
    neg = await _c(client).post("/api/v1/services", json={"name": "X", "price": "-1"}, headers=h)
    assert neg.status_code == 422
    missing = await _c(client).patch("/api/v1/services/999999", json={"price": "1"}, headers=h)
    assert missing.status_code == 404
    blank = await _c(client).patch("/api/v1/services/1", json={"name": "   "}, headers=h)
    assert blank.status_code == 409


# ========================================================= folio charges


async def test_front_desk_posts_and_removes_charges_on_an_open_folio(client: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    h = auth_header(staff)
    b = await make_booking(client, staff, customer_id=9, room_id=40, days_ahead=8000)
    bid = b["booking_id"]
    assert b["services"] == []
    assert b["payments"] == []

    add = await _c(client).post(
        f"/api/v1/bookings/{bid}/services", json={"service_id": 1, "quantity": 1}, headers=h
    )
    assert add.status_code == 201, add.text
    line = next(s for s in add.json()["services"] if s["service_id"] == 1)
    assert line["quantity"] == 1
    assert Decimal(line["unit_price"]) == Decimal("250.00")  # Breakfast Buffet

    # the same service again raises the quantity at the locked price (BR-6)
    again = await _c(client).post(
        f"/api/v1/bookings/{bid}/services", json={"service_id": 1, "quantity": 2}, headers=h
    )
    line = next(s for s in again.json()["services"] if s["service_id"] == 1)
    assert line["quantity"] == 3
    assert Decimal(again.json()["grand_total"]) == Decimal(b["grand_total"]) + Decimal("750.00")

    # pay everything, then take the charge off -> the difference is refunded
    pay = await _c(client).post(
        f"/api/v1/bookings/{bid}/payments",
        json={"amount": again.json()["balance_due"], "method": "cash", "reference_no": "R-1"},
        headers=h,
    )
    assert pay.status_code == 201, pay.text

    removed = await _c(client).delete(f"/api/v1/bookings/{bid}/services/1", headers=h)
    assert removed.status_code == 200, removed.text
    body = removed.json()
    assert body["services"] == []
    assert Decimal(body["amount_refunded"]) == Decimal("750.00")
    assert Decimal(body["balance_due"]) == Decimal("0.00")
    ledger = body["payments"]
    assert [p["status"] for p in ledger] == ["paid", "refunded"]
    assert ledger[0]["method"] == "cash" and ledger[0]["reference_no"] == "R-1"
    assert ledger[1]["reference_no"] == f"ADJ-{bid}"

    gone = await _c(client).delete(f"/api/v1/bookings/{bid}/services/1", headers=h)
    assert gone.status_code == 404


async def test_addons_are_capped_by_the_shape_of_the_stay(client: object) -> None:
    """BR-29: a 2-night stay for 2 in 1 room takes at most 4 breakfasts,
    2 extra-bed nights, 2 transfers and 1 late check-out."""
    staff = await login(client, "recep01", SEED_PASSWORD)
    h = auth_header(staff)
    catalog = {s["name"]: s for s in (await _c(client).get("/api/v1/services")).json()}
    assert catalog["Breakfast Buffet"]["basis"] == "per_guest_night"
    assert catalog["Extra Bed"]["basis"] == "per_room_night"
    assert catalog["Airport Transfer"]["basis"] == "per_trip"
    assert catalog["Late Checkout"]["basis"] == "per_room_stay"
    assert catalog["Laundry"]["basis"] == "per_room_night"

    # at booking time: 5 breakfasts is one more than 2 guests x 2 nights
    start = date.today() + timedelta(days=8400)
    payload = {
        "customer_id": 9,
        "check_in_date": start.isoformat(),
        "check_out_date": (start + timedelta(days=2)).isoformat(),
        "num_guests": 2,
        "rooms": [{"room_id": 42}],
        "services": [{"service_id": catalog["Breakfast Buffet"]["service_id"], "quantity": 5}],
    }
    over = await _c(client).post("/api/v1/bookings", json=payload, headers=h)
    assert over.status_code == 409
    assert over.json()["code"] == "over_quantity"

    # splitting the same add-on over two lines is refused, not a 500 on the
    # uq_booking_service constraint
    breakfast = catalog["Breakfast Buffet"]["service_id"]
    split = {**payload, "services": [{"service_id": breakfast, "quantity": 3}] * 2}
    assert (await _c(client).post("/api/v1/bookings", json=split, headers=h)).status_code == 422
    # two rooms for one guest leaves a room nobody sleeps in
    empty_room = {
        **payload,
        "num_guests": 1,
        "rooms": [{"room_id": 42}, {"room_id": 43}],
        "services": [],
    }
    resp = await _c(client).post("/api/v1/bookings", json=empty_room, headers=h)
    assert resp.status_code == 422

    payload["services"] = [
        {"service_id": catalog["Breakfast Buffet"]["service_id"], "quantity": 4},
        {"service_id": catalog["Late Checkout"]["service_id"], "quantity": 1},
    ]
    ok = await _c(client).post("/api/v1/bookings", json=payload, headers=h)
    assert ok.status_code == 201, ok.text
    bid = ok.json()["booking_id"]

    # posting later counts what is already on the folio
    late = catalog["Late Checkout"]["service_id"]
    second = await _c(client).post(
        f"/api/v1/bookings/{bid}/services", json={"service_id": late}, headers=h
    )
    assert second.status_code == 409
    assert second.json()["code"] == "over_quantity"
    transfer = catalog["Airport Transfer"]["service_id"]
    three = await _c(client).post(
        f"/api/v1/bookings/{bid}/services", json={"service_id": transfer, "quantity": 3}, headers=h
    )
    assert three.status_code == 409

    # pay in full, then shorten the stay to one night: breakfast drops to
    # 2 guests x 1 night and the difference comes back as a refund
    body = ok.json()
    paid = await _c(client).post(
        f"/api/v1/bookings/{bid}/payments",
        json={"amount": body["balance_due"], "method": "cash", "reference_no": "R-CAP"},
        headers=h,
    )
    assert paid.status_code == 201, paid.text
    moved = await _c(client).patch(
        f"/api/v1/bookings/{bid}/dates",
        json={
            "check_in_date": start.isoformat(),
            "check_out_date": (start + timedelta(days=1)).isoformat(),
        },
        headers=h,
    )
    assert moved.status_code == 200, moved.text
    after = moved.json()
    qty = {s["service_id"]: s["quantity"] for s in after["services"]}
    assert qty[catalog["Breakfast Buffet"]["service_id"]] == 2
    assert qty[late] == 1
    assert Decimal(after["balance_due"]) == Decimal("0.00")
    assert Decimal(after["amount_refunded"]) >= Decimal("500.00")  # two breakfasts at least


async def test_charges_are_frozen_once_invoiced_or_closed(client: object, db: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    h = auth_header(staff)
    room = await _free_room_today(db)
    b = await make_booking(client, staff, customer_id=10, room_id=room, days_ahead=8100)
    bid = b["booking_id"]
    await arrive_now(bid)
    assert await transition(client, staff, bid, "check-in") == 200

    inv = await _c(client).post(f"/api/v1/bookings/{bid}/invoice", json={}, headers=h)
    assert inv.status_code == 201, inv.text
    blocked = await _c(client).post(
        f"/api/v1/bookings/{bid}/services", json={"service_id": 1}, headers=h
    )
    assert blocked.status_code == 409
    assert blocked.json()["code"] == "invoiced"

    # a voided invoice no longer freezes the folio
    manager = await login(client, "manager01", SEED_PASSWORD)
    void = await _c(client).post(
        f"/api/v1/invoices/{inv.json()['invoice_id']}/void", headers=auth_header(manager)
    )
    assert void.status_code == 200
    ok = await _c(client).post(
        f"/api/v1/bookings/{bid}/services", json={"service_id": 1}, headers=h
    )
    assert ok.status_code == 201

    assert await transition(client, staff, bid, "check-out") == 200
    closed = await _c(client).post(
        f"/api/v1/bookings/{bid}/services", json={"service_id": 1}, headers=h
    )
    assert closed.status_code == 409
    assert closed.json()["code"] == "bad_state"


async def test_retired_service_and_guest_cannot_post_charges(client: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    manager = await login(client, "manager01", SEED_PASSWORD)
    made = await _c(client).post(
        "/api/v1/services",
        json={"name": "Retired Add-on", "price": "50", "is_active": False},
        headers=auth_header(manager),
    )
    sid = made.json()["service_id"]
    b = await make_booking(client, staff, customer_id=1, room_id=41, days_ahead=8200)
    resp = await _c(client).post(
        f"/api/v1/bookings/{b['booking_id']}/services",
        json={"service_id": sid},
        headers=auth_header(staff),
    )
    assert resp.status_code == 404

    guest = await login(client, "somchai", SEED_PASSWORD)
    forbidden = await _c(client).post(
        f"/api/v1/bookings/{b['booking_id']}/services",
        json={"service_id": 1},
        headers=auth_header(guest),
    )
    assert forbidden.status_code == 403


# ========================================================= room status log


async def test_room_status_changes_are_logged_with_who_did_it(client: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    h = auth_header(staff)
    room_id = 42
    to_closed = await _c(client).patch(
        f"/api/v1/rooms/{room_id}/status", json={"status": "closed"}, headers=h
    )
    assert to_closed.status_code == 200
    back = await _c(client).patch(
        f"/api/v1/rooms/{room_id}/status", json={"status": "available"}, headers=h
    )
    assert back.status_code == 200

    house = await login(client, "house01", SEED_PASSWORD)
    log = await _c(client).get(f"/api/v1/rooms/{room_id}/status-log", headers=auth_header(house))
    assert log.status_code == 200
    rows = log.json()
    assert (rows[0]["old_status"], rows[0]["new_status"]) == ("closed", "available")
    assert (rows[1]["old_status"], rows[1]["new_status"]) == ("available", "closed")
    assert rows[0]["changed_by_name"]  # the receptionist's name, not an id

    guest = await login(client, "somchai", SEED_PASSWORD)
    denied = await _c(client).get(f"/api/v1/rooms/{room_id}/status-log", headers=auth_header(guest))
    assert denied.status_code == 403
    missing = await _c(client).get("/api/v1/rooms/999999/status-log", headers=auth_header(house))
    assert missing.status_code == 404


async def test_checkout_trigger_and_housekeeping_moves_are_logged(
    client: object, db: object
) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    room = await _free_room_today(db)
    b = await make_booking(client, staff, customer_id=11, room_id=room, days_ahead=8300)
    await arrive_now(b["booking_id"])
    assert await transition(client, staff, b["booking_id"], "check-in") == 200
    assert await transition(client, staff, b["booking_id"], "check-out") == 200

    log = (
        await _c(client).get(f"/api/v1/rooms/{room}/status-log", headers=auth_header(staff))
    ).json()
    assert (log[0]["old_status"], log[0]["new_status"]) == ("available", "cleaning")

    # the housekeeper finishes the trigger-made task -> room back on sale, logged
    house = await login(client, "house01", SEED_PASSWORD)
    hh = auth_header(house)
    tasks = (
        await _c(client).get(
            "/api/v1/housekeeping/tasks", params={"room_id": room, "status": "pending"}, headers=hh
        )
    ).json()
    task = next(t for t in tasks if t["booking_id"] == b["booking_id"])
    # a 2-night stay checked out on day one: the clean is today's job, not the
    # planned departure day's, so it is on today's board
    assert task["scheduled_for"] == date.today().isoformat()
    board = (
        await _c(client).get(
            "/api/v1/housekeeping/board", params={"day": date.today().isoformat()}, headers=hh
        )
    ).json()
    assert task["task_id"] in {r["task_id"] for r in board}
    me = (await _c(client).get("/api/v1/auth/me", headers=hh)).json()
    await _c(client).patch(
        f"/api/v1/housekeeping/tasks/{task['task_id']}",
        json={"assigned_to": me["staff_id"], "status": "in_progress"},
        headers=hh,
    )
    done = await _c(client).patch(
        f"/api/v1/housekeeping/tasks/{task['task_id']}", json={"status": "done"}, headers=hh
    )
    assert done.status_code == 200
    log = (await _c(client).get(f"/api/v1/rooms/{room}/status-log", headers=hh)).json()
    assert (log[0]["old_status"], log[0]["new_status"]) == ("cleaning", "available")
    assert log[0]["changed_by"] == me["staff_id"]


# ============================================================ sign-in log


async def test_admin_reads_the_sign_in_log(client: object) -> None:
    bad = await _c(client).post(
        "/api/v1/auth/login", json={"username": "no_such_user_xyz", "password": "wrong-pass"}
    )
    assert bad.status_code == 401

    admin = await login(client, "admin01", SEED_PASSWORD)
    h = auth_header(admin)
    page = await _c(client).get(
        "/api/v1/admin/auth-events",
        params={"event_type": "login_fail", "q": "no_such_user_xyz"},
        headers=h,
    )
    assert page.status_code == 200
    body = page.json()
    assert body["total"] >= 1
    row = body["items"][0]
    assert row["username"] == "no_such_user_xyz"
    assert row["user_id"] is None and row["event_type"] == "login_fail"

    ok = await _c(client).get(
        "/api/v1/admin/auth-events", params={"event_type": "login_success"}, headers=h
    )
    first = ok.json()["items"][0]
    assert first["role"] is not None and first["username"]

    stats = await _c(client).get("/api/v1/admin/auth-events/stats", headers=h)
    assert stats.status_code == 200
    s = stats.json()
    assert s["days"] == 7 and s["login_success"] >= 1 and s["login_fail"] >= 1
    assert s["distinct_users"] >= 1

    manager = await login(client, "manager01", SEED_PASSWORD)
    denied = await _c(client).get("/api/v1/admin/auth-events", headers=auth_header(manager))
    assert denied.status_code == 403


# ================================================================== views


async def test_in_house_list_reads_v_current_guests(client: object, db: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    room = await _free_room_today(db)
    b = await make_booking(client, staff, customer_id=12, room_id=room, days_ahead=8400)
    await arrive_now(b["booking_id"])
    assert await transition(client, staff, b["booking_id"], "check-in") == 200

    resp = await _c(client).get("/api/v1/reports/in-house", headers=auth_header(staff))
    assert resp.status_code == 200
    row = next(r for r in resp.json() if r["booking_id"] == b["booking_id"])
    assert row["check_in_date"] == date.today().isoformat()
    assert row["num_guests"] == 2
    assert Decimal(row["balance_due"]) == Decimal(b["grand_total"])
    assert row["customer_name"] == b["customer_name"]

    view_count = (
        await cast(Any, db).execute(text("SELECT COUNT(*) FROM v_current_guests"))
    ).scalar_one()
    assert len(resp.json()) == view_count

    house = await login(client, "house01", SEED_PASSWORD)
    denied = await _c(client).get("/api/v1/reports/in-house", headers=auth_header(house))
    assert denied.status_code == 403
    await transition(client, staff, b["booking_id"], "check-out")


async def test_housekeeping_board_reads_the_view(client: object) -> None:
    house = await login(client, "house01", SEED_PASSWORD)
    h = auth_header(house)
    day = (date.today() + timedelta(days=30)).isoformat()
    made = await _c(client).post(
        "/api/v1/housekeeping/tasks",
        json={"room_id": 43, "task_type": "inspection", "scheduled_for": day, "note": "VIP"},
        headers=h,
    )
    assert made.status_code == 201
    board = await _c(client).get("/api/v1/housekeeping/board", params={"day": day}, headers=h)
    assert board.status_code == 200
    row = next(r for r in board.json() if r["task_id"] == made.json()["task_id"])
    assert row["task_type"] == "inspection" and row["note"] == "VIP"
    assert row["room_number"] and row["floor"] >= 0 and row["room_status"]
    floors = [r["floor"] for r in board.json()]
    assert floors == sorted(floors)


async def test_maintenance_backlog_reads_the_view(client: object) -> None:
    house = await login(client, "house01", SEED_PASSWORD)
    h = auth_header(house)
    made = await _c(client).post(
        "/api/v1/maintenance/tickets",
        json={"title": "Lobby light flickers", "category": "electrical", "priority": "urgent"},
        headers=h,
    )
    assert made.status_code == 201
    tid = made.json()["ticket_id"]
    backlog = (await _c(client).get("/api/v1/maintenance/backlog", headers=h)).json()
    row = next(r for r in backlog if r["ticket_id"] == tid)
    assert row["age_days"] == 0 and row["room_number"] is None  # a common area
    assert backlog[0]["priority"] == "urgent"  # the view sorts urgent first

    await _c(client).patch(
        f"/api/v1/maintenance/tickets/{tid}",
        json={"status": "resolved", "resolution": "Replaced the ballast"},
        headers=h,
    )
    backlog = (await _c(client).get("/api/v1/maintenance/backlog", headers=h)).json()
    assert tid not in {r["ticket_id"] for r in backlog}


# ============================================================== guests


async def test_front_desk_records_guest_id_and_contact(client: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    h = auth_header(staff)
    cid = 15
    upd = await _c(client).patch(
        f"/api/v1/customers/{cid}",
        json={"id_card_no": "1-1037-00123-45-6", "phone": "+66 81 234 5678"},
        headers=h,
    )
    assert upd.status_code == 200, upd.text
    assert upd.json()["id_card_no"] == "1-1037-00123-45-6"
    assert upd.json()["phone"] == "+66 81 234 5678"

    detail = (await _c(client).get(f"/api/v1/customers/{cid}", headers=h)).json()
    assert detail["id_card_no"] == "1-1037-00123-45-6"

    # the audit trail names the fields, never the ID number itself
    manager = await login(client, "manager01", SEED_PASSWORD)
    audit = await _c(client).get(
        "/api/v1/admin/audit",
        params={"entity_type": "customer", "action": "customer.update"},
        headers=auth_header(manager),
    )
    entry = audit.json()["items"][0]
    assert "00123" not in f"{entry['summary']} {entry['data']}"
    assert entry["data"] == {"fields": ["id_card_no", "phone"]}

    cleared = await _c(client).patch(
        f"/api/v1/customers/{cid}", json={"id_card_no": None}, headers=h
    )
    assert cleared.json()["id_card_no"] is None

    bad_phone = await _c(client).patch(
        f"/api/v1/customers/{cid}", json={"phone": "call me"}, headers=h
    )
    assert bad_phone.status_code == 422
    blank = await _c(client).patch(f"/api/v1/customers/{cid}", json={"first_name": ""}, headers=h)
    assert blank.status_code == 422
    missing = await _c(client).patch("/api/v1/customers/999999", json={"phone": "1"}, headers=h)
    assert missing.status_code == 404

    guest = await login(client, "somchai", SEED_PASSWORD)
    denied = await _c(client).patch(
        f"/api/v1/customers/{cid}", json={"phone": "1"}, headers=auth_header(guest)
    )
    assert denied.status_code == 403


async def test_cancelled_stay_owes_nothing_in_guest_history(client: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    h = auth_header(staff)
    b = await make_booking(client, staff, customer_id=16, room_id=44, days_ahead=8500)
    assert await transition(client, staff, b["booking_id"], "cancel") == 200
    detail = (await _c(client).get("/api/v1/customers/16", headers=h)).json()
    row = next(r for r in detail["recent_bookings"] if r["booking_id"] == b["booking_id"])
    assert row["status"] == "cancelled"
    assert Decimal(row["balance_due"]) == Decimal("0")


# ============================================================ room types


async def test_manager_edits_a_room_type(client: object) -> None:
    manager = await login(client, "manager01", SEED_PASSWORD)
    h = auth_header(manager)
    types = (await _c(client).get("/api/v1/room-types")).json()
    rt = next(t for t in types if t["room_type_id"] == 5)
    original = {
        "description": rt["description"],
        "base_price_per_night": rt["base_price_per_night"],
        "max_occupancy": rt["max_occupancy"],
    }
    try:
        upd = await _c(client).patch(
            "/api/v1/room-types/5",
            json={"description": "Refreshed suite", "max_occupancy": 3},
            headers=h,
        )
        assert upd.status_code == 200, upd.text
        assert upd.json()["description"] == "Refreshed suite"
        assert upd.json()["max_occupancy"] == 3
        assert upd.json()["name"] == rt["name"]  # the name is not editable

        renamed = await _c(client).patch("/api/v1/room-types/5", json={"name": "Other"}, headers=h)
        assert renamed.status_code == 422
        nulled = await _c(client).patch(
            "/api/v1/room-types/5", json={"max_occupancy": None}, headers=h
        )
        assert nulled.status_code == 409

        recep = await login(client, "recep01", SEED_PASSWORD)
        denied = await _c(client).patch(
            "/api/v1/room-types/5", json={"description": "x"}, headers=auth_header(recep)
        )
        assert denied.status_code == 403
    finally:
        restore = await _c(client).patch("/api/v1/room-types/5", json=original, headers=h)
        assert restore.status_code == 200


# ================================================================= staff


async def test_user_list_shows_the_person_and_disabling_staff_drops_them_from_rosters(
    client: object,
) -> None:
    admin = await login(client, "admin01", SEED_PASSWORD)
    h = auth_header(admin)
    staff = (
        await _c(client).get("/api/v1/admin/users", params={"kind": "staff"}, headers=h)
    ).json()["items"]
    house02 = next(u for u in staff if u["username"] == "house02")
    assert house02["full_name"] and house02["hired_at"]

    guests = (
        await _c(client).get(
            "/api/v1/admin/users", params={"kind": "guest", "q": "somchai"}, headers=h
        )
    ).json()["items"]
    assert guests[0]["full_name"] and guests[0]["hired_at"] is None

    def roster_ids(resp: Any) -> set[int]:
        return {s["staff_id"] for s in resp.json()}

    try:
        await _c(client).patch(
            f"/api/v1/admin/users/{house02['user_id']}", json={"is_active": False}, headers=h
        )
        roster = await _c(client).get(
            "/api/v1/admin/staff", params={"role": "housekeeping"}, headers=h
        )
        assert house02["staff_id"] not in roster_ids(roster)
    finally:
        await _c(client).patch(
            f"/api/v1/admin/users/{house02['user_id']}", json={"is_active": True}, headers=h
        )
    roster = await _c(client).get("/api/v1/admin/staff", params={"role": "housekeeping"}, headers=h)
    assert house02["staff_id"] in roster_ids(roster)


async def test_only_the_desk_or_the_guest_changes_a_stay(client: object) -> None:
    """Housekeeping and accounting may read a booking for their own work, but
    cancelling, moving or settling it is the desk's (or the guest's) job."""
    staff = await login(client, "recep01", SEED_PASSWORD)
    b = await make_booking(client, staff, customer_id=17, room_id=45, days_ahead=8600)
    bid = b["booking_id"]
    start = date.fromisoformat(b["check_in_date"]) + timedelta(days=1)
    for user in ("house01", "acct01"):
        h = auth_header(await login(client, user, SEED_PASSWORD))
        assert (await _c(client).get(f"/api/v1/bookings/{bid}", headers=h)).status_code == 200
        cancel = await _c(client).post(f"/api/v1/bookings/{bid}/cancel", headers=h)
        assert cancel.status_code == 403
        move = await _c(client).patch(
            f"/api/v1/bookings/{bid}/dates",
            json={
                "check_in_date": start.isoformat(),
                "check_out_date": (start + timedelta(days=2)).isoformat(),
            },
            headers=h,
        )
        assert move.status_code == 403
        pay = await _c(client).post(
            f"/api/v1/bookings/{bid}/pay", json={"method": "promptpay"}, headers=h
        )
        assert pay.status_code == 403
    still = await _c(client).get(f"/api/v1/bookings/{bid}", headers=auth_header(staff))
    assert still.json()["status"] == "confirmed"
    assert (
        await _c(client).post(f"/api/v1/bookings/{bid}/cancel", headers=auth_header(staff))
    ).status_code == 200
