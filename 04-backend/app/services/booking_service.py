"""Booking use-cases: availability search, create with price snapshot, status transitions, billing.

Business rules from 01-proposal/proposal.md (BR-3..BR-9). The DB trigger
`bi_booking_room_no_overlap` is the final backstop for BR-5; we also pre-check
here to return a friendly 409 instead of a raw database error.

The trigger alone is not enough under concurrency: at READ COMMITTED two
transactions booking the same room cannot see each other's uncommitted
`booking_room` row, so both pass (write skew). Every path that writes
`booking_room` therefore calls `_lock_rooms` first, which serializes writers
per room; the overlap check that follows runs on a fresh snapshot and sees the
winner's committed row.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import exists, func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app.core import clock
from app.core.config import get_settings
from app.exceptions import ConflictError, NotFoundError
from app.models.booking import (
    ACTIVE_BOOKING_STATUSES,
    Booking,
    BookingRoom,
    BookingService,
    Payment,
    RoomStatusLog,
)
from app.models.catalog import Room, Service
from app.models.ops import HousekeepingTask, Invoice
from app.models.people import Customer, Staff
from app.schemas.booking import (
    BookingBillOut,
    BookingCreateIn,
    BookingServiceAddIn,
    PaymentIn,
)
from app.services import ops_service
from app.services.addon_rules import BASIS_LABEL, max_quantity, service_basis

_ZERO = Decimal("0.00")


def addon_cap(service: Service, *, nights: int, rooms: int, guests: int) -> int:
    """The most of `service` one stay of this shape may carry (BR-29)."""
    basis = service_basis(service.name, service.description)
    return max_quantity(basis, nights=nights, rooms=rooms, guests=guests)


def _assert_addon_fits(
    service: Service, quantity: int, *, nights: int, rooms: int, guests: int
) -> None:
    cap = addon_cap(service, nights=nights, rooms=rooms, guests=guests)
    if quantity > cap:
        basis = service_basis(service.name, service.description)
        raise ConflictError(
            f"{service.name}: {quantity} is more than this stay can use - at most {cap} "
            f"({BASIS_LABEL[basis]}, {nights} night(s), {rooms} room(s), {guests} guest(s))",
            code="over_quantity",
        )


async def release_expired_holds(db: AsyncSession) -> None:
    """Cancel unpaid online `pending` holds past the hold window so their rooms
    go back into inventory. Only self-service holds (owned by the online desk)
    expire - a hold a receptionist is personally managing (e.g. awaiting a wire)
    is left alone, as is any hold that has taken a payment."""
    cutoff = datetime.now(UTC) - timedelta(minutes=get_settings().hold_expiry_minutes)
    online_staff_id = await resolve_online_staff_id(db)
    paid = exists().where(Payment.booking_id == Booking.booking_id, Payment.status == "paid")
    await db.execute(
        update(Booking)
        .where(
            Booking.status == "pending",
            Booking.staff_id == online_staff_id,
            Booking.booking_date < cutoff,
            ~paid,
        )
        .values(status="cancelled")
    )


async def find_available_rooms(
    db: AsyncSession, *, check_in: date, check_out: date
) -> list[dict[str, object]]:
    # same as the per-type search: a lapsed hold must not hide its room (BR-12)
    await release_expired_holds(db)
    rows = await db.execute(
        text(
            "SELECT room_id, room_number, room_type, price_per_night, max_occupancy "
            "FROM fn_available_rooms(:ci, :co)"
        ),
        {"ci": check_in, "co": check_out},
    )
    return [dict(r._mapping) for r in rows]


async def _lock_rooms(db: AsyncSession, room_ids: list[int]) -> None:
    """Take row locks on `room_ids` until the transaction ends. Ascending order
    so two multi-room bookings always lock in the same sequence and cannot
    deadlock. Must run before `_overlapping_room_ids` in the same transaction."""
    if not room_ids:
        return
    await db.execute(
        select(Room.room_id)
        .where(Room.room_id.in_(room_ids))
        .order_by(Room.room_id)
        .with_for_update()
    )


async def _overlapping_room_ids(
    db: AsyncSession,
    room_ids: list[int],
    check_in: date,
    check_out: date,
    *,
    exclude_booking_id: int | None = None,
) -> set[int]:
    stmt = (
        select(BookingRoom.room_id)
        .join(Booking, Booking.booking_id == BookingRoom.booking_id)
        .where(
            BookingRoom.room_id.in_(room_ids),
            Booking.status.in_(ACTIVE_BOOKING_STATUSES),
            Booking.check_in_date < check_out,
            check_in < Booking.check_out_date,
        )
    )
    if exclude_booking_id is not None:
        stmt = stmt.where(Booking.booking_id != exclude_booking_id)
    return set((await db.scalars(stmt)).all())


_TYPE_AVAILABILITY_SQL = text(
    """
    SELECT rt.room_type_id, rt.name, rt.description,
           -- what these dates actually cost per night once rate plans apply,
           -- not the list price
           -- CAST(), not `::` - `text()` treats ":co::date" as a bind param
           ROUND(fn_quote_stay(rt.room_type_id, :ci, :co)
                 / GREATEST(CAST(:co AS date) - CAST(:ci AS date), 1), 2)
               AS price_per_night,
           rt.base_price_per_night,
           rt.max_occupancy,
           COUNT(fa.room_id) AS available_count,
           -- guest signal so the client can sort by rating / popularity
           (SELECT ROUND(AVG(rv.rating)::numeric, 1)
              FROM review rv
              JOIN booking_room brr ON brr.booking_id = rv.booking_id
              JOIN room rr ON rr.room_id = brr.room_id
             WHERE rr.room_type_id = rt.room_type_id) AS avg_rating,
           (SELECT COUNT(DISTINCT bk.booking_id)
              FROM booking bk
              JOIN booking_room brb ON brb.booking_id = bk.booking_id
              JOIN room rb ON rb.room_id = brb.room_id
             WHERE rb.room_type_id = rt.room_type_id
               AND bk.status <> 'cancelled') AS booking_count
    FROM room_type rt
    LEFT JOIN fn_available_rooms(:ci, :co) fa
           ON fa.room_type = rt.name
    GROUP BY rt.room_type_id, rt.name, rt.description,
             rt.base_price_per_night, rt.max_occupancy
    -- every category is returned; a sold-out one comes back with
    -- available_count = 0 so the guest site can grey it out rather than hide it
    ORDER BY (COUNT(fa.room_id) = 0), price_per_night
    """
)


async def find_available_room_types(
    db: AsyncSession, *, check_in: date, check_out: date
) -> list[dict[str, object]]:
    # lapsed holds shouldn't make a room look sold out on the guest search
    await release_expired_holds(db)
    rows = await db.execute(_TYPE_AVAILABILITY_SQL, {"ci": check_in, "co": check_out})
    return [dict(r._mapping) for r in rows]


async def _pick_room_of_type(
    db: AsyncSession,
    room_type_id: int,
    check_in: date,
    check_out: date,
    *,
    exclude: list[int],
) -> int | None:
    stmt = (
        select(Room.room_id)
        .where(
            Room.room_type_id == room_type_id,
            Room.status == "available",
            Room.room_id.not_in(exclude or [0]),
            ~select(BookingRoom.booking_room_id)
            .join(Booking, Booking.booking_id == BookingRoom.booking_id)
            .where(
                BookingRoom.room_id == Room.room_id,
                Booking.status.in_(ACTIVE_BOOKING_STATUSES),
                Booking.check_in_date < check_out,
                check_in < Booking.check_out_date,
            )
            .exists(),
        )
        .order_by(Room.room_number)
        .limit(1)
    )
    picked = await db.scalar(stmt)
    return int(picked) if picked is not None else None


ONLINE_STAFF_EMAIL = "online@tiggeroriental.com"


async def resolve_online_staff_id(db: AsyncSession) -> int:
    """The staff record online (guest) bookings are attributed to."""
    sid = await db.scalar(select(Staff.staff_id).where(Staff.email == ONLINE_STAFF_EMAIL))
    if sid is None:  # fall back to any manager so the app still works pre-seed
        sid = await db.scalar(
            select(Staff.staff_id).where(Staff.role == "manager").order_by(Staff.staff_id).limit(1)
        )
    if sid is None:
        raise ConflictError("no staff record available to own this booking", code="no_staff")
    return sid


async def create_booking(
    db: AsyncSession,
    *,
    customer_id: int,
    staff_id: int,
    data: BookingCreateIn,
    status: str = "confirmed",
) -> Booking:
    """`status` lets the caller choose the opening state: the front desk books
    straight to `confirmed` (they take payment at the desk); an online guest
    booking opens as `pending` and is promoted to `confirmed` once it's paid."""
    # sweep lapsed holds first so a stale one doesn't block this room
    await release_expired_holds(db)

    customer = await db.get(Customer, customer_id)
    if customer is None:
        raise NotFoundError("customer not found")

    # resolve any category requests to a concrete free room of that type
    room_ids: list[int] = []
    for req in data.rooms:
        if req.room_id is not None:
            room_ids.append(req.room_id)
            continue
        picked = await _pick_room_of_type(
            db, req.room_type_id or 0, data.check_in_date, data.check_out_date, exclude=room_ids
        )
        if picked is None:
            raise ConflictError(
                f"no rooms of type {req.room_type_id} available for those dates", code="sold_out"
            )
        room_ids.append(picked)

    # BR-5 under concurrency: hold the rooms before reading their status or
    # their bookings, so a parallel booking for the same room waits here
    await _lock_rooms(db, room_ids)

    room_stmt = select(Room).options(joinedload(Room.room_type)).where(Room.room_id.in_(room_ids))
    rooms = {r.room_id: r for r in (await db.scalars(room_stmt)).all()}
    missing = set(room_ids) - rooms.keys()
    if missing:
        raise NotFoundError(f"unknown room_id(s): {sorted(missing)}")

    unavailable = [rid for rid, r in rooms.items() if r.status != "available"]
    if unavailable:
        raise ConflictError(f"room(s) not bookable (status != available): {sorted(unavailable)}")

    # BR: a stay cannot hold more guests than the assigned rooms sleep
    capacity = sum(rooms[rid].room_type.max_occupancy for rid in room_ids)
    if data.num_guests > capacity:
        raise ConflictError(
            f"{data.num_guests} guests exceed the capacity of {capacity} for the selected room(s)",
            code="over_capacity",
        )

    clashes = await _overlapping_room_ids(db, room_ids, data.check_in_date, data.check_out_date)
    if clashes:
        raise ConflictError(f"room(s) already booked for those dates: {sorted(clashes)}")

    services: dict[int, Service] = {}
    if data.services:
        svc_ids = [s.service_id for s in data.services]
        svc_stmt = select(Service).where(
            Service.service_id.in_(svc_ids), Service.is_active.is_(True)
        )
        services = {s.service_id: s for s in (await db.scalars(svc_stmt)).all()}
        missing_svc = set(svc_ids) - services.keys()
        if missing_svc:
            raise NotFoundError(f"unknown/inactive service_id(s): {sorted(missing_svc)}")
        nights = (data.check_out_date - data.check_in_date).days
        for s in data.services:
            _assert_addon_fits(
                services[s.service_id],
                s.quantity,
                nights=nights,
                rooms=len(room_ids),
                guests=data.num_guests,
            )

    booking = Booking(
        customer_id=customer_id,
        staff_id=staff_id,
        check_in_date=data.check_in_date,
        check_out_date=data.check_out_date,
        num_guests=data.num_guests,
        status=status,
        note=data.note,
    )
    # BR-6 price snapshot - taken through the rate plans (seasonal / weekend /
    # promotional), not the room type's list price. `nightly_rate_for` averages
    # the stay when it straddles a rate change, so the total still matches the
    # quote the guest was shown.
    rate_cache: dict[int, Decimal] = {}
    booking.rooms = []
    for rid in room_ids:
        room_type_id = rooms[rid].room_type_id
        if room_type_id not in rate_cache:
            rate_cache[room_type_id] = await ops_service.nightly_rate_for(
                db,
                room_type_id=room_type_id,
                check_in=data.check_in_date,
                check_out=data.check_out_date,
            )
        booking.rooms.append(BookingRoom(room_id=rid, price_per_night=rate_cache[room_type_id]))
    booking.services = [
        BookingService(
            service_id=s.service_id,
            quantity=s.quantity,
            unit_price=services[s.service_id].price,
        )
        for s in data.services
    ]
    db.add(booking)
    await db.flush()
    # re-read through the eager loader: the rows we just built in Python have no
    # `.customer` / `.room` loaded, and touching them during serialization would
    # lazy-load inside the async session -> MissingGreenlet.
    return await _load_booking(db, booking.booking_id)


