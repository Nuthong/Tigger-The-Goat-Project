from __future__ import annotations


async def test_request_id_header_present(client: object) -> None:
    resp = await client.get("/health")  # type: ignore[attr-defined]
    assert resp.headers["x-request-id"]


async def test_request_id_varies_per_request(client: object) -> None:
    first = await client.get("/health")  # type: ignore[attr-defined]
    second = await client.get("/health")  # type: ignore[attr-defined]
    assert first.headers["x-request-id"] != second.headers["x-request-id"]


async def test_error_body_carries_matching_request_id(client: object) -> None:
    resp = await client.get("/api/v1/room-types/999999999/reviews")  # type: ignore[attr-defined]
    assert resp.status_code == 404
    assert resp.json()["request_id"] == resp.headers["x-request-id"]
