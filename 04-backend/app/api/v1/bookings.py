"""/api/v1/bookings - create, list (ownership-scoped), status transitions, payments, review."""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated

from fastapi import APIRouter, Query
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import ColumnElement, TextClause, func, or_, select, text

from app.api.deps import CurrentUser, DbSession, PageParams, RequireStaff
from app.exceptions import ConflictError, ForbiddenError, NotFoundError
from app.models.auth import FRONT_DESK_ROLES
from app.models.booking import BOOKING_STATUSES, Booking, BookingRoom, Review
from app.models.catalog import Room
from app.models.people import Customer
from app.schemas.booking import (
    BookingBillOut,
    BookingCreateIn,
    BookingOut,
    BookingServiceAddIn,
    GuestPaymentIn,
    PaymentIn,
)
from app.schemas.common import Page
from app.services import booking_service, ops_service

router = APIRouter(prefix="/bookings", tags=["bookings"])

# "does this booking still owe money" as SQL, mirroring Booking.balance_due
# exactly (room + service charges, less what's paid, plus what's since been
# refunded; cancelled stays never owe anything). Two full static literals -
# not built from an f-string/format() - so they stay outside the S608 gate.
_BOOKING_UNPAID = text(
    """
    (booking.status <> 'cancelled' AND booking.booking_id IN (
        SELECT b.booking_id FROM booking b
        LEFT JOIN (
            SELECT br.booking_id,
                   SUM(br.price_per_night * (bk.check_out_date - bk.check_in_date)) AS amt
            FROM booking_room br JOIN booking bk ON bk.booking_id = br.booking_id
            GROUP BY br.booking_id
        ) r ON r.booking_id = b.booking_id
        LEFT JOIN (
            SELECT booking_id, SUM(quantity * unit_price) AS amt
            FROM booking_service GROUP BY booking_id
        ) s ON s.booking_id = b.booking_id
        LEFT JOIN (
            SELECT booking_id, SUM(amount) AS amt FROM payment
            WHERE status = 'paid' GROUP BY booking_id
        ) p ON p.booking_id = b.booking_id
        LEFT JOIN (
            SELECT booking_id, SUM(amount) AS amt FROM payment
            WHERE status = 'refunded' GROUP BY booking_id
        ) rf ON rf.booking_id = b.booking_id
        WHERE COALESCE(r.amt, 0) + COALESCE(s.amt, 0)
              - COALESCE(p.amt, 0) + COALESCE(rf.amt, 0) > 0
    ))
    """
)
# a live stay with nothing left to pay - a cancelled one is neither paid nor
# owing, so it matches neither filter
_BOOKING_PAID = text(
    """
    (booking.status <> 'cancelled' AND booking.booking_id IN (
        SELECT b.booking_id FROM booking b
        LEFT JOIN (
            SELECT br.booking_id,
                   SUM(br.price_per_night * (bk.check_out_date - bk.check_in_date)) AS amt
            FROM booking_room br JOIN booking bk ON bk.booking_id = br.booking_id
            GROUP BY br.booking_id
        ) r ON r.booking_id = b.booking_id
        LEFT JOIN (
            SELECT booking_id, SUM(quantity * unit_price) AS amt
            FROM booking_service GROUP BY booking_id
        ) s ON s.booking_id = b.booking_id
        LEFT JOIN (
            SELECT booking_id, SUM(amount) AS amt FROM payment
            WHERE status = 'paid' GROUP BY booking_id
        ) p ON p.booking_id = b.booking_id
        LEFT JOIN (
            SELECT booking_id, SUM(amount) AS amt FROM payment
            WHERE status = 'refunded' GROUP BY booking_id
        ) rf ON rf.booking_id = b.booking_id
        WHERE COALESCE(r.amt, 0) + COALESCE(s.amt, 0)
              - COALESCE(p.amt, 0) + COALESCE(rf.amt, 0) <= 0
    ))
    """
)


class ReviewIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rating: int = Field(ge=1, le=5)
    comment: str | None = Field(default=None, max_length=500)


class ReviewOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    review_id: int
    booking_id: int
    rating: int
    comment: str | None
    created_at: datetime


def _own_scope(user: CurrentUser) -> int | None:
    """Return the customer_id a non-staff user is limited to; None for staff."""
    return user.customer_id if user.role == "customer" else None


def _desk_or_owner_scope(user: CurrentUser) -> int | None:
    """Changing a stay - cancelling, moving or settling it - is the guest's own
    business or the reservation desk's, never housekeeping's or accounting's
    (they may read a booking for their own work, but not change it)."""
    if user.role != "customer" and user.role not in FRONT_DESK_ROLES:
        raise ForbiddenError(f"requires role: {', '.join(FRONT_DESK_ROLES)}")
    return _own_scope(user)