def booking_loader() -> tuple[object, ...]:
    """Eager-load everything `BookingOut` serializes - guest name, room number,
    room type and service name - so nothing lazy-loads during serialization."""
    return (
        joinedload(Booking.customer),
        selectinload(Booking.rooms).joinedload(BookingRoom.room).joinedload(Room.room_type),
        selectinload(Booking.services).joinedload(BookingService.service),
    )


async def _load_booking(db: AsyncSession, booking_id: int) -> Booking:
    stmt = (
        select(Booking)
        .options(*booking_loader())  # type: ignore[arg-type]
        .where(Booking.booking_id == booking_id)
        .execution_options(populate_existing=True)
    )
    booking = (await db.scalars(stmt)).unique().first()
    if booking is None:
        raise NotFoundError("booking not found")
    return booking


async def get_booking_for(
    db: AsyncSession, booking_id: int, *, as_customer_id: int | None
) -> Booking:
    booking = await _load_booking(db, booking_id)
    if as_customer_id is not None and booking.customer_id != as_customer_id:
        # do not reveal existence of other customers' bookings
        raise NotFoundError("booking not found")
    return booking


_TRANSITIONS = {
    "check_in": ({"confirmed"}, "checked_in"),
    "check_out": ({"checked_in"}, "checked_out"),
    # cancellation is not a plain transition - it refunds per policy, see cancel_booking()
}


