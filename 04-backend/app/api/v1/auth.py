"""/api/v1/auth - register, login, refresh, logout, me, change-password."""

from __future__ import annotations

import jwt
from fastapi import APIRouter, Depends, Request, Response

from app.api.deps import CurrentUser, DbSession
from app.core.config import get_settings
from app.core.rate_limit import rate_limit_auth, rate_limit_refresh
from app.core.security import decode_token
from app.exceptions import AuthError, ForbiddenError, NotFoundError
from app.models.auth import AppUser, AuthEvent
from app.models.people import Customer
from app.schemas.auth import (
    AccessTokenOut,
    ChangePasswordIn,
    LoginIn,
    MeOut,
    ProfilePatch,
    RegisterIn,
)
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])

_REFRESH_COOKIE = "refresh_token"  # noqa: S105  (cookie name, not a secret)
_REFRESH_PATH = "/api/v1/auth"
_RateLimited = Depends(rate_limit_auth)
_RefreshLimited = Depends(rate_limit_refresh)


def _client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def _set_refresh_cookie(response: Response, token: str) -> None:
    settings = get_settings()
    response.set_cookie(
        key=_REFRESH_COOKIE,
        value=token,
        max_age=settings.refresh_token_ttl_days * 86400,
        httponly=True,
        secure=settings.is_production,
        samesite="strict",
        path=_REFRESH_PATH,
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(_REFRESH_COOKIE, path=_REFRESH_PATH)


@router.post(
    "/register",
    response_model=AccessTokenOut,
    status_code=201,
    dependencies=[_RateLimited],
)
async def register(response: Response, body: RegisterIn, db: DbSession) -> AccessTokenOut:
    """Create a new guest account and sign them in - issues an access token and sets
    the refresh cookie, same as /login."""
    user = await auth_service.register_customer(db, body)
    access, refresh, expires_in = auth_service.issue_tokens(user)
    _set_refresh_cookie(response, refresh)
    return AccessTokenOut(access_token=access, expires_in=expires_in)


@router.post("/login", response_model=AccessTokenOut, dependencies=[_RateLimited])
async def login(
    request: Request, response: Response, body: LoginIn, db: DbSession
) -> AccessTokenOut:
    """Sign in with username/email/phone + password - issues an access token and sets
    the httponly refresh cookie. Locks the account after repeated failures."""
    user = await auth_service.authenticate(
        db,
        username=body.username,
        password=body.password,
        ip=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )
    access, refresh, expires_in = auth_service.issue_tokens(user)
    _set_refresh_cookie(response, refresh)
    return AccessTokenOut(access_token=access, expires_in=expires_in)


@router.post("/refresh", response_model=AccessTokenOut, dependencies=[_RefreshLimited])
async def refresh(request: Request, response: Response, db: DbSession) -> AccessTokenOut:
    """Exchange the refresh cookie for a new access token, rotating the refresh cookie."""
    raw = request.cookies.get(_REFRESH_COOKIE)
    if not raw:
        raise AuthError("missing refresh token")
    try:
        payload = decode_token(raw, expected_type="refresh")
    except jwt.InvalidTokenError as exc:
        raise AuthError("invalid or expired refresh token") from exc

    user = await db.get(AppUser, int(payload["sub"]))
    if user is None or not user.is_active or int(payload.get("tv", -1)) != user.token_version:
        _clear_refresh_cookie(response)
        raise AuthError("refresh token has been revoked")

    access, new_refresh, expires_in = auth_service.issue_tokens(user)  # rotation
    _set_refresh_cookie(response, new_refresh)
    return AccessTokenOut(access_token=access, expires_in=expires_in)


@router.post("/logout", status_code=204)
async def logout(request: Request, response: Response, db: DbSession) -> Response:
    """Clear the refresh cookie and record the event. Never fails, even with a stale token."""
    # never fails - clears the refresh cookie even if the access token is already expired
    raw = request.cookies.get(_REFRESH_COOKIE)
    if raw:
        try:
            payload = decode_token(raw, expected_type="refresh")
            db.add(AuthEvent(user_id=int(payload["sub"]), event_type="logout"))
        except jwt.InvalidTokenError:
            pass
    _clear_refresh_cookie(response)
    response.status_code = 204
    return response


@router.get("/me", response_model=MeOut)
async def me(user: CurrentUser, db: DbSession) -> MeOut:
    """The signed-in user's own profile."""
    out = MeOut.model_validate(user)
    if user.customer_id is not None:
        profile = await db.get(Customer, user.customer_id)
        if profile is not None:
            out.first_name = profile.first_name
            out.last_name = profile.last_name
            out.phone = profile.phone
    return out


@router.patch("/me", response_model=MeOut)
async def update_me(body: ProfilePatch, db: DbSession, user: CurrentUser) -> MeOut:
    """A guest edits their own name / phone. Staff manage their record elsewhere."""
    if user.customer_id is None:
        raise ForbiddenError("only guest profiles can be edited here")
    profile = await db.get(Customer, user.customer_id)
    if profile is None:
        raise NotFoundError("guest profile not found")

    fields = body.model_dump(exclude_unset=True)
    if fields.get("first_name"):
        profile.first_name = fields["first_name"].strip()
    if fields.get("last_name"):
        profile.last_name = fields["last_name"].strip()
    if "phone" in fields:
        phone = (fields["phone"] or "").strip()
        profile.phone = phone or None
    await db.flush()

    out = MeOut.model_validate(user)
    out.first_name = profile.first_name
    out.last_name = profile.last_name
    out.phone = profile.phone
    return out


@router.post("/change-password", status_code=204, dependencies=[_RateLimited])
async def change_password(
    response: Response, body: ChangePasswordIn, db: DbSession, user: CurrentUser
) -> Response:
    """Change the signed-in user's password and force re-login on every device."""
    await auth_service.change_password(
        db, user, current_password=body.current_password, new_password=body.new_password
    )
    _clear_refresh_cookie(response)  # force re-login everywhere
    response.status_code = 204
    return response