@router.post("", response_model=BookingOut, status_code=201)
async def create_booking(body: BookingCreateIn, db: DbSession, user: CurrentUser) -> Booking:
    if user.role == "customer":
        # a guest books for themselves; the reservation is owned by the online
        # desk and opens as `pending` - it's only a real reservation once paid
        if user.customer_id is None:
            raise ForbiddenError("this account is not linked to a guest profile")
        return await booking_service.create_booking(
            db,
            customer_id=user.customer_id,
            staff_id=await booking_service.resolve_online_staff_id(db),
            data=body,
            status="pending",
        )
    # staff booking on behalf of a guest - only the reservation desk, never
    # housekeeping or accounting (they are staff, but not "not a customer" staff)
    if user.role not in FRONT_DESK_ROLES:
        raise ForbiddenError(f"requires role: {', '.join(FRONT_DESK_ROLES)}")
    if body.customer_id is None:
        raise ForbiddenError("customer_id is required when staff creates a booking")
    if user.staff_id is None:
        raise ForbiddenError("this account is not linked to a staff record")
    return await booking_service.create_booking(
        db, customer_id=body.customer_id, staff_id=user.staff_id, data=body
    )


class StatusCountsOut(BaseModel):
    pending: int = 0
    confirmed: int = 0
    checked_in: int = 0
    checked_out: int = 0
    cancelled: int = 0


@router.get("/status-counts", response_model=StatusCountsOut)
async def status_counts(db: DbSession, user: CurrentUser) -> dict[str, int]:
    """How many bookings sit in each lifecycle status - one GROUP BY instead of
    pulling every row. Scoped to the caller's own bookings for a guest."""
    stmt = select(Booking.status, func.count()).group_by(Booking.status)
    scope = _own_scope(user)
    if scope is not None:
        stmt = stmt.where(Booking.customer_id == scope)
    tallied: dict[str, int] = {str(status): int(n) for status, n in await db.execute(stmt)}
    return {s: tallied.get(s, 0) for s in BOOKING_STATUSES}


@router.get("", response_model=Page[BookingOut])
async def list_bookings(
    db: DbSession,
    user: CurrentUser,
    page: PageParams,
    status: Annotated[str | None, Query()] = None,
    arriving_on: Annotated[
        date | None, Query(description="only stays checking in on this date")
    ] = None,
    departing_on: Annotated[
        date | None, Query(description="only stays checking out on this date")
    ] = None,
    stay_from: Annotated[
        date | None, Query(description="only stays that overlap on/after this date")
    ] = None,
    stay_to: Annotated[
        date | None, Query(description="only stays that overlap on/before this date")
    ] = None,
    room_type_id: Annotated[
        int | None, Query(description="only stays booked in this room type")
    ] = None,
    payment_status: Annotated[
        str | None,
        Query(pattern=r"^(paid|unpaid)$", description="paid = no balance due; unpaid = still owed"),
    ] = None,
    min_guests: Annotated[
        int | None, Query(ge=1, description="only stays for at least this many guests")
    ] = None,
    max_guests: Annotated[
        int | None, Query(ge=1, description="only stays for at most this many guests")
    ] = None,
    q: Annotated[
        str | None, Query(max_length=80, description="match booking ref, guest name or room number")
    ] = None,
    ref: Annotated[
        str | None, Query(max_length=20, description="booking ref, e.g. TIG-00042 or 42")
    ] = None,
    guest: Annotated[str | None, Query(max_length=80, description="guest name, partial")] = None,
    room: Annotated[str | None, Query(max_length=10, description="room number, partial")] = None,
    min_nights: Annotated[int | None, Query(ge=1, description="stays of at least N nights")] = None,
    max_nights: Annotated[int | None, Query(ge=1, description="stays of at most N nights")] = None,
) -> Page[BookingOut]:
    where: list[ColumnElement[bool] | TextClause] = []
    scope = _own_scope(user)
    if scope is not None:
        where.append(Booking.customer_id == scope)
    if status:
        where.append(Booking.status == status)
    if arriving_on is not None:
        where.append(Booking.check_in_date == arriving_on)
    if departing_on is not None:
        where.append(Booking.check_out_date == departing_on)
    if min_guests is not None:
        where.append(Booking.num_guests >= min_guests)
    if max_guests is not None:
        where.append(Booking.num_guests <= max_guests)
    if payment_status == "unpaid":
        where.append(_BOOKING_UNPAID)
    elif payment_status == "paid":
        where.append(_BOOKING_PAID)
    # overlap: a stay touches the window when it starts before it ends and ends
    # after it starts - the query the reservation tape needs for a date range
    if stay_to is not None:
        where.append(Booking.check_in_date < stay_to)
    if stay_from is not None:
        where.append(stay_from < Booking.check_out_date)
    if room_type_id is not None:
        where.append(Booking.rooms.any(BookingRoom.room.has(Room.room_type_id == room_type_id)))
    # one filter per column of the bookings table (the "Advanced filters" panel)
    if ref and ref.strip():
        digits = ref.strip().upper().removeprefix("TIG-").lstrip("0")
        # a ref that is not a number matches nothing, rather than everything
        where.append(Booking.booking_id == (int(digits) if digits.isdigit() else -1))
    if guest and guest.strip():
        where.append(
            Booking.customer.has(
                func.concat(Customer.first_name, " ", Customer.last_name).ilike(
                    f"%{guest.strip()}%"
                )
            )
        )
    if room and room.strip():
        where.append(
            Booking.rooms.any(BookingRoom.room.has(Room.room_number.ilike(f"%{room.strip()}%")))
        )
    nights = Booking.check_out_date - Booking.check_in_date
    if min_nights is not None:
        where.append(nights >= min_nights)
    if max_nights is not None:
        where.append(nights <= max_nights)
    if q and q.strip():
        term = q.strip()
        like = f"%{term}%"
        digits = term.removeprefix("TIG-").removeprefix("tig-").lstrip("0")
        ref_match = [Booking.booking_id == int(digits)] if digits.isdigit() else []
        where.append(
            or_(
                Booking.customer.has(
                    func.concat(Customer.first_name, " ", Customer.last_name).ilike(like)
                ),
                Booking.rooms.any(BookingRoom.room.has(Room.room_number.ilike(like))),
                *ref_match,
            )
        )

    # a day sheet reads in stay order; the plain list is newest-first
    day_sheet = any(x is not None for x in (arriving_on, departing_on, stay_from, stay_to))
    order = (
        (Booking.check_in_date, Booking.check_out_date, Booking.booking_id)
        if day_sheet
        else (Booking.booking_id.desc(),)
    )

    total = await db.scalar(select(func.count()).select_from(Booking).where(*where)) or 0
    rows = (
        (
            await db.scalars(
                select(Booking)
                .options(*booking_service.booking_loader())  # type: ignore[arg-type]
                .where(*where)
                .order_by(*order)
                .limit(page.limit)
                .offset(page.offset)
            )
        )
        .unique()
        .all()
    )
    return Page(
        items=[BookingOut.model_validate(b) for b in rows],
        total=total,
        limit=page.limit,
        offset=page.offset,
    )