async def transition(
    db: AsyncSession, booking_id: int, action: str, *, actor_staff_id: int | None = None
) -> Booking:
    allowed_from, target = _TRANSITIONS[action]
    booking = await _load_booking(db, booking_id)
    if booking.status not in allowed_from:
        raise ConflictError(
            f"cannot {action} a booking in status '{booking.status}'", code="bad_state"
        )
    if action == "check_in" and booking.check_in_date > clock.today():
        raise ConflictError(
            f"check-in opens on the arrival date ({booking.check_in_date.isoformat()})",
            code="too_early",
        )
    if action == "check_out" and booking.balance_due > _ZERO:
        # BR-30: the folio is settled before the guest leaves the building
        raise ConflictError(
            f"settle the balance of {booking.balance_due} before checking out",
            code="balance_due",
        )
    room_ids = [br.room_id for br in booking.rooms]
    before = await _room_statuses(db, room_ids)
    booking.status = target
    await db.flush()
    if action == "check_out" and booking.check_out_date > clock.today():
        # an early departure: the trigger books the clean for the planned
        # check-out day, but the room is empty (and 'cleaning') now - put the
        # job on today's board so housekeeping actually sees it
        await db.execute(
            update(HousekeepingTask)
            .where(
                HousekeepingTask.booking_id == booking.booking_id,
                HousekeepingTask.status == "pending",
                HousekeepingTask.scheduled_for > clock.today(),
            )
            .values(scheduled_for=clock.today())
        )
        await db.flush()
    if actor_staff_id is not None and room_ids:
        # check-out fires `au_booking_checkout_housekeeping`, which moves the
        # rooms to 'cleaning' inside the database; record those moves in
        # room_status_log under the member of staff who checked the guest out
        after = await _room_statuses(db, room_ids)
        for rid, old in before.items():
            new = after.get(rid, old)
            if new != old:
                db.add(
                    RoomStatusLog(
                        room_id=rid, changed_by=actor_staff_id, old_status=old, new_status=new
                    )
                )
        await db.flush()
    return booking


