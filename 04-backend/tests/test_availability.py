"""Module 3 - Availability search (wraps the SQL function fn_available_rooms)."""

from __future__ import annotations

from datetime import date, timedelta

from tests.conftest import SEED_PASSWORD, auth_header, login, make_booking

FUTURE_IN = (date.today() + timedelta(days=900)).isoformat()
FUTURE_OUT = (date.today() + timedelta(days=903)).isoformat()


async def test_lists_free_rooms_excludes_maintenance(client: object) -> None:
    token = await login(client, "manager01", SEED_PASSWORD)
    resp = await client.get(  # type: ignore[attr-defined]
        "/api/v1/rooms/availability",
        params={"check_in": FUTURE_IN, "check_out": FUTURE_OUT},
        headers=auth_header(token),
    )
    assert resp.status_code == 200
    numbers = {r["room_number"] for r in resp.json()}
    assert "101" in numbers
    assert "404" not in numbers  # maintenance
    # ordered by price ascending
    prices = [float(r["price_per_night"]) for r in resp.json()]
    assert prices == sorted(prices)


async def test_booked_room_disappears_from_availability(client: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    booking = await make_booking(client, staff, customer_id=2, room_id=6, days_ahead=1200, nights=3)
    ci = booking["check_in_date"]
    co = booking["check_out_date"]

    resp = await client.get(  # type: ignore[attr-defined]
        "/api/v1/rooms/availability",
        params={"check_in": ci, "check_out": co},
        headers=auth_header(staff),
    )
    ids = {r["room_id"] for r in resp.json()}
    assert 6 not in ids


async def test_guest_can_search_without_auth(client: object) -> None:
    resp = await client.get(  # type: ignore[attr-defined]  - no Authorization header
        "/api/v1/rooms/availability",
        params={"check_in": FUTURE_IN, "check_out": FUTURE_OUT},
    )
    assert resp.status_code == 200
    assert len(resp.json()) > 0
    # room types are public too
    rt = await client.get("/api/v1/room-types")  # type: ignore[attr-defined]
    assert rt.status_code == 200


async def test_grouped_availability_is_one_row_per_type(client: object) -> None:
    resp = await client.get(  # type: ignore[attr-defined]  public, no auth
        "/api/v1/room-types/availability",
        params={"check_in": FUTURE_IN, "check_out": FUTURE_OUT},
    )
    assert resp.status_code == 200
    rows = resp.json()
    names = [r["name"] for r in rows]
    assert names == sorted(set(names), key=names.index)  # unique, no per-room rows
    for r in rows:
        # every category is listed now; a sold-out one just carries count 0
        assert r["available_count"] >= 0
        assert {"room_type_id", "price_per_night", "max_occupancy"} <= r.keys()
    # nothing is booked this far out, so every type is bookable here
    assert all(r["available_count"] >= 1 for r in rows)
    # bookable rows come first, ordered by price ascending
    prices = [float(r["price_per_night"]) for r in rows if r["available_count"] > 0]
    assert prices == sorted(prices)


async def test_sold_out_type_is_still_listed_with_zero_count(client: object) -> None:
    """The guest site greys sold-out categories out instead of hiding them, so
    the grouped endpoint must return every type - a full one with count 0."""
    token = await login(client, "somchai", SEED_PASSWORD)
    win = {
        "check_in_date": (date.today() + timedelta(days=5200)).isoformat(),
        "check_out_date": (date.today() + timedelta(days=5203)).isoformat(),
    }
    # Skyline Residence (type 4) has 8 rooms - take them all for this window
    grab = await client.post(  # type: ignore[attr-defined]
        "/api/v1/bookings",
        json={**win, "num_guests": 8, "rooms": [{"room_type_id": 4}] * 8},
        headers=auth_header(token),
    )
    assert grab.status_code == 201, grab.text

    rows = (
        await client.get(  # type: ignore[attr-defined]
            "/api/v1/room-types/availability",
            params={"check_in": win["check_in_date"], "check_out": win["check_out_date"]},
        )
    ).json()
    sold_out = next(r for r in rows if r["room_type_id"] == 4)
    assert sold_out["available_count"] == 0
    # only type 4 is full here, and sold-out rows sink to the bottom
    counts = [r["available_count"] for r in rows]
    assert counts[-1] == 0
    assert all(c > 0 for c in counts[:-1])


async def test_rejects_inverted_date_range(client: object) -> None:
    token = await login(client, "recep01", SEED_PASSWORD)
    resp = await client.get(  # type: ignore[attr-defined]
        "/api/v1/rooms/availability",
        params={"check_in": FUTURE_OUT, "check_out": FUTURE_IN},
        headers=auth_header(token),
    )
    assert resp.status_code == 422
