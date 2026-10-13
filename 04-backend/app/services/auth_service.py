"""Authentication use-cases: register, login (with lockout + audit), token issue/rotate.

Implements SECURITY.md 2.1: bcrypt, short access token, rotating refresh token,
failed-login lockout, generic error messages, every attempt written to auth_event.
"""

from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta
from functools import lru_cache

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_token, hash_password, verify_password
from app.exceptions import AuthError, ConflictError
from app.models.auth import AppUser, AuthEvent
from app.models.people import Customer
from app.schemas.auth import RegisterIn

_GENERIC_LOGIN_ERROR = "invalid username or password"


@lru_cache(maxsize=1)
def _dummy_hash() -> str:
    """A well-formed bcrypt hash at the same cost as real ones, made once. A
    malformed string makes bcrypt reject it instantly ("Invalid salt") without
    hashing, which is exactly the timing difference this exists to hide."""
    return hash_password(secrets.token_urlsafe(16))


def _now() -> datetime:
    return datetime.now(UTC)


async def _record_event(
    db: AsyncSession,
    *,
    event_type: str,
    user_id: int | None,
    username_tried: str | None,
    ip: str | None,
    user_agent: str | None,
) -> None:
    db.add(
        AuthEvent(
            user_id=user_id,
            username_tried=username_tried,
            event_type=event_type,
            ip_address=ip,
            user_agent=(user_agent or "")[:255] or None,
        )
    )
    await db.flush()


async def register_customer(db: AsyncSession, data: RegisterIn) -> AppUser:
    dupe = await db.scalar(
        select(AppUser.user_id).where(
            (AppUser.username == data.username) | (AppUser.email == data.email)
        )
    )
    if dupe is not None:
        raise ConflictError("username or email already registered", code="already_exists")

    customer = Customer(
        first_name=data.first_name,
        last_name=data.last_name,
        email=data.email,
        phone=data.phone,
    )
    db.add(customer)
    await db.flush()

    user = AppUser(
        username=data.username,
        email=data.email,
        password_hash=hash_password(data.password),
        role="customer",
        customer_id=customer.customer_id,
    )
    db.add(user)
    await db.flush()
    return user


def issue_tokens(user: AppUser) -> tuple[str, str, int]:
    """Return (access_token, refresh_token, access_expires_in_seconds)."""
    settings = get_settings()
    access, _ = create_token(
        subject=user.user_id,
        role=user.role,
        token_type="access",  # noqa: S106  (token kind, not a secret)
        token_version=user.token_version,
    )
    refresh, _ = create_token(
        subject=user.user_id,
        role=user.role,
        token_type="refresh",  # noqa: S106  (token kind, not a secret)
        token_version=user.token_version,
    )
    return access, refresh, settings.access_token_ttl_minutes * 60


async def _find_login_user(db: AsyncSession, identifier: str) -> AppUser | None:
    """Resolve a login identifier to an account. Accepts the username, the
    account email, or - for guests - the customer profile's email or phone."""
    ident = identifier.strip()
    low = ident.lower()
    stmt = (
        select(AppUser)
        .outerjoin(Customer, Customer.customer_id == AppUser.customer_id)
        .where(
            (AppUser.username == ident)
            | (func.lower(AppUser.email) == low)
            | (func.lower(Customer.email) == low)
            | (Customer.phone == ident)
        )
        .order_by(AppUser.user_id)
        .limit(1)
    )
    return (await db.scalars(stmt)).first()


async def authenticate(
    db: AsyncSession,
    *,
    username: str,
    password: str,
    ip: str | None,
    user_agent: str | None,
) -> AppUser:
    settings = get_settings()
    user = await _find_login_user(db, username)

    async def _fail(err: AuthError) -> AuthError:
        # audit rows + lockout counter must survive even though the request "fails"
        await db.commit()
        return err

    if user is None:
        # run a real bcrypt compare so an unknown username takes as long as a
        # wrong password - otherwise the response time reveals which names exist
        verify_password(password, _dummy_hash())
        await _record_event(
            db,
            event_type="login_fail",
            user_id=None,
            username_tried=username,
            ip=ip,
            user_agent=user_agent,
        )
        raise await _fail(AuthError(_GENERIC_LOGIN_ERROR))

    if user.locked_until and user.locked_until > _now():
        await _record_event(
            db,
            event_type="login_fail",
            user_id=user.user_id,
            username_tried=username,
            ip=ip,
            user_agent=user_agent,
        )
        raise await _fail(AuthError("account temporarily locked, try again later", code="locked"))

    if not user.is_active or not verify_password(password, user.password_hash):
        user.failed_login_count += 1
        event = "login_fail"
        if user.failed_login_count >= settings.max_failed_logins:
            user.locked_until = _now() + timedelta(minutes=settings.lockout_minutes)
            user.failed_login_count = 0
            event = "locked"
        await _record_event(
            db,
            event_type=event,
            user_id=user.user_id,
            username_tried=username,
            ip=ip,
            user_agent=user_agent,
        )
        raise await _fail(AuthError(_GENERIC_LOGIN_ERROR))

    # success
    user.failed_login_count = 0
    user.locked_until = None
    user.last_login_at = _now()
    await _record_event(
        db,
        event_type="login_success",
        user_id=user.user_id,
        username_tried=username,
        ip=ip,
        user_agent=user_agent,
    )
    return user


async def change_password(
    db: AsyncSession, user: AppUser, *, current_password: str, new_password: str
) -> None:
    if not verify_password(current_password, user.password_hash):
        raise AuthError("current password is incorrect")
    user.password_hash = hash_password(new_password)
    user.password_changed_at = _now()
    user.token_version += 1  # invalidate every previously issued token
    await _record_event(
        db,
        event_type="password_change",
        user_id=user.user_id,
        username_tried=user.username,
        ip=None,
        user_agent=None,
    )
