"""Module 8 - Reporting: reads the SQL views, manager-only."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from tests.conftest import SEED_PASSWORD, auth_header, login


async def test_revenue_by_room_type_shape(client: object) -> None:
    token = await login(client, "manager01", SEED_PASSWORD)
    resp = await client.get(  # type: ignore[attr-defined]
        "/api/v1/reports/revenue-by-room-type", headers=auth_header(token)
    )
    assert resp.status_code == 200
    rows = resp.json()
    assert rows, "seed has non-cancelled bookings"
    first = rows[0]
    assert {"room_type", "booking_count", "total_room_nights", "revenue"} <= first.keys()
    # rows are ordered by revenue desc
    revenues = [float(r["revenue"]) for r in rows]
    assert revenues == sorted(revenues, reverse=True)


async def test_occupancy_shape(client: object) -> None:
    token = await login(client, "manager01", SEED_PASSWORD)
    resp = await client.get("/api/v1/reports/occupancy", headers=auth_header(token))  # type: ignore[attr-defined]
    assert resp.status_code == 200
    rows = resp.json()
    assert rows, "seed has non-cancelled stays"
    for row in rows:
        assert {
            "month",
            "room_nights_sold",
            "room_nights_capacity",
            "occupancy_pct",
            "adr",
            "revpar",
        } <= row.keys()
        assert 0.0 <= row["occupancy_pct"] <= 100.0
        adr, revpar = float(row["adr"]), float(row["revpar"])
        # a room only earns when it sells, so RevPAR can never beat ADR, and
        # RevPAR ~= ADR x (nights sold / nights on offer), within a baht of rounding
        assert 0 < revpar <= adr
        occ_ratio = row["room_nights_sold"] / row["room_nights_capacity"]
        assert abs(revpar - adr * occ_ratio) < 1.0


async def test_forecast_lists_on_the_books_occupancy_for_the_horizon(client: object) -> None:
    token = await login(client, "manager01", SEED_PASSWORD)
    resp = await client.get(  # type: ignore[attr-defined]
        "/api/v1/reports/forecast", params={"days": 21}, headers=auth_header(token)
    )
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) == 21
    assert rows[0]["date"] == date.today().isoformat()  # horizon starts today
    days = [date.fromisoformat(r["date"]) for r in rows]
    assert days == sorted(days) and (days[-1] - days[0]).days == 20  # consecutive
    for r in rows:
        assert {
            "date",
            "rooms_sold",
            "rooms_available",
            "occupancy_pct",
            "revenue_on_books",
            "arrivals",
            "departures",
        } <= r.keys()
        # the no-overlap trigger means a room can't be sold twice on a night
        assert 0 <= r["rooms_sold"] <= r["rooms_available"]
        assert 0.0 <= r["occupancy_pct"] <= 100.0
        assert float(r["revenue_on_books"]) >= 0.0


async def test_forecast_horizon_is_clamped_and_manager_only(client: object) -> None:
    manager = await login(client, "manager01", SEED_PASSWORD)
    too_far = await client.get(  # type: ignore[attr-defined]
        "/api/v1/reports/forecast", params={"days": 500}, headers=auth_header(manager)
    )
    assert too_far.status_code == 422  # ge/le bounds on the query param

    guest = await login(client, "somchai", SEED_PASSWORD)
    denied = await client.get(  # type: ignore[attr-defined]
        "/api/v1/reports/forecast", headers=auth_header(guest)
    )
    assert denied.status_code == 403


async def test_rate_calendar_prices_every_night_of_the_month(client: object) -> None:
    token = await login(client, "manager01", SEED_PASSWORD)
    resp = await client.get(  # type: ignore[attr-defined]
        "/api/v1/reports/rate-calendar", params={"month": "2026-12"}, headers=auth_header(token)
    )
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) == 5  # five seeded room types
    for row in rows:
        assert {
            "room_type_id",
            "room_type_name",
            "base_price_per_night",
            "nights",
        } <= row.keys()
        assert len(row["nights"]) == 31  # December
        assert row["nights"][0]["date"] == "2026-12-01"
        assert row["nights"][-1]["date"] == "2026-12-31"
        assert all(float(n["price"]) > 0 for n in row["nights"])

    # the New-Year high-season plan lifts the suite's rate above its list price
    suite = next(r for r in rows if r["room_type_id"] == 5)
    dec31 = next(n for n in suite["nights"] if n["date"] == "2026-12-31")
    assert float(dec31["price"]) > float(suite["base_price_per_night"])

    bad = await client.get(  # type: ignore[attr-defined]
        "/api/v1/reports/rate-calendar", params={"month": "2026-13"}, headers=auth_header(token)
    )
    assert bad.status_code == 422

    guest = await login(client, "somchai", SEED_PASSWORD)
    denied = await client.get(  # type: ignore[attr-defined]
        "/api/v1/reports/rate-calendar", headers=auth_header(guest)
    )
    assert denied.status_code == 403


async def test_reports_are_manager_only(client: object) -> None:
    for username in ("recep01", "somchai"):
        token = await login(client, username, SEED_PASSWORD)
        resp = await client.get(  # type: ignore[attr-defined]
            "/api/v1/reports/revenue-by-room-type", headers=auth_header(token)
        )
        assert resp.status_code == 403


async def test_reports_require_auth(client: object) -> None:
    resp = await client.get("/api/v1/reports/occupancy")  # type: ignore[attr-defined]
    assert resp.status_code == 401


async def test_customer_directory_lists_with_trips_and_value(client: object) -> None:
    token = await login(client, "recep01", SEED_PASSWORD)
    resp = await client.get(  # type: ignore[attr-defined]
        "/api/v1/customers", params={"limit": 50}, headers=auth_header(token)
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] >= 1000  # seed loads 1000 customers
    keys = body["items"][0].keys()
    assert {"customer_id", "trips", "nights", "lifetime_value", "email"} <= keys
    # ordered by lifetime_value desc
    values = [float(c["lifetime_value"]) for c in body["items"]]
    assert values == sorted(values, reverse=True)


async def test_customer_directory_search_and_rbac(client: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    hit = await client.get(  # type: ignore[attr-defined]
        "/api/v1/customers", params={"q": "Schmidt"}, headers=auth_header(staff)
    )
    assert hit.status_code == 200
    assert any("Schmidt" in c["last_name"] for c in hit.json()["items"])

    guest = await login(client, "somchai", SEED_PASSWORD)
    denied = await client.get("/api/v1/customers", headers=auth_header(guest))  # type: ignore[attr-defined]
    assert denied.status_code == 403


async def test_guest_360_view(client: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    # somchai is seed customer #1 and has seeded bookings
    resp = await client.get("/api/v1/customers/1", headers=auth_header(staff))  # type: ignore[attr-defined]
    assert resp.status_code == 200
    body = resp.json()
    assert body["customer_id"] == 1
    assert body["has_login"] is True
    assert body["trips"] >= 1
    assert isinstance(body["recent_bookings"], list) and body["recent_bookings"]
    first = body["recent_bookings"][0]
    assert {"booking_id", "status", "grand_total", "room_types"} <= first.keys()
    # lifetime value covers non-cancelled bookings only
    assert float(body["lifetime_value"]) >= 0

    missing = await client.get(  # type: ignore[attr-defined]
        "/api/v1/customers/99999", headers=auth_header(staff)
    )
    assert missing.status_code == 404


async def test_guest_360_is_staff_only(client: object) -> None:
    guest = await login(client, "somchai", SEED_PASSWORD)
    denied = await client.get("/api/v1/customers/1", headers=auth_header(guest))  # type: ignore[attr-defined]
    assert denied.status_code == 403


async def test_my_loyalty_summary_matches_the_staff_view(client: object) -> None:
    somchai = await login(client, "somchai", SEED_PASSWORD)  # seed customer #1
    resp = await client.get(  # type: ignore[attr-defined]
        "/api/v1/customers/me/summary", headers=auth_header(somchai)
    )
    assert resp.status_code == 200
    body = resp.json()
    assert set(body) == {"trips", "nights", "lifetime_spend"}
    assert body["trips"] >= 1 and body["nights"] >= 0
    assert float(body["lifetime_spend"]) >= 0

    staff = await login(client, "recep01", SEED_PASSWORD)
    detail = (
        await client.get("/api/v1/customers/1", headers=auth_header(staff))  # type: ignore[attr-defined]
    ).json()
    assert body["trips"] == detail["trips"]
    assert body["nights"] == detail["nights"]
    assert Decimal(body["lifetime_spend"]) == Decimal(detail["lifetime_value"])

    # a staff login has no guest profile behind it
    denied = await client.get(  # type: ignore[attr-defined]
        "/api/v1/customers/me/summary", headers=auth_header(staff)
    )
    assert denied.status_code == 403
