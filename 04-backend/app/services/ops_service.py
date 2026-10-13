"""Use-cases for the operations modules.

Pricing, invoicing, housekeeping and maintenance all lean on the SQL objects in
03-database/schema.sql (`fn_quote_room`, `fn_quote_stay`, the `v_*` views and the
check-out trigger) rather than reimplementing that logic in Python.
"""

from __future__ import annotations

import secrets
from datetime import UTC, date, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.exceptions import ConflictError, NotFoundError
from app.models.booking import Booking, BookingRoom, RoomStatusLog
from app.models.catalog import Room, RoomType
from app.models.ops import (
    AuditLog,
    HousekeepingTask,
    Invoice,
    InvoiceLine,
    MaintenanceTicket,
    RatePlan,
)
from app.models.people import Staff
from app.schemas.ops import (
    HousekeepingTaskIn,
    HousekeepingTaskPatch,
    InvoiceIssueIn,
    MaintenanceTicketIn,
    MaintenanceTicketPatch,
    RatePlanIn,
    RatePlanPatch,
)

_CENTS = Decimal("0.01")


def _money(value: Decimal) -> Decimal:
    return value.quantize(_CENTS, rounding=ROUND_HALF_UP)


# ============================================================ audit trail


async def set_actor(db: AsyncSession, username: str | None) -> None:
    """Tell the DB who is acting, so the audit triggers can record it.

    `set_config(..., true)` is transaction-local, matching `SET LOCAL`.
    """
    await db.execute(
        text("SELECT set_config('app.actor', :who, true)"), {"who": username or "system"}
    )


async def write_audit(
    db: AsyncSession,
    *,
    actor_user_id: int | None,
    actor_label: str | None,
    action: str,
    entity_type: str,
    entity_id: str | None = None,
    summary: str | None = None,
    data: dict[str, Any] | None = None,
) -> None:
    """Record something the triggers don't cover (they only watch `booking`)."""
    db.add(
        AuditLog(
            actor_user_id=actor_user_id,
            actor_label=actor_label,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            summary=summary,
            data=data,
        )
    )
    await db.flush()


# ============================================================ room status


async def change_room_status(
    db: AsyncSession, room: Room, new_status: str, *, staff_id: int | None
) -> None:
    """Move a room to a new physical status and, when a staff member is behind
    the change, record it in `room_status_log` (who, from, to, when). System
    moves with no staff actor (e.g. a sweep) change the room without a log row -
    `room_status_log.changed_by` is NOT NULL."""
    if room.status == new_status:
        return
    if staff_id is not None:
        db.add(
            RoomStatusLog(
                room_id=room.room_id,
                changed_by=staff_id,
                old_status=room.status,
                new_status=new_status,
            )
        )
    room.status = new_status


# ============================================================== rate plans


async def quote_stay(
    db: AsyncSession, *, room_type_id: int, check_in: date, check_out: date
) -> dict[str, Any]:
    """Price a stay night by night through `fn_quote_room`."""
    if check_out <= check_in:
        raise ConflictError("check_out_date must be after check_in_date", code="bad_dates")

    room_type = await db.get(RoomType, room_type_id)
    if room_type is None:
        raise NotFoundError("room type not found")

    rows = await db.execute(
        text(
            """
            SELECT d::date AS night, fn_quote_room(:rt, d::date) AS price
            FROM generate_series(:ci, CAST(:co AS date) - 1, INTERVAL '1 day') AS d
            ORDER BY d
            """
        ),
        {"rt": room_type_id, "ci": check_in, "co": check_out},
    )
    breakdown = [{"night": r.night, "price": Decimal(r.price)} for r in rows]
    nights = len(breakdown)
    rate_total = sum((b["price"] for b in breakdown), Decimal("0"))
    average = _money(rate_total / nights) if nights else Decimal("0.00")
    return {
        "room_type_id": room_type_id,
        "room_type_name": room_type.name,
        "check_in_date": check_in,
        "check_out_date": check_out,
        "nights": nights,
        "base_price_per_night": room_type.base_price_per_night,
        # what the booking will actually charge: booking_room keeps one nightly
        # figure (BR-6), the rounded average, so quote the same amount the guest
        # pays - e.g. 1,300 + 1,500 + 1,500 quotes 3 x 1,433.33 = 4,299.99
        "total": _money(average * nights),
        "rate_total": _money(rate_total),
        "average_per_night": average,
        "breakdown": breakdown,
    }