@router.get("/{booking_id}", response_model=BookingOut)
async def get_booking(booking_id: int, db: DbSession, user: CurrentUser) -> Booking:
    return await booking_service.get_booking_for(db, booking_id, as_customer_id=_own_scope(user))


@router.get("/{booking_id}/bill", response_model=BookingBillOut)
async def get_bill(booking_id: int, db: DbSession, user: CurrentUser) -> BookingBillOut:
    booking = await booking_service.get_booking_for(db, booking_id, as_customer_id=_own_scope(user))
    return booking_service.compute_bill(booking)


@router.post("/{booking_id}/check-in", response_model=BookingOut)
async def check_in(booking_id: int, db: DbSession, user: RequireStaff) -> Booking:
    return await booking_service.transition(
        db, booking_id, "check_in", actor_staff_id=user.staff_id
    )


@router.post("/{booking_id}/check-out", response_model=BookingOut)
async def check_out(booking_id: int, db: DbSession, user: RequireStaff) -> Booking:
    return await booking_service.transition(
        db, booking_id, "check_out", actor_staff_id=user.staff_id
    )


@router.post("/{booking_id}/services", response_model=BookingOut, status_code=201)
async def add_service(
    booking_id: int, body: BookingServiceAddIn, db: DbSession, user: RequireStaff
) -> Booking:
    """Front desk posts an add-on (breakfast, late checkout, minibar ...) to an
    open folio, at the catalog price of the moment (BR-6)."""
    booking = await booking_service.add_service(db, booking_id, body)
    line = next(s for s in booking.services if s.service_id == body.service_id)
    await ops_service.write_audit(
        db,
        actor_user_id=user.user_id,
        actor_label=user.username,
        action="booking.service_add",
        entity_type="booking",
        entity_id=str(booking_id),
        summary=f"+{body.quantity} x {line.service_name} @ {line.unit_price}",
        data={"service_id": body.service_id, "quantity": body.quantity},
    )
    return booking


