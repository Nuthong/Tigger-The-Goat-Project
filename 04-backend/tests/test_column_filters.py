"""Per-column filters behind the portal's "Advanced filters" panels: every
column a staff table shows can be narrowed on, server side, so paging and the
total stay right. Each test checks that every row returned really matches."""

from __future__ import annotations

from datetime import date
from typing import Any, cast

from tests.conftest import SEED_PASSWORD, auth_header, login


def _c(client: object) -> Any:
    return cast(Any, client)


async def _get(client: object, token: str, path: str, **params: object) -> dict[str, Any]:
    resp = await _c(client).get(path, params=params, headers=auth_header(token))
    assert resp.status_code == 200, resp.text
    return cast(dict[str, Any], resp.json())


async def test_bookings_filter_by_every_column(client: object) -> None:
    token = await login(client, "manager01", SEED_PASSWORD)
    one = await _get(client, token, "/api/v1/bookings", ref="TIG-00001")
    assert one["total"] == 1 and one["items"][0]["booking_id"] == 1
    assert (await _get(client, token, "/api/v1/bookings", ref="1"))["total"] == 1
    assert (await _get(client, token, "/api/v1/bookings", ref="nope"))["total"] == 0

    name = one["items"][0]["customer_name"].split()[0]
    by_guest = await _get(client, token, "/api/v1/bookings", guest=name, limit=100)
    assert by_guest["total"] >= 1
    assert all(name.lower() in b["customer_name"].lower() for b in by_guest["items"])

    room = one["items"][0]["rooms"][0]["room_number"]
    by_room = await _get(client, token, "/api/v1/bookings", room=room, limit=100)
    assert by_room["total"] >= 1
    assert all(any(room in r["room_number"] for r in b["rooms"]) for b in by_room["items"])

    # payment status combines with the other filters (it used to OR past them)
    # and "paid" means a live stay with nothing owed - never a cancelled one
    paid = await _get(client, token, "/api/v1/bookings", payment_status="paid", limit=100)
    assert paid["total"] >= 1
    assert all(b["status"] != "cancelled" for b in paid["items"])
    assert all(float(b["balance_due"]) <= 0 for b in paid["items"])
    nobody = await _get(
        client, token, "/api/v1/bookings", payment_status="paid", guest="no-such-guest-zz"
    )
    assert nobody["total"] == 0

    long_stays = await _get(
        client, token, "/api/v1/bookings", min_nights=4, max_nights=5, limit=100
    )
    assert long_stays["total"] >= 1
    for b in long_stays["items"]:
        n = (date.fromisoformat(b["check_out_date"]) - date.fromisoformat(b["check_in_date"])).days
        assert 4 <= n <= 5


async def test_guests_filter_by_every_column(client: object) -> None:
    token = await login(client, "recep01", SEED_PASSWORD)
    first = (await _get(client, token, "/api/v1/customers", limit=1))["items"][0]

    by_email = await _get(client, token, "/api/v1/customers", email=first["email"])
    assert [c["customer_id"] for c in by_email["items"]] == [first["customer_id"]]
    by_name = await _get(client, token, "/api/v1/customers", name=first["last_name"], limit=100)
    needle = first["last_name"].lower()
    assert all(needle in f"{c['first_name']} {c['last_name']}".lower() for c in by_name["items"])
    if first["phone"]:
        by_phone = await _get(client, token, "/api/v1/customers", phone=first["phone"][-4:])
        assert by_phone["total"] >= 1

    regulars = await _get(client, token, "/api/v1/customers", min_trips=3, limit=100)
    assert all(c["trips"] >= 3 for c in regulars["items"])
    band = await _get(client, token, "/api/v1/customers", min_nights=5, max_nights=9, limit=100)
    assert all(5 <= c["nights"] <= 9 for c in band["items"])