async def _room_statuses(db: AsyncSession, room_ids: list[int]) -> dict[int, str]:
    """Current physical status per room, read straight from the table (a plain
    column select, so a trigger's change is seen past the identity map)."""
    if not room_ids:
        return {}
    rows = await db.execute(select(Room.room_id, Room.status).where(Room.room_id.in_(room_ids)))
    return {int(rid): str(status) for rid, status in rows}


_OPEN_FOLIO = ("pending", "confirmed", "checked_in")


async def _assert_folio_open(db: AsyncSession, booking: Booking) -> None:
    """Charges can only move on a booking that is still open, and never under an
    issued invoice - its totals are frozen (BR-16), so it must be voided first."""
    if booking.status not in _OPEN_FOLIO:
        raise ConflictError(
            f"charges cannot change on a booking in status '{booking.status}'",
            code="bad_state",
        )
    invoiced = await db.scalar(
        select(Invoice.invoice_id).where(
            Invoice.booking_id == booking.booking_id, Invoice.status != "void"
        )
    )
    if invoiced is not None:
        raise ConflictError(
            "an invoice has already been issued for this booking - void it before "
            "changing the charges",
            code="invoiced",
        )


async def add_service(db: AsyncSession, booking_id: int, data: BookingServiceAddIn) -> Booking:
    """Post an add-on to an open folio. The unit price is copied from the
    catalog now and then kept (BR-6); adding a service that is already on the
    booking raises its quantity at the price it was first added at."""
    booking = await _load_booking(db, booking_id)
    await _assert_folio_open(db, booking)
    service = await db.get(Service, data.service_id)
    if service is None or not service.is_active:
        raise NotFoundError("unknown or retired service")

    line = next((bs for bs in booking.services if bs.service_id == data.service_id), None)
    _assert_addon_fits(
        service,
        (line.quantity if line is not None else 0) + data.quantity,
        nights=(booking.check_out_date - booking.check_in_date).days,
        rooms=len(booking.rooms),
        guests=booking.num_guests,
    )
    if line is not None:
        line.quantity += data.quantity
    else:
        db.add(
            BookingService(
                booking_id=booking.booking_id,
                service_id=service.service_id,
                quantity=data.quantity,
                unit_price=service.price,
            )
        )
    await db.flush()
    return await _load_booking(db, booking_id)


