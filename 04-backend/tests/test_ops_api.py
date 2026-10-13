"""Module 11 - the operations API: rate plans, invoices, housekeeping,
maintenance, audit and user administration, plus the RBAC around them."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Any, cast

from tests.conftest import SEED_PASSWORD, arrive_now, auth_header, login, make_booking, settle


async def _get(client: object, url: str, token: str) -> Any:
    return await cast(Any, client).get(url, headers=auth_header(token))


# ------------------------------------------------------------- rate plans


async def test_quote_is_public_and_prices_by_night(client: object) -> None:
    resp = await cast(Any, client).get(
        "/api/v1/rate-plans/quote",
        params={"room_type_id": 5, "check_in": "2026-12-30", "check_out": "2027-01-02"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["nights"] == 3
    assert Decimal(body["total"]) == Decimal("15600.00")  # 3 × high-season 5200
    assert Decimal(body["average_per_night"]) == Decimal("5200.00")
    assert Decimal(body["base_price_per_night"]) == Decimal("3800.00")
    assert [n["night"] for n in body["breakdown"]] == ["2026-12-30", "2026-12-31", "2027-01-01"]


async def test_quote_rejects_inverted_dates(client: object) -> None:
    resp = await cast(Any, client).get(
        "/api/v1/rate-plans/quote",
        params={"room_type_id": 1, "check_in": "2026-10-05", "check_out": "2026-10-05"},
    )
    assert resp.status_code == 409


async def test_manager_can_create_and_deactivate_a_plan(client: object) -> None:
    token = await login(client, "manager01", SEED_PASSWORD)
    created = await cast(Any, client).post(
        "/api/v1/rate-plans",
        json={
            "room_type_id": 1,
            "name": "Songkran 2027",
            "kind": "seasonal",
            "price_per_night": "1600.00",
            "valid_from": "2027-04-11",
            "valid_to": "2027-04-16",
            "priority": 60,
        },
        headers=auth_header(token),
    )
    assert created.status_code == 201, created.text
    plan_id = created.json()["rate_plan_id"]
    assert created.json()["room_type_name"] == "Cityview Room"

    quoted = await cast(Any, client).get(
        "/api/v1/rate-plans/quote",
        params={"room_type_id": 1, "check_in": "2027-04-13", "check_out": "2027-04-14"},
    )
    assert Decimal(quoted.json()["total"]) == Decimal("1600.00")

    off = await cast(Any, client).patch(
        f"/api/v1/rate-plans/{plan_id}",
        json={"is_active": False},
        headers=auth_header(token),
    )
    assert off.status_code == 200 and off.json()["is_active"] is False

    requoted = await cast(Any, client).get(
        "/api/v1/rate-plans/quote",
        params={"room_type_id": 1, "check_in": "2027-04-13", "check_out": "2027-04-14"},
    )
    assert Decimal(requoted.json()["total"]) == Decimal("900.00")  # back to base

    await cast(Any, client).delete(f"/api/v1/rate-plans/{plan_id}", headers=auth_header(token))


async def test_receptionist_cannot_change_prices(client: object) -> None:
    token = await login(client, "recep01", SEED_PASSWORD)
    resp = await cast(Any, client).post(
        "/api/v1/rate-plans",
        json={
            "room_type_id": 1,
            "name": "nope",
            "price_per_night": "1.00",
            "valid_from": "2027-01-01",
            "valid_to": "2027-01-02",
        },
        headers=auth_header(token),
    )
    assert resp.status_code == 403


async def test_booking_snapshots_the_rate_plan_price(client: object) -> None:
    """A New-Year stay must bill the seasonal rate, not the list price."""
    staff = await login(client, "recep01", SEED_PASSWORD)
    resp = await cast(Any, client).post(
        "/api/v1/bookings",
        json={
            "customer_id": 1,
            "check_in_date": "2026-12-30",
            "check_out_date": "2027-01-02",
            "rooms": [{"room_type_id": 5}],
        },
        headers=auth_header(staff),
    )
    assert resp.status_code == 201, resp.text
    assert Decimal(resp.json()["rooms"][0]["price_per_night"]) == Decimal("5200.00")

    bill = await _get(client, f"/api/v1/bookings/{resp.json()['booking_id']}/bill", staff)
    assert Decimal(bill.json()["room_total"]) == Decimal("15600.00")


# ---------------------------------------------------------------- invoices


async def test_issue_invoice_itemises_the_booking(client: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    booking = await make_booking(
        client,
        staff,
        customer_id=2,
        room_id=5,
        nights=2,
        days_ahead=3300,
        services=[{"service_id": 1, "quantity": 2}],
    )
    bid = booking["booking_id"]

    resp = await cast(Any, client).post(
        f"/api/v1/bookings/{bid}/invoice", json={}, headers=auth_header(staff)
    )
    assert resp.status_code == 201, resp.text
    inv = resp.json()
    assert inv["invoice_no"].startswith("INV-")
    kinds = [line["line_type"] for line in inv["lines"]]
    assert "room" in kinds and "service" in kinds
    # VAT is worked back out of the gross figures
    assert Decimal(inv["subtotal"]) + Decimal(inv["tax_amount"]) == Decimal(inv["total"])

    dupe = await cast(Any, client).post(
        f"/api/v1/bookings/{bid}/invoice", json={}, headers=auth_header(staff)
    )
    assert dupe.status_code == 409


async def test_guest_sees_only_their_own_invoice(client: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    booking = await make_booking(client, staff, customer_id=2, room_id=6, days_ahead=3400)
    bid = booking["booking_id"]
    await cast(Any, client).post(
        f"/api/v1/bookings/{bid}/invoice", json={}, headers=auth_header(staff)
    )

    # anna owns customer 2; somchai (customer 1) must not see it
    anna = await login(client, "anna", SEED_PASSWORD)
    somchai = await login(client, "somchai", SEED_PASSWORD)
    assert (await _get(client, f"/api/v1/bookings/{bid}/invoice", anna)).status_code == 200
    assert (await _get(client, f"/api/v1/bookings/{bid}/invoice", somchai)).status_code == 404


async def test_only_accounting_reads_the_ledger(client: object) -> None:
    acct = await login(client, "acct01", SEED_PASSWORD)
    assert (await _get(client, "/api/v1/invoices", acct)).status_code == 200

    recep = await login(client, "recep01", SEED_PASSWORD)
    assert (await _get(client, "/api/v1/invoices", recep)).status_code == 403


async def test_invoice_ledger_paginates_searches_and_totals(client: object) -> None:
    """The ledger is a real page envelope: offset walks the whole ledger, `q`
    finds one stay, and `/stats` tallies every invoice, not just a page."""
    staff = await login(client, "recep01", SEED_PASSWORD)
    acct = await login(client, "acct01", SEED_PASSWORD)

    made: list[tuple[int, str]] = []
    for cid, rid in ((2, 10), (3, 11)):
        booking = await make_booking(client, staff, customer_id=cid, room_id=rid, days_ahead=3500)
        resp = await cast(Any, client).post(
            f"/api/v1/bookings/{booking['booking_id']}/invoice",
            json={},
            headers=auth_header(staff),
        )
        assert resp.status_code == 201, resp.text
        made.append((int(booking["booking_id"]), resp.json()["invoice_no"]))

    page = (await _get(client, "/api/v1/invoices?limit=5", acct)).json()
    assert set(page) == {"items", "total", "limit", "offset"}
    assert page["total"] >= len(made)
    assert len(page["items"]) == min(5, page["total"])

    # a second page does not repeat rows from the first
    p2 = (await _get(client, "/api/v1/invoices?limit=5&offset=5", acct)).json()
    first = {row["invoice_id"] for row in page["items"]}
    assert first.isdisjoint({row["invoice_id"] for row in p2["items"]})

    # search by booking ref narrows to exactly that stay's invoice
    bid, inv_no = made[0]
    hit = (await _get(client, f"/api/v1/invoices?q=TIG-{bid}", acct)).json()
    assert [row["invoice_no"] for row in hit["items"]] == [inv_no]

    stats = (await _get(client, "/api/v1/invoices/stats", acct)).json()
    assert set(stats) == {"outstanding", "issued", "paid", "void", "draft"}
    assert stats["issued"] + stats["paid"] + stats["void"] + stats["draft"] == page["total"]
    assert Decimal(stats["outstanding"]) >= 0

    assert (await _get(client, "/api/v1/invoices/stats", staff)).status_code == 403


async def test_daily_revenue_is_accounting_only(client: object) -> None:
    acct = await login(client, "acct01", SEED_PASSWORD)
    resp = await _get(client, "/api/v1/reports/daily-revenue", acct)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)

    house = await login(client, "house01", SEED_PASSWORD)
    assert (await _get(client, "/api/v1/reports/daily-revenue", house)).status_code == 403


# ------------------------------------------------------------ housekeeping


async def test_housekeeper_works_a_task_and_frees_the_room(client: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    booking = await make_booking(client, staff, customer_id=3, room_id=8, days_ahead=3500)
    bid = booking["booking_id"]
    await arrive_now(bid)
    await settle(client, staff, bid)
    for action in ("check-in", "check-out"):
        await cast(Any, client).post(f"/api/v1/bookings/{bid}/{action}", headers=auth_header(staff))

    house = await login(client, "house01", SEED_PASSWORD)
    tasks = await _get(client, "/api/v1/housekeeping/tasks?room_id=8", house)
    assert tasks.status_code == 200
    task = next(t for t in tasks.json() if t["booking_id"] == bid)
    assert task["status"] == "pending"
    assert task["room_number"] == "204"  # the label, not a bare id

    rooms = await _get(client, "/api/v1/rooms?limit=100", staff)
    assert next(r for r in rooms.json()["items"] if r["room_id"] == 8)["status"] == "cleaning"

    done = await cast(Any, client).patch(
        f"/api/v1/housekeeping/tasks/{task['task_id']}",
        json={"status": "done", "assigned_to": 6},
        headers=auth_header(house),
    )
    assert done.status_code == 200
    assert done.json()["completed_at"] is not None
    assert done.json()["assigned_to_name"]

    rooms = await _get(client, "/api/v1/rooms?limit=100", staff)
    assert next(r for r in rooms.json()["items"] if r["room_id"] == 8)["status"] == "available"


async def test_guest_cannot_see_the_housekeeping_board(client: object) -> None:
    token = await login(client, "somchai", SEED_PASSWORD)
    assert (await _get(client, "/api/v1/housekeeping/tasks", token)).status_code == 403


async def test_unassigned_task_cannot_leave_pending(client: object) -> None:
    """A cleaner has to own a task before it can move off 'pending'; once it is
    'done' the assignee is frozen."""
    staff = await login(client, "recep01", SEED_PASSWORD)
    booking = await make_booking(client, staff, customer_id=3, room_id=9, days_ahead=3600)
    bid = booking["booking_id"]
    await arrive_now(bid)
    await settle(client, staff, bid)
    for action in ("check-in", "check-out"):
        await cast(Any, client).post(f"/api/v1/bookings/{bid}/{action}", headers=auth_header(staff))

    house = await login(client, "house01", SEED_PASSWORD)
    tasks = await _get(client, "/api/v1/housekeeping/tasks?room_id=9", house)
    task = next(t for t in tasks.json() if t["booking_id"] == bid)
    assert task["status"] == "pending" and task["assigned_to"] is None

    tid = task["task_id"]
    blocked = await cast(Any, client).patch(
        f"/api/v1/housekeeping/tasks/{tid}",
        json={"status": "in_progress"},
        headers=auth_header(house),
    )
    assert blocked.status_code == 409
    assert blocked.json()["code"] == "unassigned"

    # assign, then it may start
    await cast(Any, client).patch(
        f"/api/v1/housekeeping/tasks/{tid}", json={"assigned_to": 6}, headers=auth_header(house)
    )
    started = await cast(Any, client).patch(
        f"/api/v1/housekeeping/tasks/{tid}",
        json={"status": "in_progress"},
        headers=auth_header(house),
    )
    assert started.status_code == 200

    # finish it, then the assignee is locked
    await cast(Any, client).patch(
        f"/api/v1/housekeeping/tasks/{tid}", json={"status": "done"}, headers=auth_header(house)
    )
    frozen = await cast(Any, client).patch(
        f"/api/v1/housekeeping/tasks/{tid}", json={"assigned_to": 7}, headers=auth_header(house)
    )
    assert frozen.status_code == 409
    assert frozen.json()["code"] == "bad_state"


async def test_flagging_a_room_cleaning_opens_a_housekeeping_task(client: object) -> None:
    """Setting a room to 'cleaning' on the Rooms board must surface on the
    housekeeping board, and doing it twice must not pile up duplicate tasks."""
    manager = await login(client, "manager01", SEED_PASSWORD)
    made = await cast(Any, client).post(
        "/api/v1/rooms",
        json={"room_number": "9970", "floor": 9, "room_type_id": 1},
        headers=auth_header(manager),
    )
    assert made.status_code == 201, made.text
    room_id = made.json()["room_id"]

    recep = await login(client, "recep01", SEED_PASSWORD)
    for _ in range(2):
        flip = await cast(Any, client).patch(
            f"/api/v1/rooms/{room_id}/status",
            json={"status": "cleaning"},
            headers=auth_header(recep),
        )
        assert flip.status_code == 200

    board = await _get(client, f"/api/v1/housekeeping/tasks?room_id={room_id}", recep)
    open_tasks = [t for t in board.json() if t["status"] in ("pending", "in_progress")]
    assert len(open_tasks) == 1
    assert open_tasks[0]["task_type"] == "deep_clean"


async def test_housekeeping_flags_rooms_with_an_arrival_today(client: object) -> None:
    """A cleaning task on a room a guest checks into today is flagged so the
    board can float it to the top."""
    manager = await login(client, "manager01", SEED_PASSWORD)
    staff = await login(client, "recep01", SEED_PASSWORD)
    house = await login(client, "house01", SEED_PASSWORD)

    async def new_room(number: str) -> int:
        made = await cast(Any, client).post(
            "/api/v1/rooms",
            json={"room_number": number, "floor": 9, "room_type_id": 1},
            headers=auth_header(manager),
        )
        return int(made.json()["room_id"])

    async def new_task(room_id: int) -> int:
        made = await cast(Any, client).post(
            "/api/v1/housekeeping/tasks",
            json={"room_id": room_id, "task_type": "checkout_clean"},
            headers=auth_header(house),
        )
        return int(made.json()["task_id"])

    arrival_room = await new_room("9995")
    quiet_room = await new_room("9996")
    arrival_task = await new_task(arrival_room)
    quiet_task = await new_task(quiet_room)

    # a confirmed booking that checks in today, into the arrival room
    booked = await cast(Any, client).post(
        "/api/v1/bookings",
        json={
            "customer_id": 5,
            "check_in_date": date.today().isoformat(),
            "check_out_date": (date.today() + timedelta(days=2)).isoformat(),
            "rooms": [{"room_id": arrival_room}],
        },
        headers=auth_header(staff),
    )
    assert booked.status_code == 201, booked.text

    board = await _get(client, "/api/v1/housekeeping/tasks?status=pending", house)
    by_id = {t["task_id"]: t for t in board.json()}
    assert by_id[arrival_task]["arriving_today"] is True
    assert by_id[quiet_task]["arriving_today"] is False


async def test_auto_assign_load_balances_across_the_team(client: object) -> None:
    house = await login(client, "house01", SEED_PASSWORD)
    # a handful of fresh unassigned tasks
    for floor_room in ("9980", "9981", "9982", "9983", "9984"):
        mgr = await login(client, "manager01", SEED_PASSWORD)
        made = await cast(Any, client).post(
            "/api/v1/rooms",
            json={"room_number": floor_room, "floor": 9, "room_type_id": 1},
            headers=auth_header(mgr),
        )
        rid = made.json()["room_id"]
        await cast(Any, client).post(
            "/api/v1/housekeeping/tasks",
            json={"room_id": rid, "task_type": "deep_clean"},
            headers=auth_header(house),
        )

    resp = await cast(Any, client).post(
        "/api/v1/housekeeping/auto-assign", headers=auth_header(house)
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["assigned"] >= 5
    # spread across the team, not dumped on one person
    assert len(body["by_staff"]) >= 2

    # every pending task now has an owner
    board = await _get(client, "/api/v1/housekeeping/tasks?status=pending", house)
    pending = board.json()
    assert all(t["assigned_to"] is not None for t in pending)
    assert len({t["assigned_to"] for t in pending}) >= 2  # balanced, not one-and-done

    # a second run has nothing left to do
    again = await cast(Any, client).post(
        "/api/v1/housekeeping/auto-assign", headers=auth_header(house)
    )
    assert again.json()["assigned"] == 0


async def test_auto_assign_puts_arrival_rooms_first_in_the_queue(client: object) -> None:
    """A task on a room with a guest arriving today is handed out before a task
    that was created earlier on a quiet room."""
    manager = await login(client, "manager01", SEED_PASSWORD)
    staff = await login(client, "recep01", SEED_PASSWORD)
    house = await login(client, "house01", SEED_PASSWORD)

    async def new_room(number: str) -> int:
        made = await cast(Any, client).post(
            "/api/v1/rooms",
            json={"room_number": number, "floor": 9, "room_type_id": 1},
            headers=auth_header(manager),
        )
        return int(made.json()["room_id"])

    quiet_room = await new_room("9975")
    arrival_room = await new_room("9976")

    # quiet task first (lower id), then the arrival-room task (higher id)
    quiet_task = (
        await cast(Any, client).post(
            "/api/v1/housekeeping/tasks",
            json={"room_id": quiet_room, "task_type": "deep_clean"},
            headers=auth_header(house),
        )
    ).json()["task_id"]
    arrival_task = (
        await cast(Any, client).post(
            "/api/v1/housekeeping/tasks",
            json={"room_id": arrival_room, "task_type": "deep_clean"},
            headers=auth_header(house),
        )
    ).json()["task_id"]

    booked = await cast(Any, client).post(
        "/api/v1/bookings",
        json={
            "customer_id": 7,
            "check_in_date": date.today().isoformat(),
            "check_out_date": (date.today() + timedelta(days=1)).isoformat(),
            "rooms": [{"room_id": arrival_room}],
        },
        headers=auth_header(staff),
    )
    assert booked.status_code == 201, booked.text

    assert (
        await cast(Any, client).post("/api/v1/housekeeping/auto-assign", headers=auth_header(house))
    ).status_code == 200

    listing = (await _get(client, "/api/v1/housekeeping/tasks", house)).json()
    board = {t["task_id"]: t for t in listing}
    # both got an owner; the arrival task is processed first and stays flagged
    assert board[arrival_task]["assigned_to"] is not None
    assert board[quiet_task]["assigned_to"] is not None
    assert board[arrival_task]["arriving_today"] is True


# ------------------------------------------------------------- maintenance


async def test_report_and_resolve_a_ticket(client: object) -> None:
    house = await login(client, "house01", SEED_PASSWORD)
    created = await cast(Any, client).post(
        "/api/v1/maintenance/tickets",
        json={"room_id": 3, "category": "electrical", "priority": "high", "title": "Lamp flickers"},
        headers=auth_header(house),
    )
    assert created.status_code == 201, created.text
    ticket = created.json()
    assert ticket["room_number"] == "103"
    assert ticket["reported_by_name"]
    assert ticket["resolved_at"] is None

    resolved = await cast(Any, client).patch(
        f"/api/v1/maintenance/tickets/{ticket['ticket_id']}",
        json={"status": "resolved", "resolution": "Replaced the bulb"},
        headers=auth_header(house),
    )
    assert resolved.status_code == 200
    # the DB CHECK demands a timestamp on a resolved ticket - the service sets it
    assert resolved.json()["resolved_at"] is not None


async def test_open_tickets_come_back_urgent_first(client: object) -> None:
    token = await login(client, "recep01", SEED_PASSWORD)
    resp = await _get(client, "/api/v1/maintenance/tickets?open_only=true", token)
    assert resp.status_code == 200
    assert resp.json()[0]["priority"] == "urgent"


async def test_a_room_fault_pulls_the_room_off_the_board_and_puts_it_back(client: object) -> None:
    mgr = await login(client, "manager01", SEED_PASSWORD)
    made = await cast(Any, client).post(
        "/api/v1/rooms",
        json={"room_number": "9990", "floor": 9, "room_type_id": 1},
        headers=auth_header(mgr),
    )
    rid = made.json()["room_id"]

    async def room_status() -> str:
        rooms = await _get(client, "/api/v1/rooms?limit=300", mgr)
        return next(r for r in rooms.json()["items"] if r["room_id"] == rid)["status"]

    assert await room_status() == "available"

    house = await login(client, "house01", SEED_PASSWORD)
    t1 = (
        await cast(Any, client).post(
            "/api/v1/maintenance/tickets",
            json={"room_id": rid, "category": "hvac", "priority": "high", "title": "AC dead"},
            headers=auth_header(house),
        )
    ).json()
    assert await room_status() == "maintenance"  # off the board

    # a second open ticket keeps it off the board even after the first is fixed
    t2 = (
        await cast(Any, client).post(
            "/api/v1/maintenance/tickets",
            json={"room_id": rid, "category": "plumbing", "priority": "normal", "title": "Leak"},
            headers=auth_header(house),
        )
    ).json()
    await cast(Any, client).patch(
        f"/api/v1/maintenance/tickets/{t1['ticket_id']}",
        json={"status": "resolved", "resolution": "swapped compressor"},
        headers=auth_header(house),
    )
    assert await room_status() == "maintenance"

    await cast(Any, client).patch(
        f"/api/v1/maintenance/tickets/{t2['ticket_id']}",
        json={"status": "resolved", "resolution": "sealed the joint"},
        headers=auth_header(house),
    )
    assert await room_status() == "available"  # last ticket cleared - back on sale


# ------------------------------------------------------- admin & audit log


async def test_audit_trail_records_api_actions(client: object) -> None:
    manager = await login(client, "manager01", SEED_PASSWORD)
    house = await login(client, "house01", SEED_PASSWORD)
    await cast(Any, client).post(
        "/api/v1/maintenance/tickets",
        json={"title": "Lobby door sticks", "priority": "low"},
        headers=auth_header(house),
    )
    resp = await _get(client, "/api/v1/admin/audit?entity_type=maintenance_ticket", manager)
    assert resp.status_code == 200
    assert any(r["actor_label"] == "house01" for r in resp.json()["items"])


async def test_audit_is_not_public(client: object) -> None:
    token = await login(client, "recep01", SEED_PASSWORD)
    assert (await _get(client, "/api/v1/admin/audit", token)).status_code == 403


async def test_audit_trail_paginates(client: object) -> None:
    """The trail is a page envelope now - offset walks back through history and
    the total counts every matching entry, not just the page."""
    staff = await login(client, "recep01", SEED_PASSWORD)
    # one fresh row on top (booking.create is audited); the suite has logged many more
    await make_booking(client, staff, customer_id=2, room_id=7, days_ahead=3700)

    manager = await login(client, "manager01", SEED_PASSWORD)
    page = (await _get(client, "/api/v1/admin/audit?limit=5", manager)).json()
    assert set(page) == {"items", "total", "limit", "offset"}
    assert page["total"] >= 5
    assert len(page["items"]) == 5
    ids = [r["audit_id"] for r in page["items"]]
    assert ids == sorted(ids, reverse=True)  # newest first

    p2 = (await _get(client, "/api/v1/admin/audit?limit=5&offset=5", manager)).json()
    assert {r["audit_id"] for r in page["items"]}.isdisjoint(r["audit_id"] for r in p2["items"])

    # a filter narrows the total too
    only = (await _get(client, "/api/v1/admin/audit?action=booking.create&limit=5", manager)).json()
    assert only["total"] >= 1
    assert all(r["action"] == "booking.create" for r in only["items"])


async def test_admin_can_change_a_role_but_not_their_own(client: object) -> None:
    admin = await login(client, "admin01", SEED_PASSWORD)
    users = await _get(client, "/api/v1/admin/users?kind=staff&limit=100", admin)
    assert users.status_code == 200
    me = next(u for u in users.json()["items"] if u["username"] == "admin01")
    other = next(u for u in users.json()["items"] if u["username"] == "recep02")

    self_demote = await cast(Any, client).patch(
        f"/api/v1/admin/users/{me['user_id']}",
        json={"role": "receptionist"},
        headers=auth_header(admin),
    )
    assert self_demote.status_code == 403

    promoted = await cast(Any, client).patch(
        f"/api/v1/admin/users/{other['user_id']}",
        json={"role": "accounting"},
        headers=auth_header(admin),
    )
    assert promoted.status_code == 200 and promoted.json()["role"] == "accounting"
    # put it back so later tests see the seeded world
    await cast(Any, client).patch(
        f"/api/v1/admin/users/{other['user_id']}",
        json={"role": "receptionist"},
        headers=auth_header(admin),
    )


async def test_a_staff_account_cannot_become_a_customer(client: object) -> None:
    """`chk_user_identity` in schema.sql ties the role to the linked record."""
    admin = await login(client, "admin01", SEED_PASSWORD)
    users = await _get(client, "/api/v1/admin/users?kind=staff&limit=100", admin)
    recep = next(u for u in users.json()["items"] if u["username"] == "recep01")
    resp = await cast(Any, client).patch(
        f"/api/v1/admin/users/{recep['user_id']}",
        json={"role": "customer"},
        headers=auth_header(admin),
    )
    assert resp.status_code == 409


async def test_user_admin_is_admin_only(client: object) -> None:
    manager = await login(client, "manager01", SEED_PASSWORD)
    assert (await _get(client, "/api/v1/admin/users", manager)).status_code == 403


async def test_user_list_pages_and_splits_staff_from_guests(client: object) -> None:
    """1,000+ guest logins would flood one response - the list is a page envelope
    now, with a `kind` split and a username / email search."""
    admin = await login(client, "admin01", SEED_PASSWORD)

    everyone = (await _get(client, "/api/v1/admin/users?limit=5", admin)).json()
    assert set(everyone) == {"items", "total", "limit", "offset"}
    assert len(everyone["items"]) == 5

    staff = (await _get(client, "/api/v1/admin/users?kind=staff&limit=200", admin)).json()
    guests = (await _get(client, "/api/v1/admin/users?kind=guest&limit=1", admin)).json()
    assert all(u["role"] != "customer" for u in staff["items"])
    assert staff["total"] + guests["total"] == everyone["total"]
    assert guests["total"] > staff["total"]  # far more guest logins than staff

    # offset walks the guest list without repeats
    g2 = (await _get(client, "/api/v1/admin/users?kind=guest&limit=1&offset=1", admin)).json()
    assert guests["items"][0]["user_id"] != g2["items"][0]["user_id"]

    # search matches a known seed account and nothing else
    hit = (await _get(client, "/api/v1/admin/users?q=recep01", admin)).json()
    assert [u["username"] for u in hit["items"]] == ["recep01"]


async def test_staff_options_filter_by_role(client: object) -> None:
    token = await login(client, "recep01", SEED_PASSWORD)
    resp = await _get(client, "/api/v1/admin/staff?role=housekeeping", token)
    assert resp.status_code == 200
    assert resp.json() and all(s["role"] == "housekeeping" for s in resp.json())


async def test_availability_shows_the_rate_plan_price(client: object) -> None:
    """The guest-facing card prices the dates, and still exposes the list price."""
    resp = await cast(Any, client).get(
        "/api/v1/room-types/availability",
        params={"check_in": "2026-12-28", "check_out": "2026-12-31"},
    )
    assert resp.status_code == 200
    suite = next(r for r in resp.json() if r["room_type_id"] == 5)
    assert Decimal(suite["price_per_night"]) == Decimal("5200.00")
    assert Decimal(suite["base_price_per_night"]) == Decimal("3800.00")


async def test_far_future_dates_fall_back_to_the_list_price(client: object) -> None:
    start = date.today() + timedelta(days=5000)
    resp = await cast(Any, client).get(
        "/api/v1/room-types/availability",
        params={
            "check_in": start.isoformat(),
            "check_out": (start + timedelta(days=2)).isoformat(),
        },
    )
    suite = next(r for r in resp.json() if r["room_type_id"] == 5)
    assert Decimal(suite["price_per_night"]) == Decimal(suite["base_price_per_night"])


# ------------------------------------------------------- customer accounts


async def test_customer_role_is_locked_but_disable_and_delete_work(client: object) -> None:
    reg = await cast(Any, client).post(
        "/api/v1/auth/register",
        json={
            "username": "tempguest1",
            "email": "tempguest1@example.com",
            "password": SEED_PASSWORD,
            "first_name": "Temp",
            "last_name": "Guest",
        },
    )
    assert reg.status_code in (200, 201), reg.text

    admin = await login(client, "admin01", SEED_PASSWORD)
    users = await _get(client, "/api/v1/admin/users?q=tempguest1", admin)
    guest = next(u for u in users.json()["items"] if u["username"] == "tempguest1")

    # a guest account's role is fixed at sign-up
    locked = await cast(Any, client).patch(
        f"/api/v1/admin/users/{guest['user_id']}",
        json={"role": "manager"},
        headers=auth_header(admin),
    )
    assert locked.status_code == 403
    assert locked.json()["code"] == "customer_role_locked"

    # disable is allowed
    disabled = await cast(Any, client).patch(
        f"/api/v1/admin/users/{guest['user_id']}",
        json={"is_active": False},
        headers=auth_header(admin),
    )
    assert disabled.status_code == 200 and disabled.json()["is_active"] is False

    # delete is allowed and removes the account
    gone = await cast(Any, client).delete(
        f"/api/v1/admin/users/{guest['user_id']}", headers=auth_header(admin)
    )
    assert gone.status_code == 204
    after = await _get(client, "/api/v1/admin/users?q=tempguest1", admin)
    assert after.json()["total"] == 0


async def test_admin_cannot_delete_themselves(client: object) -> None:
    admin = await login(client, "admin01", SEED_PASSWORD)
    users = await _get(client, "/api/v1/admin/users?q=admin01", admin)
    me = next(u for u in users.json()["items"] if u["username"] == "admin01")
    resp = await cast(Any, client).delete(
        f"/api/v1/admin/users/{me['user_id']}", headers=auth_header(admin)
    )
    assert resp.status_code == 403


_NEW_EMPLOYEE = {
    "username": "frontdesk_kim",
    "password": "S3cure-pass-123",
    "email": "kim.new@hotel.local",
    "first_name": "Kim",
    "last_name": "Nguyen",
    "phone": "0876543210",
    "role": "receptionist",
}


async def test_admin_creates_a_staff_login_that_can_sign_in(client: object) -> None:
    admin = await login(client, "admin01", SEED_PASSWORD)
    created = await cast(Any, client).post(
        "/api/v1/admin/users", json=_NEW_EMPLOYEE, headers=auth_header(admin)
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["role"] == "receptionist"
    assert body["staff_id"] is not None and body["customer_id"] is None

    token = await login(client, "frontdesk_kim", _NEW_EMPLOYEE["password"])
    who = await _get(client, "/api/v1/auth/me", token)
    assert who.json()["role"] == "receptionist"

    # a second account on the same username/email is a conflict
    dupe = await cast(Any, client).post(
        "/api/v1/admin/users", json=_NEW_EMPLOYEE, headers=auth_header(admin)
    )
    assert dupe.status_code == 409


async def test_new_employee_role_cannot_be_customer(client: object) -> None:
    admin = await login(client, "admin01", SEED_PASSWORD)
    body = {
        **_NEW_EMPLOYEE,
        "username": "sneaky1",
        "email": "sneaky1@hotel.local",
        "role": "customer",
    }
    resp = await cast(Any, client).post(
        "/api/v1/admin/users", json=body, headers=auth_header(admin)
    )
    assert resp.status_code == 422


async def test_creating_staff_logins_is_admin_only(client: object) -> None:
    manager = await login(client, "manager01", SEED_PASSWORD)
    resp = await cast(Any, client).post(
        "/api/v1/admin/users",
        json={**_NEW_EMPLOYEE, "username": "mgrmade", "email": "mgrmade@hotel.local"},
        headers=auth_header(manager),
    )
    assert resp.status_code == 403
