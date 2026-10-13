"""/api/v1/services - the add-on catalog (breakfast, airport transfer, laundry ...).

Guests and the front desk choose from the active list when they book; managers
keep the catalog. A service is retired (`is_active = false`), never deleted -
`booking_service` rows point at it with ON DELETE RESTRICT, and past folios and
invoices must keep their lines.
"""

from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import DbSession, RequireManager
from app.exceptions import ConflictError, NotFoundError
from app.models.catalog import Service
from app.schemas.service import ServiceCatalogRow, ServiceIn, ServiceOut, ServicePatch
from app.services import ops_service

router = APIRouter(prefix="/services", tags=["services"])

# what each service has sold on stays that went ahead - BR-6 means the amount is
# quantity x the unit price locked on each booking, not today's list price
_CATALOG_SQL = text(
    """
    SELECT s.service_id, s.name, s.price, s.description, s.is_active,
           COUNT(bs.booking_service_id)                  AS times_sold,
           COALESCE(SUM(bs.quantity), 0)                 AS units_sold,
           COALESCE(SUM(bs.quantity * bs.unit_price), 0) AS revenue
    FROM service s
    LEFT JOIN booking_service bs ON bs.service_id = s.service_id
         AND EXISTS (SELECT 1 FROM booking b
                     WHERE b.booking_id = bs.booking_id AND b.status <> 'cancelled')
    GROUP BY s.service_id
    ORDER BY s.is_active DESC, s.name
    """
)


async def _name_taken(db: AsyncSession, name: str, *, exclude: int | None = None) -> bool:
    stmt = select(Service.service_id).where(func.lower(Service.name) == name.lower())
    if exclude is not None:
        stmt = stmt.where(Service.service_id != exclude)
    return await db.scalar(stmt) is not None


@router.get("", response_model=list[ServiceOut])
async def list_services(db: DbSession) -> list[Service]:
    """Public - the add-ons a guest can put on a booking (active only)."""
    stmt = select(Service).where(Service.is_active.is_(True)).order_by(Service.name)
    return list((await db.scalars(stmt)).all())


@router.get("/catalog", response_model=list[ServiceCatalogRow])
async def catalog(db: DbSession, _: RequireManager) -> list[dict[str, object]]:
    """Every service, retired ones included, with units sold and revenue."""
    rows = await db.execute(_CATALOG_SQL)
    return [dict(r._mapping) for r in rows]


@router.post("", response_model=ServiceOut, status_code=201)
async def create_service(body: ServiceIn, db: DbSession, user: RequireManager) -> Service:
    name = body.name.strip()
    if not name:
        raise ConflictError("service name cannot be blank", code="bad_value")
    if await _name_taken(db, name):
        raise ConflictError("a service with that name already exists", code="already_exists")
    service = Service(
        name=name,
        price=body.price,
        description=(body.description or "").strip() or None,
        is_active=body.is_active,
    )
    db.add(service)
    await db.flush()
    await ops_service.write_audit(
        db,
        actor_user_id=user.user_id,
        actor_label=user.username,
        action="service.create",
        entity_type="service",
        entity_id=str(service.service_id),
        summary=f"{service.name} at {service.price}",
    )
    return service


@router.patch("/{service_id}", response_model=ServiceOut)
async def update_service(
    service_id: int, body: ServicePatch, db: DbSession, user: RequireManager
) -> Service:
    service = await db.get(Service, service_id)
    if service is None:
        raise NotFoundError("service not found")
    changes = body.model_dump(exclude_unset=True)
    if "name" in changes:
        name = (changes["name"] or "").strip()
        if not name:
            raise ConflictError("service name cannot be blank", code="bad_value")
        if await _name_taken(db, name, exclude=service_id):
            raise ConflictError("a service with that name already exists", code="already_exists")
        changes["name"] = name
    if "price" in changes and changes["price"] is None:
        raise ConflictError("price cannot be empty", code="bad_value")
    if "is_active" in changes and changes["is_active"] is None:
        raise ConflictError("is_active cannot be empty", code="bad_value")
    if "description" in changes:
        changes["description"] = (changes["description"] or "").strip() or None

    before = {k: str(getattr(service, k)) for k in changes}
    for key, value in changes.items():
        setattr(service, key, value)
    await db.flush()
    await ops_service.write_audit(
        db,
        actor_user_id=user.user_id,
        actor_label=user.username,
        action="service.update",
        entity_type="service",
        entity_id=str(service_id),
        summary=f"{service.name}: " + ", ".join(sorted(changes)),
        data={"before": before, "after": {k: str(v) for k, v in changes.items()}},
    )
    return service
