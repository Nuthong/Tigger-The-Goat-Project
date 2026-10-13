"""/api/v1/housekeeping - the cleaning board.

Housekeepers own it; the front desk and management can read it because a dirty
room is a room they cannot sell.
"""

from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import text

from app.api.deps import CurrentUser, DbSession, RequireAnyStaff, RequireHousekeeping
from app.core import clock
from app.models.ops import HousekeepingTask
from app.schemas.ops import (
    AutoAssignResult,
    HousekeepingBoardRow,
    HousekeepingTaskIn,
    HousekeepingTaskOut,
    HousekeepingTaskPatch,
)
from app.services import ops_service

router = APIRouter(prefix="/housekeeping", tags=["housekeeping"])

_STATUS = r"^(pending|in_progress|done|skipped)$"


_TASK_TYPE = r"^(checkout_clean|stayover_clean|deep_clean|turndown|inspection)$"


@router.get("/tasks", response_model=list[HousekeepingTaskOut])
async def list_tasks(
    db: DbSession,
    _: RequireAnyStaff,
    day: Annotated[date | None, Query(description="scheduled_for; omit for all")] = None,
    status: Annotated[str | None, Query(pattern=_STATUS)] = None,
    room_id: Annotated[int | None, Query(gt=0)] = None,
    task_type: Annotated[str | None, Query(pattern=_TASK_TYPE)] = None,
    assigned_to: Annotated[
        int | None, Query(gt=0, description="only this housekeeper's tasks")
    ] = None,
) -> list[HousekeepingTask]:
    return await ops_service.list_housekeeping(
        db, day=day, status=status, room_id=room_id, task_type=task_type, assigned_to=assigned_to
    )


@router.post("/tasks", response_model=HousekeepingTaskOut, status_code=201)
async def create_task(
    body: HousekeepingTaskIn, db: DbSession, user: RequireHousekeeping
) -> HousekeepingTask:
    task = await ops_service.create_housekeeping(db, body)
    await ops_service.write_audit(
        db,
        actor_user_id=user.user_id,
        actor_label=user.username,
        action="housekeeping.create",
        entity_type="housekeeping_task",
        entity_id=str(task.task_id),
        summary=f"{task.task_type} · room {task.room_number}",
    )
    return task


@router.patch("/tasks/{task_id}", response_model=HousekeepingTaskOut)
async def update_task(
    task_id: int, body: HousekeepingTaskPatch, db: DbSession, user: RequireHousekeeping
) -> HousekeepingTask:
    task = await ops_service.update_housekeeping(db, task_id, body, actor_staff_id=user.staff_id)
    if body.status is not None:
        await ops_service.write_audit(
            db,
            actor_user_id=user.user_id,
            actor_label=user.username,
            action="housekeeping.status_change",
            entity_type="housekeeping_task",
            entity_id=str(task_id),
            summary=f"room {task.room_number} → {task.status}",
        )
    return task


_DAY_Q = Query(description="limit to this scheduled_for; omit for all pending tasks")


@router.post("/auto-assign", response_model=AutoAssignResult)
async def auto_assign(
    db: DbSession,
    user: RequireHousekeeping,
    day: Annotated[date | None, _DAY_Q] = None,
) -> dict[str, object]:
    """Load-balance every unassigned pending task across the housekeeping team."""
    result = await ops_service.auto_assign_housekeeping(db, day=day)
    if result["assigned"]:
        await ops_service.write_audit(
            db,
            actor_user_id=user.user_id,
            actor_label=user.username,
            action="housekeeping.auto_assign",
            entity_type="housekeeping_task",
            entity_id="*",
            summary=f"auto-assigned {result['assigned']} task(s)",
            data={"by_staff": result["by_staff"]},
        )
    return result


# the day's board straight from the view - one line per task, floor by floor,
# the order a housekeeper walks the building. Fully static; `:day` is bound.
_BOARD_SQL = text(
    """
    SELECT task_id, scheduled_for, status, task_type, room_id, room_number, floor,
           room_type, room_status, booking_id, assigned_to_name, note
    FROM v_housekeeping_board
    WHERE scheduled_for = :day
    ORDER BY floor, room_number, task_id
    """
)


@router.get("/board", response_model=list[HousekeepingBoardRow])
async def daily_board(
    db: DbSession,
    _: RequireAnyStaff,
    day: Annotated[date | None, Query(description="the board's date; default today")] = None,
) -> list[dict[str, object]]:
    """The printable daily housekeeping sheet (reads `v_housekeeping_board`)."""
    rows = await db.execute(_BOARD_SQL, {"day": day or clock.today()})
    return [dict(r._mapping) for r in rows]


@router.get("/summary")
async def board_summary(db: DbSession, _: CurrentUser) -> dict[str, int]:
    """Counts for today's board - cheap enough for the portal to poll."""
    tasks = await ops_service.list_housekeeping(db, day=clock.today(), status=None, room_id=None)
    counts = {"pending": 0, "in_progress": 0, "done": 0, "skipped": 0}
    for t in tasks:
        counts[t.status] = counts.get(t.status, 0) + 1
    return counts
