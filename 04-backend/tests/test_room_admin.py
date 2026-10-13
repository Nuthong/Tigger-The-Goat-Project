"""Module 9 - Room administration: create rooms (manager), change status (staff) + audit log."""

from __future__ import annotations

from tests.conftest import SEED_PASSWORD, auth_header, login


async def test_manager_creates_room(client: object) -> None:
    token = await login(client, "manager01", SEED_PASSWORD)
    resp = await client.post(  # type: ignore[attr-defined]
        "/api/v1/rooms",
        json={"room_number": "9901", "floor": 9, "room_type_id": 1},  # 4-digit: seed uses 3
        headers=auth_header(token),
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["status"] == "available"


async def test_receptionist_cannot_create_room(client: object) -> None:
    token = await login(client, "recep01", SEED_PASSWORD)
    resp = await client.post(  # type: ignore[attr-defined]
        "/api/v1/rooms",
        json={"room_number": "9902", "floor": 9, "room_type_id": 1},
        headers=auth_header(token),
    )
    assert resp.status_code == 403


async def test_duplicate_room_number_conflicts(client: object) -> None:
    token = await login(client, "manager01", SEED_PASSWORD)
    resp = await client.post(  # type: ignore[attr-defined]
        "/api/v1/rooms",
        json={"room_number": "101", "floor": 1, "room_type_id": 1},  # already exists in seed
        headers=auth_header(token),
    )
    assert resp.status_code == 409


async def test_unknown_room_type_is_404(client: object) -> None:
    token = await login(client, "manager01", SEED_PASSWORD)
    resp = await client.post(  # type: ignore[attr-defined]
        "/api/v1/rooms",
        json={"room_number": "9903", "floor": 9, "room_type_id": 999},
        headers=auth_header(token),
    )
    assert resp.status_code == 404


async def test_status_change_round_trips(client: object) -> None:
    token = await login(client, "recep01", SEED_PASSWORD)  # receptionist may change status
    # room 8 starts 'available' in the seed
    to_maint = await client.patch(  # type: ignore[attr-defined]
        "/api/v1/rooms/8/status", json={"status": "maintenance"}, headers=auth_header(token)
    )
    assert to_maint.status_code == 200
    assert to_maint.json()["status"] == "maintenance"

    in_maint = await client.get(  # type: ignore[attr-defined]
        "/api/v1/rooms", params={"status": "maintenance", "limit": 100}, headers=auth_header(token)
    )
    assert 8 in {r["room_id"] for r in in_maint.json()["items"]}

    back = await client.patch(  # type: ignore[attr-defined]
        "/api/v1/rooms/8/status", json={"status": "available"}, headers=auth_header(token)
    )
    assert back.status_code == 200
    assert back.json()["status"] == "available"


async def test_bad_status_value_is_422(client: object) -> None:
    token = await login(client, "recep01", SEED_PASSWORD)
    resp = await client.patch(  # type: ignore[attr-defined]
        "/api/v1/rooms/8/status", json={"status": "haunted"}, headers=auth_header(token)
    )
    assert resp.status_code == 422
