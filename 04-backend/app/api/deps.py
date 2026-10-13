"""Reusable dependencies: DB session, current user, RBAC, pagination."""

from __future__ import annotations

from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from typing import Annotated, Any

import jwt
from fastapi import Depends, Header, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_token
from app.db.session import get_db, get_readonly_db
from app.exceptions import AuthError, ForbiddenError
from app.models.auth import (
    ACCOUNTING_ROLES,
    FRONT_DESK_ROLES,
    HOUSEKEEPING_ROLES,
    MANAGER_ROLES,
    STAFF_USER_ROLES,
    AppUser,
)

DbSession = Annotated[AsyncSession, Depends(get_db)]
#: reporting reads - bound to the app_readonly role when DATABASE_URL_READONLY is set
ReadonlyDbSession = Annotated[AsyncSession, Depends(get_readonly_db)]


async def get_current_user(
    db: DbSession,
    authorization: Annotated[str | None, Header()] = None,
) -> AppUser:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise AuthError("missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    try:
        payload = decode_token(token, expected_type="access")
    except jwt.InvalidTokenError as exc:
        raise AuthError("invalid or expired token") from exc

    user = await db.get(AppUser, int(payload["sub"]))
    if user is None or not user.is_active:
        raise AuthError("account not found or disabled")
    if int(payload.get("tv", -1)) != user.token_version:
        raise AuthError("token has been revoked")

    # tell the DB who is acting so the audit triggers in schema.sql can name
    # them; transaction-local, so it never leaks between requests
    from app.services.ops_service import set_actor

    await set_actor(db, user.username)
    return user


CurrentUser = Annotated[AppUser, Depends(get_current_user)]


def require_role(*roles: str) -> Callable[..., Coroutine[Any, Any, AppUser]]:
    async def _dep(user: CurrentUser) -> AppUser:
        if user.role not in roles:
            raise ForbiddenError(f"requires role: {', '.join(roles)}")
        return user

    return _dep


#: the reservation desk - creates bookings, checks guests in, takes payment
RequireStaff = Annotated[AppUser, Depends(require_role(*FRONT_DESK_ROLES))]
#: anyone who works here, whatever their department (reads shared boards)
RequireAnyStaff = Annotated[AppUser, Depends(require_role(*STAFF_USER_ROLES))]
RequireManager = Annotated[AppUser, Depends(require_role(*MANAGER_ROLES))]
RequireHousekeeping = Annotated[AppUser, Depends(require_role(*HOUSEKEEPING_ROLES))]
RequireAccounting = Annotated[AppUser, Depends(require_role(*ACCOUNTING_ROLES))]


@dataclass
class Pagination:
    limit: int
    offset: int


def pagination(
    # 1000 is the ceiling so the reservation tape can pull a whole wide window
    # in one request; normal listings page at 20-50
    limit: Annotated[int, Query(ge=1, le=1000)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Pagination:
    return Pagination(limit=limit, offset=offset)


PageParams = Annotated[Pagination, Depends(pagination)]