@router.delete("/{booking_id}/services/{service_id}", response_model=BookingOut)
async def remove_service(
    booking_id: int, service_id: int, db: DbSession, user: RequireStaff
) -> Booking:
    """Take an add-on off an open folio; anything already paid for it is refunded."""
    booking = await booking_service.remove_service(db, booking_id, service_id)
    await ops_service.write_audit(
        db,
        actor_user_id=user.user_id,
        actor_label=user.username,
        action="booking.service_remove",
        entity_type="booking",
        entity_id=str(booking_id),
        summary=f"removed service #{service_id}",
        data={"service_id": service_id},
    )
    return booking


@router.post("/{booking_id}/cancel", response_model=BookingOut)
async def cancel(booking_id: int, db: DbSession, user: CurrentUser) -> Booking:
    scope = _desk_or_owner_scope(user)
    if scope is not None:
        # customer may only cancel their own booking
        await booking_service.get_booking_for(db, booking_id, as_customer_id=scope)
    return await booking_service.cancel_booking(db, booking_id)


class RescheduleIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    check_in_date: date
    check_out_date: date

    @model_validator(mode="after")
    def _order(self) -> RescheduleIn:
        if self.check_out_date <= self.check_in_date:
            raise ValueError("check_out_date must be after check_in_date")
        return self


@router.patch("/{booking_id}/dates", response_model=BookingOut)
async def reschedule(
    booking_id: int, body: RescheduleIn, db: DbSession, user: CurrentUser
) -> Booking:
    """Move a pending / confirmed booking to a new date window (same rooms),
    re-priced through the rate plans. Staff may move any booking; a guest may
    move their own while the arrival is still in the future."""
    booking = await booking_service.reschedule_booking(
        db,
        booking_id,
        check_in=body.check_in_date,
        check_out=body.check_out_date,
        as_customer_id=_desk_or_owner_scope(user),
    )
    await ops_service.write_audit(
        db,
        actor_user_id=user.user_id,
        actor_label=user.username,
        action="booking.reschedule",
        entity_type="booking",
        entity_id=str(booking_id),
        summary=f"dates -> {body.check_in_date.isoformat()} .. {body.check_out_date.isoformat()}",
    )
    return booking


@router.post("/{booking_id}/no-show", response_model=BookingOut)
async def no_show(booking_id: int, db: DbSession, user: RequireStaff) -> Booking:
    """Front desk marks a confirmed guest who never arrived. Keeps the first
    night as a fee (like a late cancel) and records the reason in the audit log."""
    booking = await booking_service.mark_no_show(db, booking_id)
    await ops_service.write_audit(
        db,
        actor_user_id=user.user_id,
        actor_label=user.username,
        action="booking.no_show",
        entity_type="booking",
        entity_id=str(booking_id),
        summary=f"{booking.customer_name} did not arrive; first night kept as a fee",
    )
    return booking


@router.post("/{booking_id}/payments", status_code=201)
async def add_payment(
    booking_id: int, body: PaymentIn, db: DbSession, _: RequireStaff
) -> dict[str, object]:
    payment = await booking_service.add_payment(db, booking_id, body)
    return {"payment_id": payment.payment_id, "status": payment.status}


@router.post("/{booking_id}/pay", response_model=BookingBillOut)
async def pay_booking(
    booking_id: int, body: GuestPaymentIn, db: DbSession, user: CurrentUser
) -> BookingBillOut:
    """Guest checkout - clears the whole balance in one online payment. Guests
    may only pay their own reservation; staff may pay any."""
    return await booking_service.pay_balance(
        db,
        booking_id,
        method=body.method,
        reference_no=body.reference_no,
        as_customer_id=_desk_or_owner_scope(user),
    )


@router.get("/{booking_id}/review", response_model=ReviewOut)
async def get_review(booking_id: int, db: DbSession, user: CurrentUser) -> Review:
    """The review left for this stay, if any (404 when none). Guests see only
    their own booking's review; staff see any."""
    scope = _own_scope(user)
    if scope is not None:
        await booking_service.get_booking_for(db, booking_id, as_customer_id=scope)
    review = await db.scalar(select(Review).where(Review.booking_id == booking_id))
    if review is None:
        raise NotFoundError("no review for this booking")
    return review


@router.post("/{booking_id}/review", response_model=ReviewOut, status_code=201)
async def add_review(booking_id: int, body: ReviewIn, db: DbSession, user: CurrentUser) -> Review:
    scope = _own_scope(user)
    if scope is None:
        raise ForbiddenError("only the guest can review a stay")
    booking = await booking_service.get_booking_for(db, booking_id, as_customer_id=scope)
    if booking.status != "checked_out":
        raise ConflictError("can only review after check-out")
    if await db.scalar(select(Review.review_id).where(Review.booking_id == booking_id)):
        raise ConflictError("this booking already has a review")
    review = Review(booking_id=booking_id, rating=body.rating, comment=body.comment)
    db.add(review)
    await db.flush()
    await db.refresh(review)
    return review
