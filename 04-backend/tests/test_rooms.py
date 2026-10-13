"""Module 2 - Room catalog: room types + room listing (read-only, any authenticated user)."""

from __future__ import annotations

from typing import Any, cast

from tests.conftest import (
    SEED_PASSWORD,
    arrive_now,
    auth_header,
    login,
    make_booking,
    transition,
)


async def _room(client: object, token: str, room_id: int) -> dict[str, Any]:
    resp = await cast(Any, client).get(
        "/api/v1/rooms", params={"limit": 300}, headers=auth_header(token)
    )
    return next(r for r in resp.json()["items"] if r["room_id"] == room_id)


async def test_room_types_listed(client: object) -> None:
    token = await login(client, "somchai", SEED_PASSWORD)
    resp = await client.get("/api/v1/room-types", headers=auth_header(token))  # type: ignore[attr-defined]
    assert resp.status_code == 200
    names = {rt["name"] for rt in resp.json()}
    assert {"Cityview Room", "Premier Skyline Room", "Oriental Suite"} <= names


async def test_room_types_are_public(client: object) -> None:
    resp = await client.get("/api/v1/room-types")  # type: ignore[attr-defined]  no auth
    assert resp.status_code == 200
    assert len(resp.json()) == 5


async def test_room_inventory_still_requires_auth(client: object) -> None:
    resp = await client.get("/api/v1/rooms")  # type: ignore[attr-defined]
    assert resp.status_code == 401


async def test_rooms_are_paginated(client: object) -> None:
    token = await login(client, "recep01", SEED_PASSWORD)
    resp = await client.get(  # type: ignore[attr-defined]
        "/api/v1/rooms", params={"limit": 5, "offset": 0}, headers=auth_header(token)
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] >= 155  # seed loads 155 rooms across 9 floors
    assert len(body["items"]) == 5
    assert body["limit"] == 5


async def test_rooms_filter_by_status(client: object) -> None:
    token = await login(client, "recep01", SEED_PASSWORD)
    resp = await client.get(  # type: ignore[attr-defined]
        "/api/v1/rooms", params={"status": "maintenance", "limit": 100}, headers=auth_header(token)
    )
    assert resp.status_code == 200
    numbers = {r["room_number"] for r in resp.json()["items"]}
    assert "404" in numbers  # 404 is under maintenance in the seed
    assert "101" not in numbers


async def test_rooms_reject_bad_status_filter(client: object) -> None:
    token = await login(client, "recep01", SEED_PASSWORD)
    resp = await client.get(  # type: ignore[attr-defined]
        "/api/v1/rooms", params={"status": "on-fire"}, headers=auth_header(token)
    )
    assert resp.status_code == 422


async def test_room_is_occupied_while_a_guest_is_checked_in(client: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    booking = await make_booking(client, staff, customer_id=4, room_id=30, days_ahead=1850)
    bid = booking["booking_id"]

    assert (await _room(client, staff, 30))["occupied"] is False

    await arrive_now(bid)
    assert await transition(client, staff, bid, "check-in") == 200
    now_in = await _room(client, staff, 30)
    assert now_in["occupied"] is True
    assert now_in["status"] == "available"  # 'occupied' is derived, not stored

    assert await transition(client, staff, bid, "check-out") == 200
    after = await _room(client, staff, 30)
    assert after["occupied"] is False
    assert after["status"] == "cleaning"  # the check-out trigger dirtied it
