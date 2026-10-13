"""/api/v1/maintenance - engineering tickets.

Any staff member can report a fault (housekeeping usually finds them first);
housekeeping and management triage and close them.
"""

from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import text

from app.api.deps import DbSession, RequireAnyStaff, RequireHousekeeping
from app.exceptions import ForbiddenError
from app.models.ops import MaintenanceTicket
from app.schemas.ops import (
    MaintenanceBacklogRow,
    MaintenanceTicketIn,
    MaintenanceTicketOut,
    MaintenanceTicketPatch,
)
from app.services import ops_service

router = APIRouter(prefix="/maintenance", tags=["maintenance"])

_STATUS = r"^(open|in_progress|resolved|closed|cancelled)$"
_CATEGORY = r"^(plumbing|electrical|hvac|furniture|appliance|other)$"
_PRIORITY = r"^(low|normal|high|urgent)$"


@router.get("/tickets", response_model=list[MaintenanceTicketOut])
async def list_tickets(
    db: DbSession,
    _: RequireAnyStaff,
    status: Annotated[str | None, Query(pattern=_STATUS)] = None,
    open_only: Annotated[bool, Query()] = False,
    category: Annotated[str | None, Query(pattern=_CATEGORY)] = None,
    priority: Annotated[str | None, Query(pattern=_PRIORITY)] = None,
    room_id: Annotated[int | None, Query(gt=0)] = None,
    date_from: Annotated[
        date | None, Query(description="only tickets reported on/after this date")
    ] = None,
    date_to: Annotated[
        date | None, Query(description="only tickets reported on/before this date")
    ] = None,
) -> list[MaintenanceTicket]:
    """Engineering tickets, newest first - optionally filtered by status, category,
    priority, room or when they were reported."""
    return await ops_service.list_maintenance(
        db,
        status=status,
        open_only=open_only,
        category=category,
        priority=priority,
        room_id=room_id,
        date_from=date_from,
        date_to=date_to,
    )


@router.get("/backlog", response_model=list[MaintenanceBacklogRow])
async def backlog(db: DbSession, _: RequireAnyStaff) -> list[dict[str, object]]:
    """Every ticket still open or in progress, with its age in days - reads
    `v_maintenance_open`, which already sorts urgent-first, then oldest."""
    rows = await db.execute(text("SELECT * FROM v_maintenance_open"))
    return [dict(r._mapping) for r in rows]


@router.post("/tickets", response_model=MaintenanceTicketOut, status_code=201)
async def report_ticket(
    body: MaintenanceTicketIn, db: DbSession, user: RequireAnyStaff
) -> MaintenanceTicket:
    """Any staff member reports a fault - housekeeping/management triage it from here."""
    if user.staff_id is None:
        raise ForbiddenError("this account is not linked to a staff record")
    ticket = await ops_service.create_maintenance(db, reported_by=user.staff_id, data=body)
    await ops_service.write_audit(
        db,
        actor_user_id=user.user_id,
        actor_label=user.username,
        action="maintenance.report",
        entity_type="maintenance_ticket",
        entity_id=str(ticket.ticket_id),
        summary=f"[{ticket.priority}] {ticket.title}",
    )
    return ticket


@router.patch("/tickets/{ticket_id}", response_model=MaintenanceTicketOut)
async def update_ticket(
    ticket_id: int, body: MaintenanceTicketPatch, db: DbSession, user: RequireHousekeeping
) -> MaintenanceTicket:
    """Housekeeping/management update a ticket's status, priority or assignment."""
    ticket = await ops_service.update_maintenance(db, ticket_id, body, actor_staff_id=user.staff_id)
    if body.status is not None:
        await ops_service.write_audit(
            db,
            actor_user_id=user.user_id,
            actor_label=user.username,
            action="maintenance.status_change",
            entity_type="maintenance_ticket",
            entity_id=str(ticket_id),
            summary=f"#{ticket_id} → {ticket.status}",
        )
    return ticket
