from __future__ import annotations

import uuid

from tests.conftest import SEED_PASSWORD, auth_header, login


def _new_user() -> dict[str, str]:
    tag = uuid.uuid4().hex[:8]
    return {
        "username": f"user_{tag}",
        "email": f"user_{tag}@example.com",
        "password": "S3cure-pass-123",
        "first_name": "Test",
        "last_name": "User",
    }


async def test_register_returns_access_token(client: object) -> None:
    resp = await client.post("/api/v1/auth/register", json=_new_user())  # type: ignore[attr-defined]
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["token_type"] == "bearer"
    assert body["access_token"]
    assert "refresh_token" in resp.cookies


async def test_me_requires_token(client: object) -> None:
    resp = await client.get("/api/v1/auth/me")  # type: ignore[attr-defined]
    assert resp.status_code == 401


async def test_login_and_me_roundtrip(client: object) -> None:
    user = _new_user()
    await client.post("/api/v1/auth/register", json=user)  # type: ignore[attr-defined]
    token = await login(client, user["username"], user["password"])
    resp = await client.get("/api/v1/auth/me", headers=auth_header(token))  # type: ignore[attr-defined]
    assert resp.status_code == 200
    assert resp.json()["role"] == "customer"
    assert resp.json()["username"] == user["username"]


async def test_refresh_rotates_access_token(client: object) -> None:
    user = _new_user()
    await client.post("/api/v1/auth/register", json=user)  # type: ignore[attr-defined]
    await login(client, user["username"], user["password"])  # sets refresh cookie on client
    resp = await client.post("/api/v1/auth/refresh")  # type: ignore[attr-defined]
    assert resp.status_code == 200, resp.text
    assert resp.json()["access_token"]


async def test_wrong_password_locks_account_after_five_tries(client: object) -> None:
    user = _new_user()
    await client.post("/api/v1/auth/register", json=user)  # type: ignore[attr-defined]

    for _ in range(5):
        r = await client.post(  # type: ignore[attr-defined]
            "/api/v1/auth/login",
            json={"username": user["username"], "password": "wrong-pass-xxx"},
        )
        assert r.status_code == 401

    locked = await client.post(  # type: ignore[attr-defined]
        "/api/v1/auth/login",
        json={"username": user["username"], "password": user["password"]},
    )
    assert locked.status_code == 401
    assert locked.json()["code"] == "locked"


async def test_staff_me_with_internal_email(client: object) -> None:
    # seed staff use *.local addresses; /auth/me must still serialize (UserOut.email = str)
    token = await login(client, "manager01", SEED_PASSWORD)
    resp = await client.get("/api/v1/auth/me", headers=auth_header(token))  # type: ignore[attr-defined]
    assert resp.status_code == 200
    assert resp.json()["role"] == "manager"
    assert resp.json()["email"].endswith(".local")


async def test_customer_cannot_reach_manager_report(client: object) -> None:
    token = await login(client, "somchai", SEED_PASSWORD)
    resp = await client.get(  # type: ignore[attr-defined]
        "/api/v1/reports/revenue-by-room-type", headers=auth_header(token)
    )
    assert resp.status_code == 403
    assert resp.json()["code"] == "forbidden"


async def test_login_error_is_generic(client: object) -> None:
    resp = await client.post(  # type: ignore[attr-defined]
        "/api/v1/auth/login", json={"username": "no_such_user", "password": "whatever123"}
    )
    assert resp.status_code == 401
    # must not reveal whether the username exists
    assert resp.json()["detail"] == "invalid username or password"


async def test_extra_field_in_body_is_rejected(client: object) -> None:
    payload = {**_new_user(), "role": "manager"}  # attacker tries to self-assign a role
    resp = await client.post("/api/v1/auth/register", json=payload)  # type: ignore[attr-defined]
    assert resp.status_code == 422  # extra="forbid"


async def test_logout_clears_refresh_cookie(client: object) -> None:
    user = _new_user()
    await client.post("/api/v1/auth/register", json=user)  # type: ignore[attr-defined]
    token = await login(client, user["username"], user["password"])
    resp = await client.post("/api/v1/auth/logout", headers=auth_header(token))  # type: ignore[attr-defined]
    assert resp.status_code == 204
    after = await client.post("/api/v1/auth/refresh")  # type: ignore[attr-defined]
    assert after.status_code == 401  # cookie gone