async def nightly_rate_for(
    db: AsyncSession, *, room_type_id: int, check_in: date, check_out: date
) -> Decimal:
    """The per-night figure to snapshot on `booking_room`.

    `booking_room.price_per_night` holds one number, but a stay can straddle a
    rate change, so we snapshot the average rounded to the satang. When the plan
    prices don't divide evenly the stay total can differ from `fn_quote_stay` by a
    few satang; `quote_stay` quotes this charged figure so the guest sees what
    they will pay.
    """
    total = await db.scalar(
        text("SELECT fn_quote_stay(:rt, :ci, :co)"),
        {"rt": room_type_id, "ci": check_in, "co": check_out},
    )
    nights = (check_out - check_in).days
    if not total or nights <= 0:
        rt = await db.get(RoomType, room_type_id)
        return Decimal(rt.base_price_per_night) if rt else Decimal("0.00")
    return _money(Decimal(total) / nights)


async def list_rate_plans(db: AsyncSession, *, active_only: bool) -> list[RatePlan]:
    stmt = select(RatePlan)
    if active_only:
        stmt = stmt.where(RatePlan.is_active.is_(True))
    stmt = stmt.order_by(RatePlan.room_type_id, RatePlan.priority.desc(), RatePlan.valid_from)
    return list((await db.scalars(stmt)).unique().all())


async def create_rate_plan(db: AsyncSession, data: RatePlanIn) -> RatePlan:
    if await db.get(RoomType, data.room_type_id) is None:
        raise NotFoundError("room type not found")
    plan = RatePlan(**data.model_dump())
    db.add(plan)
    await db.flush()
    return await _get_rate_plan(db, plan.rate_plan_id)


async def _get_rate_plan(db: AsyncSession, rate_plan_id: int) -> RatePlan:
    plan = (
        (
            await db.scalars(
                select(RatePlan)
                .where(RatePlan.rate_plan_id == rate_plan_id)
                .execution_options(populate_existing=True)
            )
        )
        .unique()
        .first()
    )
    if plan is None:
        raise NotFoundError("rate plan not found")
    return plan


