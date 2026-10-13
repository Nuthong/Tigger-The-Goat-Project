from __future__ import annotations


async def test_health(client: object) -> None:
    resp = await client.get("/health")  # type: ignore[attr-defined]
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


async def test_ready_checks_db(client: object) -> None:
    resp = await client.get("/health/ready")  # type: ignore[attr-defined]
    assert resp.status_code == 200
    assert resp.json()["status"] == "ready"


async def test_security_headers_present(client: object) -> None:
    resp = await client.get("/health")  # type: ignore[attr-defined]
    assert resp.headers["x-content-type-options"] == "nosniff"
    assert resp.headers["x-frame-options"] == "DENY"
    assert "content-security-policy" in resp.headers