async def test_change_password_revokes_old_access_token(client: object) -> None:
    user = _new_user()
    await client.post("/api/v1/auth/register", json=user)  # type: ignore[attr-defined]
    token = await login(client, user["username"], user["password"])

    changed = await client.post(  # type: ignore[attr-defined]
        "/api/v1/auth/change-password",
        json={"current_password": user["password"], "new_password": "Brand-New-Pw-99"},
        headers=auth_header(token),
    )
    assert changed.status_code == 204

    # token_version bumped -> the token we still hold must now be rejected
    stale = await client.get("/api/v1/auth/me", headers=auth_header(token))  # type: ignore[attr-defined]
    assert stale.status_code == 401
    # and the new password works
    await login(client, user["username"], "Brand-New-Pw-99")


async def test_change_password_wrong_current_is_rejected(client: object) -> None:
    user = _new_user()
    await client.post("/api/v1/auth/register", json=user)  # type: ignore[attr-defined]
    token = await login(client, user["username"], user["password"])
    resp = await client.post(  # type: ignore[attr-defined]
        "/api/v1/auth/change-password",
        json={"current_password": "not-it", "new_password": "Another-New-Pw-1"},
        headers=auth_header(token),
    )
    assert resp.status_code == 401


async def test_login_accepts_email_or_phone(client: object) -> None:
    # somchai is seed customer #1 - sign in with the profile email and phone,
    # not the username
    for ident in ("somchai.j@example.com", "0811110001"):
        resp = await client.post(  # type: ignore[attr-defined]
            "/api/v1/auth/login",
            json={"username": ident, "password": SEED_PASSWORD},
        )
        assert resp.status_code == 200, ident
        assert resp.json()["access_token"]


# ------------------------------------------------------------------ profile


async def test_me_carries_the_guest_profile(client: object) -> None:
    user = _new_user()
    await client.post("/api/v1/auth/register", json=user)  # type: ignore[attr-defined]
    token = await login(client, user["username"], user["password"])
    body = (
        await client.get("/api/v1/auth/me", headers=auth_header(token))  # type: ignore[attr-defined]
    ).json()
    assert body["first_name"] == user["first_name"]
    assert body["last_name"] == user["last_name"]
    assert body["phone"] is None


async def test_guest_edits_their_own_name_and_phone(client: object) -> None:
    user = _new_user()
    await client.post("/api/v1/auth/register", json=user)  # type: ignore[attr-defined]
    token = await login(client, user["username"], user["password"])

    patched = await client.patch(  # type: ignore[attr-defined]
        "/api/v1/auth/me",
        json={"first_name": "Renamed", "phone": "0891234567"},
        headers=auth_header(token),
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["first_name"] == "Renamed"
    assert patched.json()["last_name"] == user["last_name"]  # untouched
    assert patched.json()["phone"] == "0891234567"

    # the new phone is now a valid login identifier
    relog = await client.post(  # type: ignore[attr-defined]
        "/api/v1/auth/login",
        json={"username": "0891234567", "password": user["password"]},
    )
    assert relog.status_code == 200

    # an explicit null clears it again
    cleared = await client.patch(  # type: ignore[attr-defined]
        "/api/v1/auth/me", json={"phone": None}, headers=auth_header(token)
    )
    assert cleared.status_code == 200 and cleared.json()["phone"] is None


async def test_profile_patch_rejects_unknown_fields(client: object) -> None:
    user = _new_user()
    await client.post("/api/v1/auth/register", json=user)  # type: ignore[attr-defined]
    token = await login(client, user["username"], user["password"])
    resp = await client.patch(  # type: ignore[attr-defined]
        "/api/v1/auth/me",
        json={"email": "hijack@example.com", "role": "admin"},
        headers=auth_header(token),
    )
    assert resp.status_code == 422


async def test_staff_cannot_edit_a_profile_here(client: object) -> None:
    token = await login(client, "manager01", SEED_PASSWORD)
    resp = await client.patch(  # type: ignore[attr-defined]
        "/api/v1/auth/me", json={"first_name": "Nope"}, headers=auth_header(token)
    )
    assert resp.status_code == 403