async def update_rate_plan(db: AsyncSession, rate_plan_id: int, data: RatePlanPatch) -> RatePlan:
    plan = await _get_rate_plan(db, rate_plan_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(plan, field, value)
    await db.flush()
    return plan


async def delete_rate_plan(db: AsyncSession, rate_plan_id: int) -> None:
    plan = await _get_rate_plan(db, rate_plan_id)
    await db.delete(plan)
    await db.flush()


# ================================================================ invoices


async def _next_invoice_no(db: AsyncSession) -> str:
    year = datetime.now(UTC).year
    prefix = f"INV-{year}-"
    last = await db.scalar(
        text(
            "SELECT invoice_no FROM invoice WHERE invoice_no LIKE :p "
            "ORDER BY invoice_no DESC LIMIT 1"
        ),
        {"p": f"{prefix}%"},
    )
    seq = int(str(last).rsplit("-", 1)[1]) + 1 if last else 1
    return f"{prefix}{seq:05d}"


async def issue_invoice(
    db: AsyncSession, *, booking_id: int, staff_id: int | None, data: InvoiceIssueIn
) -> Invoice:
    """Turn a booking into a tax invoice, itemised from what was actually booked."""
    booking = await db.get(Booking, booking_id)
    if booking is None:
        raise NotFoundError("booking not found")
    if booking.status == "cancelled":
        raise ConflictError("cannot invoice a cancelled booking", code="bad_state")
    if booking.status == "pending":
        raise ConflictError("cannot invoice a booking that isn't confirmed yet", code="bad_state")
    # BR-18: a correction is void-and-reissue, so only a live (non-void) invoice
    # blocks a new one - the same rule as the partial unique index in schema.sql
    live = await db.scalar(
        select(Invoice).where(Invoice.booking_id == booking_id, Invoice.status != "void")
    )
    if live is not None:
        raise ConflictError("this booking already has an invoice", code="duplicate")

    nights = (booking.check_out_date - booking.check_in_date).days
    lines: list[InvoiceLine] = []
    line_no = 0

    for br in booking.rooms:
        line_no += 1
        amount = _money(Decimal(br.price_per_night) * nights)
        lines.append(
            InvoiceLine(
                line_no=line_no,
                line_type="room",
                description=f"{br.room.room_type.name} ({br.room.room_number}) · {nights} nights",
                quantity=Decimal(nights),
                unit_price=Decimal(br.price_per_night),
                amount=amount,
            )
        )

    for bs in booking.services:
        line_no += 1
        amount = _money(Decimal(bs.unit_price) * bs.quantity)
        lines.append(
            InvoiceLine(
                line_no=line_no,
                line_type="service",
                description=bs.service.name,
                quantity=Decimal(bs.quantity),
                unit_price=Decimal(bs.unit_price),
                amount=amount,
            )
        )

    if data.discount > 0:
        line_no += 1
        lines.append(
            InvoiceLine(
                line_no=line_no,
                line_type="discount",
                description="Discount",
                quantity=Decimal("1"),
                unit_price=-data.discount,
                amount=-data.discount,
            )
        )

    if not lines:
        raise ConflictError("nothing to invoice on this booking", code="empty")

    gross = sum((line.amount for line in lines), Decimal("0"))
    # the booked figures are VAT-inclusive, so work the tax back out of them
    subtotal = _money(gross / (Decimal("1") + data.tax_rate))
    tax_amount = _money(gross - subtotal)

    invoice = Invoice(
        booking_id=booking_id,
        invoice_no=await _next_invoice_no(db),
        issued_by=staff_id,
        status="issued",
        tax_rate=data.tax_rate,
        subtotal=subtotal,
        tax_amount=tax_amount,
        total=_money(gross),
        note=data.note,
        lines=lines,
    )
    db.add(invoice)
    await db.flush()
    return await get_invoice(db, invoice.invoice_id)


async def get_invoice(db: AsyncSession, invoice_id: int) -> Invoice:
    invoice = (
        (
            await db.scalars(
                select(Invoice)
                .where(Invoice.invoice_id == invoice_id)
                .execution_options(populate_existing=True)
            )
        )
        .unique()
        .first()
    )
    if invoice is None:
        raise NotFoundError("invoice not found")
    return invoice


async def invoice_for_booking(db: AsyncSession, booking_id: int) -> Invoice:
    # the live invoice if there is one, else the most recent void one
    invoice = (
        (
            await db.scalars(
                select(Invoice)
                .where(Invoice.booking_id == booking_id)
                .order_by((Invoice.status == "void").asc(), Invoice.issued_at.desc())
            )
        )
        .unique()
        .first()
    )
    if invoice is None:
        raise NotFoundError("no invoice for this booking")
    return invoice


async def void_invoice(db: AsyncSession, invoice_id: int) -> Invoice:
    invoice = await get_invoice(db, invoice_id)
    if invoice.status == "void":
        raise ConflictError("invoice is already void", code="bad_state")
    invoice.status = "void"
    await db.flush()
    return invoice


# ============================================================ housekeeping


async def list_housekeeping(
    db: AsyncSession,
    *,
    day: date | None,
    status: str | None,
    room_id: int | None,
    task_type: str | None = None,
    assigned_to: int | None = None,
) -> list[HousekeepingTask]:
    stmt = select(HousekeepingTask)
    if day is not None:
        stmt = stmt.where(HousekeepingTask.scheduled_for == day)
    if status:
        stmt = stmt.where(HousekeepingTask.status == status)
    if room_id:
        stmt = stmt.where(HousekeepingTask.room_id == room_id)
    if task_type:
        stmt = stmt.where(HousekeepingTask.task_type == task_type)
    if assigned_to:
        stmt = stmt.where(HousekeepingTask.assigned_to == assigned_to)
    stmt = stmt.order_by(
        HousekeepingTask.scheduled_for.desc(), HousekeepingTask.task_id.desc()
    ).limit(300)
    tasks = list((await db.scalars(stmt)).unique().all())

    # flag the rooms a guest actually walks into today - clean those first
    if tasks:
        arriving = set(
            (
                await db.scalars(
                    select(BookingRoom.room_id)
                    .join(Booking, Booking.booking_id == BookingRoom.booking_id)
                    .where(
                        Booking.status == "confirmed",
                        Booking.check_in_date == clock.today(),
                    )
                )
            ).all()
        )
        for t in tasks:
            t.arriving_today = t.room_id in arriving
    return tasks


async def auto_assign_housekeeping(db: AsyncSession, *, day: date | None = None) -> dict[str, Any]:
    """Hand every unassigned `pending` task to a housekeeper, load-balanced:
    each task goes to whoever currently has the fewest open tasks, ties broken
    at random. Rooms a guest checks into today are handed out first so they are
    first in each housekeeper's queue. Returns how many were assigned and the
    resulting per-staff load."""
    task_q = select(HousekeepingTask).where(
        HousekeepingTask.status == "pending",
        HousekeepingTask.assigned_to.is_(None),
    )
    if day is not None:
        task_q = task_q.where(HousekeepingTask.scheduled_for == day)
    tasks = list((await db.scalars(task_q.order_by(HousekeepingTask.task_id))).unique().all())

    if tasks:
        arriving = set(
            (
                await db.scalars(
                    select(BookingRoom.room_id)
                    .join(Booking, Booking.booking_id == BookingRoom.booking_id)
                    .where(
                        Booking.status == "confirmed",
                        Booking.check_in_date == clock.today(),
                    )
                )
            ).all()
        )
        # stable sort: arrival rooms to the front, task_id order kept within groups
        tasks.sort(key=lambda t: t.room_id not in arriving)

    staff = list(
        (
            await db.scalars(
                select(Staff).where(Staff.role == "housekeeping", Staff.is_active.is_(True))
            )
        ).all()
    )
    if not staff:
        raise ConflictError("no active housekeeping staff to assign to", code="no_staff")
    if not tasks:
        return {"assigned": 0, "by_staff": []}

    # current open load (assigned pending / in-progress tasks) per housekeeper
    load_rows = await db.execute(
        select(HousekeepingTask.assigned_to, func.count())
        .where(
            HousekeepingTask.assigned_to.is_not(None),
            HousekeepingTask.status.in_(("pending", "in_progress")),
        )
        .group_by(HousekeepingTask.assigned_to)
    )
    load: dict[int, int] = {s.staff_id: 0 for s in staff}
    for sid, n in load_rows:
        if sid in load:
            load[sid] = int(n)

    for t in tasks:
        lowest = min(load[s.staff_id] for s in staff)
        pool = [s for s in staff if load[s.staff_id] == lowest]
        pick = secrets.choice(pool)
        t.assigned_to = pick.staff_id
        load[pick.staff_id] += 1
    await db.flush()

    by_staff = [
        {"staff_id": s.staff_id, "name": s.full_name, "count": load[s.staff_id]}
        for s in staff
        if load[s.staff_id] > 0
    ]
    return {"assigned": len(tasks), "by_staff": by_staff}


async def create_housekeeping(db: AsyncSession, data: HousekeepingTaskIn) -> HousekeepingTask:
    if await db.get(Room, data.room_id) is None:
        raise NotFoundError("room not found")
    task = HousekeepingTask(
        room_id=data.room_id,
        task_type=data.task_type,
        scheduled_for=data.scheduled_for or clock.today(),
        assigned_to=data.assigned_to,
        note=data.note,
    )
    db.add(task)
    await db.flush()
    return await _get_task(db, task.task_id)


async def _get_task(db: AsyncSession, task_id: int) -> HousekeepingTask:
    task = (
        (
            await db.scalars(
                select(HousekeepingTask)
                .where(HousekeepingTask.task_id == task_id)
                .execution_options(populate_existing=True)
            )
        )
        .unique()
        .first()
    )
    if task is None:
        raise NotFoundError("task not found")
    return task


async def update_housekeeping(
    db: AsyncSession,
    task_id: int,
    data: HousekeepingTaskPatch,
    *,
    actor_staff_id: int | None = None,
) -> HousekeepingTask:
    task = await _get_task(db, task_id)
    now = datetime.now(UTC)

    reassigning = "assigned_to" in data.model_fields_set
    if reassigning and task.status == "done":
        raise ConflictError("a finished task can't be reassigned", code="bad_state")
    # an unassigned task can't move off 'pending' until someone owns it
    assignee_after = data.assigned_to if reassigning else task.assigned_to
    if data.status in ("in_progress", "done") and assignee_after is None:
        raise ConflictError("assign someone before starting this task", code="unassigned")

    # an explicit `assigned_to` (even null) reassigns or clears; omitting it leaves
    # the current assignee untouched
    if reassigning:
        task.assigned_to = data.assigned_to
    if data.note is not None:
        task.note = data.note

    if data.status is not None and data.status != task.status:
        task.status = data.status
        if data.status == "in_progress" and task.started_at is None:
            task.started_at = now
        if data.status == "done":
            task.completed_at = now
            # the room is clean again - hand it back to the sales inventory
            room = await db.get(Room, task.room_id)
            if room is not None and room.status == "cleaning":
                await change_room_status(db, room, "available", staff_id=actor_staff_id)
        if data.status in {"pending", "skipped"}:
            task.completed_at = None

    await db.flush()
    # re-read: reassigning `assigned_to` leaves the eagerly-loaded `assignee`
    # holding the previous value (often None), so the label would come back wrong
    return await _get_task(db, task_id)


# ============================================================= maintenance


async def list_maintenance(
    db: AsyncSession,
    *,
    status: str | None,
    open_only: bool,
    category: str | None = None,
    priority: str | None = None,
    room_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[MaintenanceTicket]:
    stmt = select(MaintenanceTicket)
    if status:
        stmt = stmt.where(MaintenanceTicket.status == status)
    elif open_only:
        stmt = stmt.where(MaintenanceTicket.status.in_(("open", "in_progress")))
    if category:
        stmt = stmt.where(MaintenanceTicket.category == category)
    if priority:
        stmt = stmt.where(MaintenanceTicket.priority == priority)
    if room_id:
        stmt = stmt.where(MaintenanceTicket.room_id == room_id)
    if date_from is not None:
        stmt = stmt.where(func.date(MaintenanceTicket.created_at) >= date_from)
    if date_to is not None:
        stmt = stmt.where(func.date(MaintenanceTicket.created_at) <= date_to)
    # urgent first, then oldest - the order an engineer should work them
    stmt = stmt.order_by(
        text(
            "CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END"
        ),
        MaintenanceTicket.created_at,
    ).limit(300)
    return list((await db.scalars(stmt)).unique().all())


async def create_maintenance(
    db: AsyncSession, *, reported_by: int, data: MaintenanceTicketIn
) -> MaintenanceTicket:
    room = None
    if data.room_id is not None:
        room = await db.get(Room, data.room_id)
        if room is None:
            raise NotFoundError("room not found")
    ticket = MaintenanceTicket(reported_by=reported_by, **data.model_dump())
    db.add(ticket)
    # a faulty room comes off the sales inventory (mirrors the check-out trigger)
    if room is not None and room.status == "available":
        await change_room_status(db, room, "maintenance", staff_id=reported_by)
    await db.flush()
    return await _get_ticket(db, ticket.ticket_id)


async def _room_has_other_open_tickets(db: AsyncSession, room_id: int, exclude: int) -> bool:
    hit = await db.scalar(
        select(MaintenanceTicket.ticket_id).where(
            MaintenanceTicket.room_id == room_id,
            MaintenanceTicket.ticket_id != exclude,
            MaintenanceTicket.status.in_(("open", "in_progress")),
        )
    )
    return hit is not None


async def _get_ticket(db: AsyncSession, ticket_id: int) -> MaintenanceTicket:
    ticket = (
        (
            await db.scalars(
                select(MaintenanceTicket)
                .where(MaintenanceTicket.ticket_id == ticket_id)
                .execution_options(populate_existing=True)
            )
        )
        .unique()
        .first()
    )
    if ticket is None:
        raise NotFoundError("ticket not found")
    return ticket


async def update_maintenance(
    db: AsyncSession,
    ticket_id: int,
    data: MaintenanceTicketPatch,
    *,
    actor_staff_id: int | None = None,
) -> MaintenanceTicket:
    ticket = await _get_ticket(db, ticket_id)

    if data.priority is not None:
        ticket.priority = data.priority
    if data.assigned_to is not None:
        ticket.assigned_to = data.assigned_to
    if data.resolution is not None:
        ticket.resolution = data.resolution

    if data.status is not None and data.status != ticket.status:
        # the DB CHECK insists a resolved/closed ticket carries a timestamp
        if data.status in {"resolved", "closed"} and ticket.resolved_at is None:
            ticket.resolved_at = datetime.now(UTC)
        if data.status in {"open", "in_progress"}:
            ticket.resolved_at = None
        ticket.status = data.status

        # keep the room board in step with engineering
        if ticket.room_id is not None:
            room = await db.get(Room, ticket.room_id)
            if room is not None:
                if data.status in {"open", "in_progress"} and room.status == "available":
                    await change_room_status(db, room, "maintenance", staff_id=actor_staff_id)
                elif data.status in {"resolved", "closed", "cancelled"} and (
                    room.status == "maintenance"
                    and not await _room_has_other_open_tickets(db, room.room_id, ticket_id)
                ):
                    await change_room_status(db, room, "available", staff_id=actor_staff_id)

    await db.flush()
    return await _get_ticket(db, ticket_id)
