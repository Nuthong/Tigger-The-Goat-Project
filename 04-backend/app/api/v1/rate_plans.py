"""/api/v1/rate-plans - seasonal, weekend and promotional pricing.

Reading a quote is public (the guest site prices a stay with it); changing the
plans is management only.
"""

from __future__ import annotations

from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, Query

from app.api.deps import DbSession, RequireAnyStaff, RequireManager
from app.models.ops import RatePlan
from app.schemas.ops import QuoteOut, RatePlanIn, RatePlanOut, RatePlanPatch
from app.services import ops_service

router = APIRouter(prefix="/rate-plans", tags=["rate-plans"])


@router.get("/quote", response_model=QuoteOut)
async def quote(
    db: DbSession,
    room_type_id: Annotated[int, Query(gt=0)],
    check_in: Annotated[date, Query()],
    check_out: Annotated[date, Query()],
) -> dict[str, Any]:
    """What this stay actually costs, night by night. Public - the booking page
    shows it before anyone signs in."""
    return await ops_service.quote_stay(
        db, room_type_id=room_type_id, check_in=check_in, check_out=check_out
    )


@router.get("", response_model=list[RatePlanOut])
async def list_plans(
    db: DbSession,
    _: RequireAnyStaff,
    active_only: Annotated[bool, Query()] = False,
) -> list[RatePlan]:
    """All rate plans, optionally filtered to active ones only."""
    return await ops_service.list_rate_plans(db, active_only=active_only)


@router.post("", response_model=RatePlanOut, status_code=201)
async def create_plan(body: RatePlanIn, db: DbSession, user: RequireManager) -> RatePlan:
    """Add a new seasonal, weekend or promotional pricing rule. Management only."""
    plan = await ops_service.create_rate_plan(db, body)
    await ops_service.write_audit(
        db,
        actor_user_id=user.user_id,
        actor_label=user.username,
        action="rate_plan.create",
        entity_type="rate_plan",
        entity_id=str(plan.rate_plan_id),
        summary=f"{plan.name} · {plan.room_type_name} · {plan.price_per_night}",
        data={"kind": plan.kind, "priority": plan.priority},
    )
    return plan


@router.patch("/{rate_plan_id}", response_model=RatePlanOut)
async def update_plan(
    rate_plan_id: int, body: RatePlanPatch, db: DbSession, user: RequireManager
) -> RatePlan:
    """Edit a rate plan's price, dates or active flag. Management only."""
    plan = await ops_service.update_rate_plan(db, rate_plan_id, body)
    await ops_service.write_audit(
        db,
        actor_user_id=user.user_id,
        actor_label=user.username,
        action="rate_plan.update",
        entity_type="rate_plan",
        entity_id=str(rate_plan_id),
        summary=f"{plan.name} · active={plan.is_active}",
        data=body.model_dump(exclude_unset=True, mode="json"),
    )
    return plan


@router.delete("/{rate_plan_id}", status_code=204)
async def delete_plan(rate_plan_id: int, db: DbSession, user: RequireManager) -> None:
    """Remove a rate plan. Management only."""
    await ops_service.delete_rate_plan(db, rate_plan_id)
    await ops_service.write_audit(
        db,
        actor_user_id=user.user_id,
        actor_label=user.username,
        action="rate_plan.delete",
        entity_type="rate_plan",
        entity_id=str(rate_plan_id),
        summary=f"deleted rate plan #{rate_plan_id}",
    )