async def remove_service(db: AsyncSession, booking_id: int, service_id: int) -> Booking:
    """Take an add-on off an open folio. If the guest had already paid for it,
    the difference is refunded straight away - the same rule a shorter
    reschedule follows - so the booking never sits overpaid."""
    booking = await _load_booking(db, booking_id)
    await _assert_folio_open(db, booking)
    line = next((bs for bs in booking.services if bs.service_id == service_id), None)
    if line is None:
        raise NotFoundError("that service is not on this booking")
    await db.delete(line)
    await db.flush()

    booking = await _load_booking(db, booking_id)
    overpaid = (booking.amount_paid - booking.amount_refunded) - booking.grand_total
    if overpaid > _ZERO:
        method = next((p.method for p in booking.payments if p.status == "paid"), "cash")
        db.add(
            Payment(
                booking_id=booking.booking_id,
                amount=overpaid,
                method=method,
                status="refunded",
                paid_at=func.now(),
                reference_no=f"ADJ-{booking.booking_id}",
            )
        )
        await db.flush()
        booking = await _load_booking(db, booking_id)
    return booking


async def reschedule_booking(
    db: AsyncSession,
    booking_id: int,
    *,
    check_in: date,
    check_out: date,
    as_customer_id: int | None = None,
) -> Booking:
    """Move a `pending` / `confirmed` booking to a new date window, same rooms.
    Re-snapshots each room's nightly rate for the new dates through the rate
    plans, and refunds the difference if the shorter / cheaper stay leaves the
    guest overpaid. An underpaid balance is simply carried on `balance_due`.

    `as_customer_id` scopes the change to a guest doing it themselves: it must be
    their own booking, and only while the arrival is still in the future."""
    booking = await _load_booking(db, booking_id)
    if as_customer_id is not None:
        if booking.customer_id != as_customer_id:
            raise NotFoundError("booking not found")
        if booking.check_in_date <= clock.today():
            raise ConflictError(
                "the stay is too close to change online - please call the front desk",
                code="too_late",
            )
    if booking.status not in ("pending", "confirmed"):
        raise ConflictError(
            f"cannot change the dates of a booking in status '{booking.status}'", code="bad_state"
        )
    if check_out <= check_in:
        raise ConflictError("check_out_date must be after check_in_date", code="bad_dates")
    if check_in < clock.today():
        raise ConflictError("the new arrival date is in the past", code="bad_dates")
    if check_in == booking.check_in_date and check_out == booking.check_out_date:
        return booking

    room_ids = [br.room_id for br in booking.rooms]
    # same lock as create_booking; the trigger only re-checks when a
    # booking_room row is written, so this check is what guards a pure date move
    await _lock_rooms(db, room_ids)
    clashes = await _overlapping_room_ids(
        db, room_ids, check_in, check_out, exclude_booking_id=booking_id
    )
    if clashes:
        raise ConflictError(
            f"room(s) already booked for the new dates: {sorted(clashes)}", code="unavailable"
        )

    booking.check_in_date = check_in
    booking.check_out_date = check_out
    rate_cache: dict[int, Decimal] = {}
    for br in booking.rooms:
        rt_id = br.room.room_type_id
        if rt_id not in rate_cache:
            rate_cache[rt_id] = await ops_service.nightly_rate_for(
                db, room_type_id=rt_id, check_in=check_in, check_out=check_out
            )
        br.price_per_night = rate_cache[rt_id]
    # a shorter stay needs fewer per-night extras: trim any add-on line past
    # what the new dates allow (BR-29) - the refund below then returns the
    # difference, exactly as it does for the cheaper room nights
    nights = (check_out - check_in).days
    for bs in booking.services:
        cap = addon_cap(
            bs.service, nights=nights, rooms=len(booking.rooms), guests=booking.num_guests
        )
        if bs.quantity > cap:
            bs.quantity = cap
    await db.flush()

    booking = await _load_booking(db, booking_id)
    overpaid = (booking.amount_paid - booking.amount_refunded) - booking.grand_total
    if overpaid > _ZERO:
        method = next((p.method for p in booking.payments if p.status == "paid"), "promptpay")
        db.add(
            Payment(
                booking_id=booking.booking_id,
                amount=overpaid,
                method=method,
                status="refunded",
                paid_at=func.now(),
                reference_no=f"REBOOK-{booking.booking_id}",
            )
        )
        await db.flush()
        booking = await _load_booking(db, booking_id)
    return booking


