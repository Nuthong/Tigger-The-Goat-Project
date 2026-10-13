"""/api/v1/admin - system administration: the audit trail and user accounts."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, or_, select, text

from app.api.deps import DbSession, PageParams, RequireAnyStaff, RequireManager, require_role
from app.core.security import hash_password
from app.exceptions import ConflictError, ForbiddenError, NotFoundError
from app.models.auth import AppUser, AuthEvent
from app.models.ops import AuditLog
from app.models.people import Customer, Staff
from app.schemas.common import Page
from app.schemas.ops import (
    AuditRow,
    AuthEventRow,
    AuthEventStats,
    EmployeeCreateIn,
    ReviewRow,
    StaffOption,
    UserPatch,
    UserRow,
)
from app.services import ops_service

router = APIRouter(prefix="/admin", tags=["admin"])

RequireAdmin = Annotated[AppUser, Depends(require_role("admin"))]


def _booking_ref_id(ref: str) -> int:
    """`TIG-00042` / `42` -> 42; blank -> 0 ("any"); anything else -> -1, which
    matches no booking rather than every booking."""
    ref = ref.strip()
    if not ref:
        return 0
    digits = ref.upper().removeprefix("TIG-").lstrip("0")
    return int(digits) if digits.isdigit() else -1


@router.get("/audit", response_model=Page[AuditRow])
async def audit_trail(
    db: DbSession,
    _: RequireManager,
    page: PageParams,
    entity_type: Annotated[str | None, Query(max_length=30)] = None,
    action: Annotated[str | None, Query(max_length=40)] = None,
    actor: Annotated[
        str | None, Query(max_length=80, description="actor label, partial match")
    ] = None,
    at_from: Annotated[date | None, Query(description="only entries on/after this date")] = None,
    at_to: Annotated[date | None, Query(description="only entries on/before this date")] = None,
    entity_id: Annotated[str | None, Query(max_length=40, description="exact record id")] = None,
    summary: Annotated[
        str | None, Query(max_length=80, description="summary text, partial match")
    ] = None,
) -> Page[AuditRow]:
    where = []
    if entity_type:
        where.append(AuditLog.entity_type == entity_type)
    if action and action.strip():
        # partial, so "booking." finds every booking action
        where.append(AuditLog.action.ilike(f"%{action.strip()}%"))
    if entity_id and entity_id.strip():
        where.append(AuditLog.entity_id == entity_id.strip().lstrip("#"))
    if summary and summary.strip():
        where.append(AuditLog.summary.ilike(f"%{summary.strip()}%"))
    if actor and actor.strip():
        where.append(AuditLog.actor_label.ilike(f"%{actor.strip()}%"))
    if at_from is not None:
        where.append(func.date(AuditLog.at) >= at_from)
    if at_to is not None:
        where.append(func.date(AuditLog.at) <= at_to)
    total = await db.scalar(select(func.count()).select_from(AuditLog).where(*where)) or 0
    rows = (
        await db.scalars(
            select(AuditLog)
            .where(*where)
            .order_by(AuditLog.audit_id.desc())
            .limit(page.limit)
            .offset(page.offset)
        )
    ).all()
    return Page(
        items=[AuditRow.model_validate(r) for r in rows],
        total=total,
        limit=page.limit,
        offset=page.offset,
    )


# CAST(), not `::` - text() treats ":name::date" as a bind param named "name::date".
_REVIEWS_SQL = text(
    """
    SELECT rv.review_id, rv.booking_id, rv.rating, rv.comment, rv.created_at,
           c.first_name || ' ' || c.last_name AS customer_name,
           (SELECT r.name FROM booking_room br
              JOIN room rm ON rm.room_id = br.room_id
              JOIN room_type r ON r.room_type_id = rm.room_type_id
             WHERE br.booking_id = rv.booking_id
             ORDER BY br.booking_room_id LIMIT 1) AS room_type
    FROM review rv
    JOIN booking bk  ON bk.booking_id = rv.booking_id
    JOIN customer c  ON c.customer_id = bk.customer_id
    WHERE (:rating = 0 OR rv.rating = :rating)
      AND (:q = '' OR c.first_name || ' ' || c.last_name ILIKE :like OR rv.comment ILIKE :like)
      AND (CAST(:created_from AS date) IS NULL OR rv.created_at::date >= :created_from)
      AND (CAST(:created_to AS date) IS NULL OR rv.created_at::date <= :created_to)
      AND (:room_type_id = 0 OR EXISTS (
             SELECT 1 FROM booking_room br JOIN room rm ON rm.room_id = br.room_id
             WHERE br.booking_id = rv.booking_id AND rm.room_type_id = :room_type_id))
      AND (:guest = '' OR c.first_name || ' ' || c.last_name ILIKE :guest_like)
      AND (:comment = '' OR rv.comment ILIKE :comment_like)
      AND (:booking_ref = 0 OR rv.booking_id = :booking_ref)
    ORDER BY rv.created_at DESC, rv.review_id DESC
    LIMIT :limit OFFSET :offset
    """
)
_REVIEWS_COUNT_SQL = text(
    """
    SELECT COUNT(*)
    FROM review rv
    JOIN booking bk ON bk.booking_id = rv.booking_id
    JOIN customer c ON c.customer_id = bk.customer_id
    WHERE (:rating = 0 OR rv.rating = :rating)
      AND (:q = '' OR c.first_name || ' ' || c.last_name ILIKE :like OR rv.comment ILIKE :like)
      AND (CAST(:created_from AS date) IS NULL OR rv.created_at::date >= :created_from)
      AND (CAST(:created_to AS date) IS NULL OR rv.created_at::date <= :created_to)
      AND (:room_type_id = 0 OR EXISTS (
             SELECT 1 FROM booking_room br JOIN room rm ON rm.room_id = br.room_id
             WHERE br.booking_id = rv.booking_id AND rm.room_type_id = :room_type_id))
      AND (:guest = '' OR c.first_name || ' ' || c.last_name ILIKE :guest_like)
      AND (:comment = '' OR rv.comment ILIKE :comment_like)
      AND (:booking_ref = 0 OR rv.booking_id = :booking_ref)
    """
)
_REVIEWS_STATS_SQL = text(
    """
    SELECT COUNT(*)                              AS count,
           COALESCE(ROUND(AVG(rating), 2), 0)    AS average,
           COUNT(*) FILTER (WHERE rating = 5)    AS r5,
           COUNT(*) FILTER (WHERE rating = 4)    AS r4,
           COUNT(*) FILTER (WHERE rating = 3)    AS r3,
           COUNT(*) FILTER (WHERE rating = 2)    AS r2,
           COUNT(*) FILTER (WHERE rating = 1)    AS r1
    FROM review
    """
)


class ReviewStats(BaseModel):
    """Whole-board rating tallies for the feedback header - the average and the
    star distribution are over every review, not just the page on screen."""

    count: int
    average: Decimal
    r5: int
    r4: int
    r3: int
    r2: int
    r1: int


@router.get("/reviews", response_model=Page[ReviewRow])
async def list_reviews(
    db: DbSession,
    _: RequireAnyStaff,
    page: PageParams,
    rating: Annotated[int | None, Query(ge=1, le=5)] = None,
    q: Annotated[str, Query(max_length=80, description="guest name or comment text")] = "",
    created_from: Annotated[
        date | None, Query(description="only reviews left on/after this date")
    ] = None,
    created_to: Annotated[
        date | None, Query(description="only reviews left on/before this date")
    ] = None,
    room_type_id: Annotated[
        int | None, Query(description="only reviews for stays booked in this room type")
    ] = None,
    guest: Annotated[str, Query(max_length=80, description="guest name, partial")] = "",
    comment: Annotated[str, Query(max_length=80, description="comment text, partial")] = "",
    booking_ref: Annotated[str, Query(max_length=20, description="TIG-00042 or 42")] = "",
) -> Page[ReviewRow]:
    """The guest feedback board, newest first - filterable by every column."""
    term = q.strip()
    params: dict[str, object] = {
        "rating": rating or 0,
        "q": term,
        "like": f"%{term}%",
        "limit": page.limit,
        "offset": page.offset,
        "created_from": created_from,
        "created_to": created_to,
        "room_type_id": room_type_id or 0,
        "guest": guest.strip(),
        "guest_like": f"%{guest.strip()}%",
        "comment": comment.strip(),
        "comment_like": f"%{comment.strip()}%",
        "booking_ref": _booking_ref_id(booking_ref),
    }
    total = await db.scalar(_REVIEWS_COUNT_SQL, params) or 0
    rows = (await db.execute(_REVIEWS_SQL, params)).mappings().all()
    return Page(
        items=[ReviewRow(**row) for row in rows],
        total=total,
        limit=page.limit,
        offset=page.offset,
    )


@router.get("/reviews/stats", response_model=ReviewStats)
async def review_stats(db: DbSession, _: RequireAnyStaff) -> dict[str, object]:
    row = (await db.execute(_REVIEWS_STATS_SQL)).one()
    return dict(row._mapping)


@router.get("/staff", response_model=list[StaffOption])
async def staff_options(
    db: DbSession,
    _: RequireAnyStaff,
    role: Annotated[str | None, Query(max_length=20)] = None,
) -> list[Staff]:
    """Who work can be assigned to - used by the housekeeping and ticket screens."""
    stmt = select(Staff).where(Staff.is_active.is_(True))
    if role:
        stmt = stmt.where(Staff.role == role)
    return list((await db.scalars(stmt.order_by(Staff.first_name))).all())


@router.get("/users", response_model=Page[UserRow])
async def list_users(
    db: DbSession,
    _: RequireAdmin,
    page: PageParams,
    kind: Annotated[str | None, Query(pattern=r"^(staff|guest)$")] = None,
    q: Annotated[str, Query(max_length=80, description="username or email")] = "",
    role: Annotated[str | None, Query(max_length=20, description="exact role")] = None,
    is_active: Annotated[bool | None, Query()] = None,
    username: Annotated[str, Query(max_length=50, description="partial")] = "",
    email: Annotated[str, Query(max_length=120, description="partial")] = "",
    name: Annotated[str, Query(max_length=80, description="linked person, partial")] = "",
    login_from: Annotated[date | None, Query(description="last sign-in on/after")] = None,
    login_to: Annotated[date | None, Query(description="last sign-in on/before")] = None,
    never_signed_in: Annotated[bool | None, Query()] = None,
) -> Page[UserRow]:
    """Sign-in accounts. `kind=staff` is every non-customer login (the ~35 shown
    in one go); `kind=guest` is the customer logins - ~1,000 of them, so the
    caller pages through with `limit` / `offset` and an optional `q`."""
    where = []
    if kind == "staff":
        where.append(AppUser.role != "customer")
    elif kind == "guest":
        where.append(AppUser.role == "customer")
    if role:
        where.append(AppUser.role == role)
    if is_active is not None:
        where.append(AppUser.is_active == is_active)
    term = q.strip()
    if term:
        like = f"%{term}%"
        where.append(or_(AppUser.username.ilike(like), AppUser.email.ilike(like)))
    # one filter per column of the accounts table
    if username.strip():
        where.append(AppUser.username.ilike(f"%{username.strip()}%"))
    if email.strip():
        where.append(AppUser.email.ilike(f"%{email.strip()}%"))
    if name.strip():
        like = f"%{name.strip()}%"
        where.append(
            or_(
                AppUser.staff_id.in_(
                    select(Staff.staff_id).where(
                        func.concat(Staff.first_name, " ", Staff.last_name).ilike(like)
                    )
                ),
                AppUser.customer_id.in_(
                    select(Customer.customer_id).where(
                        func.concat(Customer.first_name, " ", Customer.last_name).ilike(like)
                    )
                ),
            )
        )
    if login_from is not None:
        where.append(func.date(AppUser.last_login_at) >= login_from)
    if login_to is not None:
        where.append(func.date(AppUser.last_login_at) <= login_to)
    if never_signed_in is True:
        where.append(AppUser.last_login_at.is_(None))
    elif never_signed_in is False:
        where.append(AppUser.last_login_at.is_not(None))
    total = await db.scalar(select(func.count()).select_from(AppUser).where(*where)) or 0
    # the person behind each login: a staff record (name, phone, hire date) or
    # a guest profile (name, phone) - `chk_user_identity` guarantees one of them
    rows = (
        await db.execute(
            select(AppUser, Staff, Customer)
            .outerjoin(Staff, Staff.staff_id == AppUser.staff_id)
            .outerjoin(Customer, Customer.customer_id == AppUser.customer_id)
            .where(*where)
            .order_by(AppUser.user_id)
            .limit(page.limit)
            .offset(page.offset)
        )
    ).all()
    items: list[UserRow] = []
    for account, staff, guest in rows:
        row = UserRow.model_validate(account)
        person = staff or guest
        if person is not None:
            row.full_name = person.full_name
            row.phone = person.phone
        if staff is not None:
            row.hired_at = staff.hired_at
        items.append(row)
    return Page(items=items, total=total, limit=page.limit, offset=page.offset)


@router.post("/users", response_model=UserRow, status_code=201)
async def create_employee(body: EmployeeCreateIn, db: DbSession, user: RequireAdmin) -> AppUser:
    """Create a staff login - a `staff` record plus the `app_user` that signs in
    as it. Guest accounts are made through `/auth/register`, never here."""
    email = body.email.lower()
    clash = await db.scalar(
        select(AppUser.user_id).where(
            (AppUser.username == body.username) | (func.lower(AppUser.email) == email)
        )
    )
    if clash is not None:
        raise ConflictError("username or email already in use", code="already_exists")
    if await db.scalar(select(Staff.staff_id).where(func.lower(Staff.email) == email)):
        raise ConflictError("a staff member with that email already exists", code="already_exists")

    staff = Staff(
        first_name=body.first_name,
        last_name=body.last_name,
        email=body.email,
        phone=body.phone,
        role=body.role,
    )
    db.add(staff)
    await db.flush()

    account = AppUser(
        username=body.username,
        email=body.email,
        password_hash=hash_password(body.password),
        role=body.role,
        staff_id=staff.staff_id,
    )
    db.add(account)
    await db.flush()
    await ops_service.write_audit(
        db,
        actor_user_id=user.user_id,
        actor_label=user.username,
        action="user.create",
        entity_type="app_user",
        entity_id=str(account.user_id),
        summary=f"created {body.role} account {body.username}",
        data={"role": body.role, "staff_id": staff.staff_id},
    )
    return account


@router.patch("/users/{user_id}", response_model=UserRow)
async def update_user(user_id: int, body: UserPatch, db: DbSession, user: RequireAdmin) -> AppUser:
    target = await db.get(AppUser, user_id)
    if target is None:
        raise NotFoundError("user not found")
    if target.user_id == user.user_id and (body.is_active is False or body.role is not None):
        raise ForbiddenError("you cannot change your own role or disable yourself")

    if body.role is not None and body.role != target.role:
        # a guest account's role is fixed by registration - admins may only
        # disable or delete it, never re-grade it into a staff role
        if target.customer_id is not None or target.role == "customer":
            raise ForbiddenError(
                "a customer account's role is set at sign-up and cannot be changed; "
                "disable or delete it instead",
                code="customer_role_locked",
            )
        # the DB CHECK `chk_user_identity` ties the role to the kind of identity
        if body.role == "customer":
            raise ConflictError(
                "this account is linked to a staff record and cannot become 'customer'",
                code="identity_mismatch",
            )
        target.role = body.role
        # any token already issued names the old role - force a re-login
        target.token_version += 1

    if body.is_active is not None:
        target.is_active = body.is_active
        # a disabled employee should drop out of the assignment lists too
        # (`/admin/staff` offers only active staff records)
        if target.staff_id is not None:
            staff = await db.get(Staff, target.staff_id)
            if staff is not None:
                staff.is_active = body.is_active
    if body.unlock:
        target.locked_until = None
        target.failed_login_count = 0

    await db.flush()
    await ops_service.write_audit(
        db,
        actor_user_id=user.user_id,
        actor_label=user.username,
        action="user.update",
        entity_type="app_user",
        entity_id=str(user_id),
        summary=f"{target.username}: role={target.role} active={target.is_active}",
        data=body.model_dump(exclude_unset=True, mode="json"),
    )
    return target


@router.delete("/users/{user_id}", status_code=204)
async def delete_user(user_id: int, db: DbSession, user: RequireAdmin) -> None:
    """Remove a login account. A linked guest/staff profile - and its booking
    history - is kept; only the sign-in record goes."""
    target = await db.get(AppUser, user_id)
    if target is None:
        raise NotFoundError("user not found")
    if target.user_id == user.user_id:
        raise ForbiddenError("you cannot delete your own account")
    label = target.username
    await db.delete(target)
    await db.flush()
    await ops_service.write_audit(
        db,
        actor_user_id=user.user_id,
        actor_label=user.username,
        action="user.delete",
        entity_type="app_user",
        entity_id=str(user_id),
        summary=f"deleted account {label}",
    )


_AUTH_EVENT = r"^(login_success|login_fail|logout|locked|password_change)$"


@router.get("/auth-events", response_model=Page[AuthEventRow])
async def auth_events(
    db: DbSession,
    _: RequireAdmin,
    page: PageParams,
    event_type: Annotated[str | None, Query(pattern=_AUTH_EVENT)] = None,
    q: Annotated[str, Query(max_length=80, description="username, partial match")] = "",
    at_from: Annotated[date | None, Query(description="only events on/after this date")] = None,
    at_to: Annotated[date | None, Query(description="only events on/before this date")] = None,
    ip: Annotated[str, Query(max_length=45, description="IP address, partial")] = "",
    browser: Annotated[str, Query(max_length=80, description="user agent, partial")] = "",
) -> Page[AuthEventRow]:
    """The sign-in log (`auth_event`), newest first: successes, failures,
    lockouts, sign-outs and password changes, with IP and browser."""
    where = []
    if event_type:
        where.append(AuthEvent.event_type == event_type)
    if ip.strip():
        where.append(func.host(AuthEvent.ip_address).ilike(f"%{ip.strip()}%"))
    if browser.strip():
        where.append(AuthEvent.user_agent.ilike(f"%{browser.strip()}%"))
    term = q.strip()
    if term:
        like = f"%{term}%"
        where.append(or_(AppUser.username.ilike(like), AuthEvent.username_tried.ilike(like)))
    if at_from is not None:
        where.append(func.date(AuthEvent.created_at) >= at_from)
    if at_to is not None:
        where.append(func.date(AuthEvent.created_at) <= at_to)
    base = select(AuthEvent, AppUser.username, AppUser.role).outerjoin(
        AppUser, AppUser.user_id == AuthEvent.user_id
    )
    total = (
        await db.scalar(
            select(func.count())
            .select_from(AuthEvent)
            .outerjoin(AppUser, AppUser.user_id == AuthEvent.user_id)
            .where(*where)
        )
        or 0
    )
    rows = await db.execute(
        base.where(*where)
        .order_by(AuthEvent.created_at.desc(), AuthEvent.event_id.desc())
        .limit(page.limit)
        .offset(page.offset)
    )
    items = [
        AuthEventRow(
            event_id=ev.event_id,
            created_at=ev.created_at,
            event_type=ev.event_type,
            user_id=ev.user_id,
            username=username or ev.username_tried,
            role=role,
            ip_address=str(ev.ip_address) if ev.ip_address is not None else None,
            user_agent=ev.user_agent,
        )
        for ev, username, role in rows
    ]
    return Page(items=items, total=total, limit=page.limit, offset=page.offset)


@router.get("/auth-events/stats", response_model=AuthEventStats)
async def auth_event_stats(
    db: DbSession,
    _: RequireAdmin,
    days: Annotated[int, Query(ge=1, le=90)] = 7,
) -> AuthEventStats:
    """How many of each sign-in event happened in the last `days` days."""
    since = datetime.now(UTC) - timedelta(days=days)
    counts = {
        str(kind): int(n)
        for kind, n in await db.execute(
            select(AuthEvent.event_type, func.count())
            .where(AuthEvent.created_at >= since)
            .group_by(AuthEvent.event_type)
        )
    }
    distinct_users = (
        await db.scalar(
            select(func.count(func.distinct(AuthEvent.user_id))).where(
                AuthEvent.created_at >= since, AuthEvent.event_type == "login_success"
            )
        )
        or 0
    )
    return AuthEventStats(
        days=days,
        login_success=counts.get("login_success", 0),
        login_fail=counts.get("login_fail", 0),
        logout=counts.get("logout", 0),
        locked=counts.get("locked", 0),
        password_change=counts.get("password_change", 0),
        distinct_users=int(distinct_users),
    )
