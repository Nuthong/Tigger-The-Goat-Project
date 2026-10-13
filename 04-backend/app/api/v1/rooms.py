"""/api/v1 - room types, rooms, availability search, room status management."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import exists, func, select, text

from app.api.deps import (
    CurrentUser,
    DbSession,
    PageParams,
    RequireAnyStaff,
    RequireManager,
    RequireStaff,
)
from app.core import clock
from app.exceptions import ConflictError, NotFoundError
from app.models.booking import Booking, BookingRoom, RoomStatusLog
from app.models.catalog import Room, RoomType
from app.models.ops import HousekeepingTask
from app.models.people import Staff
from app.schemas.common import Page
from app.schemas.room import (
    AvailabilityQuery,
    AvailableRoomOut,
    AvailableRoomTypeOut,
    ReviewItemOut,
    RoomCreateIn,
    RoomOut,
    RoomStatusLogOut,
    RoomStatusUpdateIn,
    RoomTypeOut,
    RoomTypePatch,
    RoomTypeReviewsOut,
)
from app.services import booking_service, ops_service

router = APIRouter(tags=["rooms"])

# A review "belongs" to a room type when the stay it sits on used a room of that
# type. All three statements below are fully static - the only parameter is the
# bound `:rt` - so they carry no injection risk.
_ROOM_TYPES_SQL = text(
    """
    SELECT rt.room_type_id, rt.name, rt.description,
           rt.base_price_per_night, rt.max_occupancy,
           (SELECT ROUND(AVG(rv.rating)::numeric, 1) FROM review rv
              WHERE EXISTS (SELECT 1 FROM booking_room br
                            JOIN room r ON r.room_id = br.room_id
                            WHERE br.booking_id = rv.booking_id
                              AND r.room_type_id = rt.room_type_id)) AS avg_rating,
           (SELECT COUNT(*) FROM review rv
              WHERE EXISTS (SELECT 1 FROM booking_room br
                            JOIN room r ON r.room_id = br.room_id
                            WHERE br.booking_id = rv.booking_id
                              AND r.room_type_id = rt.room_type_id)) AS review_count
    FROM room_type rt
    ORDER BY rt.base_price_per_night
    """
)
_TYPE_REVIEW_AGG_SQL = text(
    """
    SELECT COUNT(*) AS count, ROUND(AVG(rv.rating)::numeric, 1) AS average,
           COUNT(*) FILTER (WHERE rv.rating = 1) AS d1,
           COUNT(*) FILTER (WHERE rv.rating = 2) AS d2,
           COUNT(*) FILTER (WHERE rv.rating = 3) AS d3,
           COUNT(*) FILTER (WHERE rv.rating = 4) AS d4,
           COUNT(*) FILTER (WHERE rv.rating = 5) AS d5
    FROM review rv
    WHERE EXISTS (SELECT 1 FROM booking_room br JOIN room r ON r.room_id = br.room_id
                  WHERE br.booking_id = rv.booking_id AND r.room_type_id = :rt)
    """
)
_TYPE_REVIEW_ITEMS_SQL = text(
    """
    SELECT rv.rating, rv.comment, rv.created_at,
           c.first_name || ' ' || left(c.last_name, 1) || '.' AS guest_name
    FROM review rv
    JOIN booking bk ON bk.booking_id = rv.booking_id
    JOIN customer c ON c.customer_id = bk.customer_id
    WHERE EXISTS (SELECT 1 FROM booking_room br JOIN room r ON r.room_id = br.room_id
                  WHERE br.booking_id = rv.booking_id AND r.room_type_id = :rt)
    ORDER BY (rv.comment IS NULL), rv.created_at DESC
    LIMIT 40
    """
)


@router.get("/room-types", response_model=list[RoomTypeOut])
async def list_room_types(db: DbSession) -> list[dict[str, object]]:
    # public - the marketing site shows these, with the guest rating baked in
    rows = await db.execute(_ROOM_TYPES_SQL)
    return [dict(r._mapping) for r in rows]


@router.patch("/room-types/{room_type_id}", response_model=RoomTypeOut)
async def update_room_type(
    room_type_id: int, body: RoomTypePatch, db: DbSession, user: RequireManager
) -> RoomType:
    """Manager edits a category. `base_price_per_night` is the list price that
    `fn_quote_room` falls back to on nights no rate plan covers; bookings
    already made keep the rate they locked in (BR-6)."""
    rt = await db.get(RoomType, room_type_id)
    if rt is None:
        raise NotFoundError("room_type not found")
    changes = body.model_dump(exclude_unset=True)
    if "max_occupancy" in changes and changes["max_occupancy"] is None:
        raise ConflictError("max_occupancy cannot be empty", code="bad_value")
    if "base_price_per_night" in changes and changes["base_price_per_night"] is None:
        raise ConflictError("base_price_per_night cannot be empty", code="bad_value")
    before = {k: str(getattr(rt, k)) for k in changes}
    for key, value in changes.items():
        setattr(rt, key, value)
    await db.flush()
    await ops_service.write_audit(
        db,
        actor_user_id=user.user_id,
        actor_label=user.username,
        action="room_type.update",
        entity_type="room_type",
        entity_id=str(room_type_id),
        summary=f"{rt.name}: " + ", ".join(sorted(changes)),
        data={"before": before, "after": {k: str(v) for k, v in changes.items()}},
    )
    return rt


@router.get("/room-types/{room_type_id}/reviews", response_model=RoomTypeReviewsOut)
async def room_type_reviews(room_type_id: int, db: DbSession) -> RoomTypeReviewsOut:
    # public - shown on each room page
    rt = await db.get(RoomType, room_type_id)
    if rt is None:
        raise NotFoundError("room_type not found")
    agg = (await db.execute(_TYPE_REVIEW_AGG_SQL, {"rt": room_type_id})).one()._mapping
    items = [
        dict(r._mapping) for r in await db.execute(_TYPE_REVIEW_ITEMS_SQL, {"rt": room_type_id})
    ]
    return RoomTypeReviewsOut(
        room_type_id=room_type_id,
        name=rt.name,
        average=agg["average"],
        count=int(agg["count"]),
        distribution={s: int(agg[f"d{s}"]) for s in range(1, 6)},
        items=[ReviewItemOut(**r) for r in items],
    )


@router.get("/rooms", response_model=Page[RoomOut])
async def list_rooms(
    db: DbSession,
    _: CurrentUser,
    page: PageParams,
    status: Annotated[
        str | None, Query(pattern=r"^(available|cleaning|maintenance|closed)$")
    ] = None,
    room_type_id: Annotated[int | None, Query(description="only this room type")] = None,
    floor: Annotated[int | None, Query(description="only this floor")] = None,
) -> Page[RoomOut]:
    where = [Room.status == status] if status else []
    if room_type_id is not None:
        where.append(Room.room_type_id == room_type_id)
    if floor is not None:
        where.append(Room.floor == floor)
    total = await db.scalar(select(func.count()).select_from(Room).where(*where)) or 0
    # "occupied" is not a stored room status - a room is occupied while it has a
    # checked-in booking. Derived here so the board reflects check-in/out live.
    occupied = (
        exists()
        .where(
            BookingRoom.room_id == Room.room_id,
            BookingRoom.booking_id == Booking.booking_id,
            Booking.status == "checked_in",
        )
        .label("occupied")
    )
    rows = (
        await db.execute(
            select(Room, occupied)
            .where(*where)
            .order_by(Room.room_number)
            .limit(page.limit)
            .offset(page.offset)
        )
    ).all()
    items: list[RoomOut] = []
    for room, is_occ in rows:
        out = RoomOut.model_validate(room)
        out.occupied = bool(is_occ)
        items.append(out)
    return Page(items=items, total=total, limit=page.limit, offset=page.offset)


@router.get("/room-types/availability", response_model=list[AvailableRoomTypeOut])
async def room_type_availability(
    db: DbSession, q: Annotated[AvailabilityQuery, Query()]
) -> list[dict[str, object]]:
    # public, guest-facing - one row per category (like real hotel sites)
    return await booking_service.find_available_room_types(
        db, check_in=q.check_in, check_out=q.check_out
    )


@router.get("/rooms/availability", response_model=list[AvailableRoomOut])
async def availability(
    db: DbSession, q: Annotated[AvailabilityQuery, Query()]
) -> list[dict[str, object]]:
    # public - per-room list (used by the staff portal)
    return await booking_service.find_available_rooms(
        db, check_in=q.check_in, check_out=q.check_out
    )


@router.post("/rooms", response_model=RoomOut, status_code=201)
async def create_room(body: RoomCreateIn, db: DbSession, _: RequireManager) -> Room:
    if await db.scalar(select(Room.room_id).where(Room.room_number == body.room_number)):
        raise ConflictError("room_number already exists")
    if not await db.get(RoomType, body.room_type_id):
        raise NotFoundError("room_type not found")
    room = Room(
        room_number=body.room_number,
        floor=body.floor,
        room_type_id=body.room_type_id,
        status="available",
        note=body.note,
    )
    db.add(room)
    await db.flush()
    return room


@router.patch("/rooms/{room_id}/status", response_model=RoomOut)
async def update_room_status(
    room_id: int, body: RoomStatusUpdateIn, db: DbSession, staff: RequireStaff
) -> Room:
    room = await db.get(Room, room_id)
    if room is None:
        raise NotFoundError("room not found")
    if room.status == body.status:
        return room
    await ops_service.change_room_status(db, room, body.status, staff_id=staff.staff_id)

    # flagging a room "cleaning" from the Rooms board should show up on the
    # housekeeping board too - add a task unless one is already open for it
    if body.status == "cleaning":
        open_task = await db.scalar(
            select(HousekeepingTask.task_id).where(
                HousekeepingTask.room_id == room.room_id,
                HousekeepingTask.status.in_(("pending", "in_progress")),
            )
        )
        if open_task is None:
            db.add(
                HousekeepingTask(
                    room_id=room.room_id,
                    task_type="deep_clean",
                    status="pending",
                    scheduled_for=clock.today(),
                    note="Flagged from the Rooms board",
                )
            )

    await db.flush()
    return room


@router.get("/rooms/{room_id}/status-log", response_model=list[RoomStatusLogOut])
async def room_status_log(
    room_id: int,
    db: DbSession,
    _: RequireAnyStaff,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> list[RoomStatusLogOut]:
    """A room's physical-status history, newest first - who moved it from what
    to what, and when (`room_status_log` joined to `staff`)."""
    if await db.get(Room, room_id) is None:
        raise NotFoundError("room not found")
    rows = await db.execute(
        select(RoomStatusLog, Staff.first_name, Staff.last_name)
        .join(Staff, Staff.staff_id == RoomStatusLog.changed_by)
        .where(RoomStatusLog.room_id == room_id)
        .order_by(RoomStatusLog.changed_at.desc(), RoomStatusLog.log_id.desc())
        .limit(limit)
    )
    return [
        RoomStatusLogOut(
            log_id=log.log_id,
            room_id=log.room_id,
            old_status=log.old_status,
            new_status=log.new_status,
            changed_at=log.changed_at,
            changed_by=log.changed_by,
            changed_by_name=f"{first} {last}",
        )
        for log, first, last in rows
    ]