async def test_invoices_filter_by_every_column(client: object) -> None:
    token = await login(client, "acct01", SEED_PASSWORD)
    everything = await _get(client, token, "/api/v1/invoices", limit=100)
    inv = everything["items"][0]

    by_no = await _get(client, token, "/api/v1/invoices", invoice_no=inv["invoice_no"][-5:])
    assert inv["invoice_id"] in {i["invoice_id"] for i in by_no["items"]}
    ref = f"TIG-{inv['booking_id']:05d}"
    by_ref = await _get(client, token, "/api/v1/invoices", booking_ref=ref)
    assert [i["booking_id"] for i in by_ref["items"]] == [inv["booking_id"]]
    assert (await _get(client, token, "/api/v1/invoices", booking_ref="x"))["total"] == 0
    by_guest = await _get(client, token, "/api/v1/invoices", guest=inv["customer_name"][:4])
    assert by_guest["total"] >= 1

    owed = await _get(client, token, "/api/v1/invoices", balance="outstanding", limit=100)
    settled = await _get(client, token, "/api/v1/invoices", balance="settled", limit=100)
    assert all(float(i["balance_due"]) > 0 for i in owed["items"])
    assert all(float(i["balance_due"]) <= 0 for i in settled["items"])
    assert owed["total"] + settled["total"] == everything["total"]


async def test_audit_filters_action_partially_and_by_summary(client: object) -> None:
    token = await login(client, "manager01", SEED_PASSWORD)
    bookings = await _get(client, token, "/api/v1/admin/audit", action="booking.", limit=100)
    assert bookings["total"] >= 1
    assert all(r["action"].startswith("booking.") for r in bookings["items"])

    row = bookings["items"][0]
    by_id = await _get(
        client, token, "/api/v1/admin/audit", entity_type="booking", entity_id=row["entity_id"]
    )
    assert all(r["entity_id"] == row["entity_id"] for r in by_id["items"])
    if row["summary"]:
        word = row["summary"].split()[0]
        by_summary = await _get(client, token, "/api/v1/admin/audit", summary=word, limit=100)
        assert all(word.lower() in (r["summary"] or "").lower() for r in by_summary["items"])


async def test_reviews_filter_by_guest_comment_and_booking(client: object) -> None:
    token = await login(client, "manager01", SEED_PASSWORD)
    rv = (await _get(client, token, "/api/v1/admin/reviews", limit=1))["items"][0]

    by_ref = await _get(client, token, "/api/v1/admin/reviews", booking_ref=str(rv["booking_id"]))
    assert [r["booking_id"] for r in by_ref["items"]] == [rv["booking_id"]]
    by_guest = await _get(
        client, token, "/api/v1/admin/reviews", guest=rv["customer_name"], limit=100
    )
    assert all(r["customer_name"] == rv["customer_name"] for r in by_guest["items"])
    if rv["comment"]:
        word = rv["comment"].split()[0]
        by_text = await _get(client, token, "/api/v1/admin/reviews", comment=word, limit=100)
        assert all(word.lower() in (r["comment"] or "").lower() for r in by_text["items"])


async def test_users_and_sign_in_log_filter_by_every_column(client: object) -> None:
    token = await login(client, "admin01", SEED_PASSWORD)
    mine = await _get(client, token, "/api/v1/admin/users", username="admin0")
    assert {u["username"] for u in mine["items"]} >= {"admin01"}
    by_email = await _get(client, token, "/api/v1/admin/users", email="admin01")
    assert all("admin01" in u["email"] for u in by_email["items"])

    signed_in = await _get(client, token, "/api/v1/admin/users", never_signed_in=False, limit=100)
    assert all(u["last_login_at"] for u in signed_in["items"])
    today = date.today().isoformat()
    recent = await _get(client, token, "/api/v1/admin/users", login_from=today, limit=100)
    assert "admin01" in {u["username"] for u in recent["items"]}

    admin_row = next(u for u in mine["items"] if u["username"] == "admin01")
    if admin_row.get("full_name"):
        by_name = await _get(
            client, token, "/api/v1/admin/users", name=admin_row["full_name"].split()[0]
        )
        assert "admin01" in {u["username"] for u in by_name["items"]}

    log = await _get(client, token, "/api/v1/admin/auth-events", limit=100)
    ev = next(e for e in log["items"] if e["ip_address"])
    by_ip = await _get(client, token, "/api/v1/admin/auth-events", ip=ev["ip_address"], limit=100)
    assert by_ip["total"] >= 1
    assert all(ev["ip_address"] in e["ip_address"] for e in by_ip["items"])
    if ev["user_agent"]:
        agent = ev["user_agent"][:6]
        by_agent = await _get(client, token, "/api/v1/admin/auth-events", browser=agent, limit=100)
        assert all(agent.lower() in (e["user_agent"] or "").lower() for e in by_agent["items"])