async def mark_no_show(db: AsyncSession, booking_id: int) -> Booking:
    """A `confirmed` guest whose arrival date has passed and who never checked
    in. Structurally this is a late cancellation - the first night is kept as a
    fee - but the caller records it distinctly so it does not read in the audit
    trail as a guest-requested cancel."""
    booking = await _load_booking(db, booking_id)
    if booking.status != "confirmed":
        raise ConflictError(
            f"only a confirmed booking can be a no-show (this one is '{booking.status}')",
            code="bad_state",
        )
    if booking.check_in_date >= clock.today():
        raise ConflictError("the arrival date has not passed yet", code="too_early")
    return await cancel_booking(db, booking_id)


async def cancel_booking(db: AsyncSession, booking_id: int) -> Booking:
    """Cancel a `pending` or `confirmed` booking. Money already collected is
    refunded per policy: in full before the free-cancellation deadline, else the
    first night's room charge is kept as a fee (never more than was paid)."""
    booking = await _load_booking(db, booking_id)
    if booking.status not in ("pending", "confirmed"):
        raise ConflictError(
            f"cannot cancel a booking in status '{booking.status}'", code="bad_state"
        )

    collected = booking.amount_paid - booking.amount_refunded
    if collected > _ZERO:
        deadline = booking.free_cancellation_deadline
        late = deadline is not None and datetime.now(UTC) >= deadline
        fee = min(booking.first_night_rate, collected) if late else _ZERO
        refund = collected - fee
        if refund > _ZERO:
            method = next((p.method for p in booking.payments if p.status == "paid"), "promptpay")
            db.add(
                Payment(
                    booking_id=booking.booking_id,
                    amount=refund,
                    method=method,
                    status="refunded",
                    paid_at=func.now(),
                    reference_no=f"REFUND-{booking.booking_id}",
                )
            )

    booking.status = "cancelled"
    await db.flush()
    # re-read so the response carries the fresh refund row
    return await _load_booking(db, booking_id)


def _promote_if_paid(booking: Booking, new_balance: Decimal) -> None:
    """A `pending` hold becomes a real reservation the moment it's paid off -
    whether that payment came in online or across the front desk."""
    if booking.status == "pending" and new_balance <= _ZERO:
        booking.status = "confirmed"


async def add_payment(db: AsyncSession, booking_id: int, data: PaymentIn) -> Payment:
    booking = await _load_booking(db, booking_id)
    if booking.status == "cancelled":
        raise ConflictError("cannot add payment to a cancelled booking")
    balance_due = booking.balance_due
    if data.amount > balance_due:
        raise ConflictError(
            f"payment of {data.amount} exceeds the balance due of {balance_due}",
            code="over_payment",
        )
    payment = Payment(
        booking_id=booking.booking_id,
        amount=data.amount,
        method=data.method,
        status="paid",
        paid_at=func.now(),  # let DB stamp it
        reference_no=data.reference_no,
    )
    db.add(payment)
    await db.flush()
    _promote_if_paid(booking, balance_due - data.amount)
    return payment


async def pay_balance(
    db: AsyncSession,
    booking_id: int,
    *,
    method: str,
    reference_no: str | None,
    as_customer_id: int | None,
) -> BookingBillOut:
    """Settle a booking's whole outstanding balance in one payment. Used by the
    guest checkout flow; `as_customer_id` scopes it to the booking's owner."""
    await release_expired_holds(db)  # a lapsed hold can't be rescued by paying late
    booking = await get_booking_for(db, booking_id, as_customer_id=as_customer_id)
    if booking.status == "cancelled":
        raise ConflictError(
            "this hold has expired or was cancelled - please search again",
            code="hold_expired",
        )

    bill = compute_bill(booking)
    if bill.balance_due <= _ZERO:
        _promote_if_paid(booking, _ZERO)  # settled but still 'pending'? make it real
        return bill  # already settled - the page is safe to revisit

    db.add(
        Payment(
            booking_id=booking.booking_id,
            amount=bill.balance_due,
            method=method,
            status="paid",
            paid_at=func.now(),  # let the DB stamp it
            reference_no=reference_no,
        )
    )
    await db.flush()
    _promote_if_paid(booking, _ZERO)  # pending hold -> confirmed reservation
    return bill.model_copy(update={"paid_total": bill.grand_total, "balance_due": _ZERO})


def compute_bill(booking: Booking) -> BookingBillOut:
    # the arithmetic lives on the model so BookingOut and this endpoint agree
    return BookingBillOut(
        booking_id=booking.booking_id,
        nights=booking.nights,
        room_total=booking.room_charge,
        service_total=booking.service_charge,
        grand_total=booking.grand_total,
        paid_total=booking.amount_paid,
        refunded_total=booking.amount_refunded,
        balance_due=booking.balance_due,
    )
