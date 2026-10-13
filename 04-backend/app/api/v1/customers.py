"""/api/v1/customers - guest directory for the staff portal (staff only)."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text

from app.api.deps import CurrentUser, DbSession, PageParams, RequireStaff
from app.exceptions import ConflictError, ForbiddenError, NotFoundError
from app.models.people import Customer
from app.schemas.common import Page
from app.services import ops_service

router = APIRouter(prefix="/customers", tags=["customers"])


class CustomerRow(BaseModel):
    customer_id: int
    first_name: str
    last_name: str
    email: str
    phone: str | None
    created_at: datetime
    trips: int
    nights: int
    lifetime_value: Decimal


class GuestBookingRow(BaseModel):
    booking_id: int
    check_in_date: date
    check_out_date: date
    status: str
    room_types: str
    grand_total: Decimal
    balance_due: Decimal
    note: str | None


class CustomerDetailOut(CustomerRow):
    #: national ID / passport number, recorded by the front desk at check-in
    id_card_no: str | None
    has_login: bool
    upcoming: int
    first_stay: date | None
    last_stay: date | None
    recent_bookings: list[GuestBookingRow]


class CustomerPatch(BaseModel):
    """The front desk corrects a guest's name or phone, or records the ID card /
    passport number they checked at arrival. An explicit null clears the phone
    or the ID number; names stay non-empty. The email is the guest's sign-in
    identity and is not edited here."""

    model_config = ConfigDict(extra="forbid")

    first_name: str | None = Field(default=None, min_length=1, max_length=60)
    last_name: str | None = Field(default=None, min_length=1, max_length=60)
    phone: str | None = Field(default=None, max_length=20, pattern=r"^[0-9+\-() ]*$")
    id_card_no: str | None = Field(default=None, max_length=30, pattern=r"^[A-Za-z0-9 \-]*$")


class CustomerSummaryOut(BaseModel):
    """The loyalty figures for the signed-in guest - trips, nights stayed and
    lifetime spend - computed in one query instead of fetching every booking."""

    trips: int
    nights: int
    lifetime_spend: Decimal


_SUMMARY_SQL = text(
    """
    SELECT
        COUNT(b.booking_id) FILTER (WHERE b.status <> 'cancelled')            AS trips,
        COALESCE(SUM(b.check_out_date - b.check_in_date)
                 FILTER (WHERE b.status IN ('checked_in', 'checked_out')), 0) AS nights,
        COALESCE(SUM(vb.grand_total)
                 FILTER (WHERE b.status <> 'cancelled'), 0)                   AS lifetime_spend
    FROM booking b
    LEFT JOIN v_booking_bill vb ON vb.booking_id = b.booking_id
    WHERE b.customer_id = :cid
    """
)


@router.get("/me/summary", response_model=CustomerSummaryOut)
async def my_summary(db: DbSession, user: CurrentUser) -> dict[str, object]:
    if user.customer_id is None:
        raise ForbiddenError("this account is not linked to a guest profile")
    row = (await db.execute(_SUMMARY_SQL, {"cid": user.customer_id})).one()
    return dict(row._mapping)


# CAST(), not `::` - text() treats ":name::date" as a bind param named "name::date".
_LIST_SQL = text(
    """
    -- the register ranks every guest by lifetime value, so it bills every booking:
    -- total them set-based (one hash aggregate per table) rather than through
    -- v_booking_bill, which computes one booking at a time and suits keyed lookups
    WITH totals AS (
        SELECT b.booking_id,
               COALESCE(r.per_night, 0) * (b.check_out_date - b.check_in_date)
                 + COALESCE(sv.services, 0) AS grand_total
        FROM booking b
        LEFT JOIN (SELECT booking_id, SUM(price_per_night) AS per_night
                   FROM booking_room GROUP BY booking_id) r ON r.booking_id = b.booking_id
        LEFT JOIN (SELECT booking_id, SUM(quantity * unit_price) AS services
                   FROM booking_service GROUP BY booking_id) sv ON sv.booking_id = b.booking_id
    )
    SELECT c.customer_id, c.first_name, c.last_name, c.email, c.phone, c.created_at,
           COUNT(b.booking_id) FILTER (WHERE b.status <> 'cancelled') AS trips,
           COALESCE(SUM(b.check_out_date - b.check_in_date)
                    FILTER (WHERE b.status IN ('checked_in', 'checked_out')), 0) AS nights,
           COALESCE(
               SUM(vb.grand_total) FILTER (WHERE b.status <> 'cancelled'), 0
           ) AS lifetime_value
    FROM customer c
    LEFT JOIN booking b         ON b.customer_id = c.customer_id
    LEFT JOIN totals vb         ON vb.booking_id = b.booking_id
    WHERE (:q = '' OR c.first_name ILIKE :like OR c.last_name ILIKE :like OR c.email ILIKE :like)
      AND (:name = '' OR c.first_name || ' ' || c.last_name ILIKE :name_like)
      AND (:email = '' OR c.email ILIKE :email_like)
      AND (:phone = '' OR c.phone ILIKE :phone_like)
      AND (CAST(:joined_from AS date) IS NULL OR c.created_at::date >= :joined_from)
      AND (CAST(:joined_to AS date) IS NULL OR c.created_at::date <= :joined_to)
    GROUP BY c.customer_id
    HAVING (CAST(:min_ltv AS numeric) IS NULL
            OR COALESCE(SUM(vb.grand_total) FILTER (WHERE b.status <> 'cancelled'), 0) >= :min_ltv)
       AND (CAST(:max_ltv AS numeric) IS NULL
            OR COALESCE(SUM(vb.grand_total) FILTER (WHERE b.status <> 'cancelled'), 0) <= :max_ltv)
       AND (CAST(:min_trips AS int) IS NULL
            OR COUNT(b.booking_id) FILTER (WHERE b.status <> 'cancelled') >= :min_trips)
       AND (CAST(:max_trips AS int) IS NULL
            OR COUNT(b.booking_id) FILTER (WHERE b.status <> 'cancelled') <= :max_trips)
       AND (CAST(:min_nights AS int) IS NULL
            OR COALESCE(SUM(b.check_out_date - b.check_in_date)
                        FILTER (WHERE b.status IN ('checked_in', 'checked_out')), 0) >= :min_nights)
       AND (CAST(:max_nights AS int) IS NULL
            OR COALESCE(SUM(b.check_out_date - b.check_in_date)
                        FILTER (WHERE b.status IN ('checked_in', 'checked_out')), 0) <= :max_nights)
    ORDER BY lifetime_value DESC, c.customer_id
    LIMIT :limit OFFSET :offset
    """
)
_COUNT_SQL = text(
    """
    -- the register ranks every guest by lifetime value, so it bills every booking:
    -- total them set-based (one hash aggregate per table) rather than through
    -- v_booking_bill, which computes one booking at a time and suits keyed lookups
    WITH totals AS (
        SELECT b.booking_id,
               COALESCE(r.per_night, 0) * (b.check_out_date - b.check_in_date)
                 + COALESCE(sv.services, 0) AS grand_total
        FROM booking b
        LEFT JOIN (SELECT booking_id, SUM(price_per_night) AS per_night
                   FROM booking_room GROUP BY booking_id) r ON r.booking_id = b.booking_id
        LEFT JOIN (SELECT booking_id, SUM(quantity * unit_price) AS services
                   FROM booking_service GROUP BY booking_id) sv ON sv.booking_id = b.booking_id
    )
    SELECT COUNT(*) FROM (
        SELECT c.customer_id
        FROM customer c
        LEFT JOIN booking b         ON b.customer_id = c.customer_id
        LEFT JOIN totals vb         ON vb.booking_id = b.booking_id
        WHERE (:q = '' OR c.first_name ILIKE :like OR c.last_name ILIKE :like
               OR c.email ILIKE :like)
          AND (:name = '' OR c.first_name || ' ' || c.last_name ILIKE :name_like)
          AND (:email = '' OR c.email ILIKE :email_like)
          AND (:phone = '' OR c.phone ILIKE :phone_like)
          AND (CAST(:joined_from AS date) IS NULL OR c.created_at::date >= :joined_from)
          AND (CAST(:joined_to AS date) IS NULL OR c.created_at::date <= :joined_to)
        GROUP BY c.customer_id
        HAVING (CAST(:min_ltv AS numeric) IS NULL
                OR COALESCE(SUM(vb.grand_total)
                            FILTER (WHERE b.status <> 'cancelled'), 0) >= :min_ltv)
           AND (CAST(:max_ltv AS numeric) IS NULL
                OR COALESCE(SUM(vb.grand_total)
                            FILTER (WHERE b.status <> 'cancelled'), 0) <= :max_ltv)
           AND (CAST(:min_trips AS int) IS NULL
                OR COUNT(b.booking_id) FILTER (WHERE b.status <> 'cancelled') >= :min_trips)
           AND (CAST(:max_trips AS int) IS NULL
                OR COUNT(b.booking_id) FILTER (WHERE b.status <> 'cancelled') <= :max_trips)
           AND (CAST(:min_nights AS int) IS NULL
                OR COALESCE(SUM(b.check_out_date - b.check_in_date)
                            FILTER (WHERE b.status IN ('checked_in', 'checked_out')), 0)
                   >= :min_nights)
           AND (CAST(:max_nights AS int) IS NULL
                OR COALESCE(SUM(b.check_out_date - b.check_in_date)
                            FILTER (WHERE b.status IN ('checked_in', 'checked_out')), 0)
                   <= :max_nights)
    ) sub
    """
)


@router.get("", response_model=Page[CustomerRow])
async def list_customers(
    db: DbSession,
    _: RequireStaff,
    page: PageParams,
    q: Annotated[str, Query(max_length=80)] = "",
    joined_from: Annotated[
        date | None, Query(description="only guests who joined on/after this date")
    ] = None,
    joined_to: Annotated[
        date | None, Query(description="only guests who joined on/before this date")
    ] = None,
    min_ltv: Annotated[
        Decimal | None, Query(ge=0, description="only guests with at least this lifetime value")
    ] = None,
    max_ltv: Annotated[
        Decimal | None, Query(ge=0, description="only guests with at most this lifetime value")
    ] = None,
    name: Annotated[str, Query(max_length=80, description="guest name, partial")] = "",
    email: Annotated[str, Query(max_length=120, description="email, partial")] = "",
    phone: Annotated[str, Query(max_length=20, description="phone, partial")] = "",
    min_trips: Annotated[int | None, Query(ge=0)] = None,
    max_trips: Annotated[int | None, Query(ge=0)] = None,
    min_nights: Annotated[int | None, Query(ge=0, description="nights stayed, at least")] = None,
    max_nights: Annotated[int | None, Query(ge=0, description="nights stayed, at most")] = None,
) -> Page[CustomerRow]:
    params = {
        "q": q,
        "like": f"%{q}%",
        "limit": page.limit,
        "offset": page.offset,
        "joined_from": joined_from,
        "joined_to": joined_to,
        "min_ltv": min_ltv,
        "max_ltv": max_ltv,
        # one filter per column of the guest register
        "name": name.strip(),
        "name_like": f"%{name.strip()}%",
        "email": email.strip(),
        "email_like": f"%{email.strip()}%",
        "phone": phone.strip(),
        "phone_like": f"%{phone.strip()}%",
        "min_trips": min_trips,
        "max_trips": max_trips,
        "min_nights": min_nights,
        "max_nights": max_nights,
    }
    total = await db.scalar(_COUNT_SQL, params) or 0
    rows = (await db.execute(_LIST_SQL, params)).mappings().all()
    return Page(
        items=[CustomerRow(**row) for row in rows],
        total=total,
        limit=page.limit,
        offset=page.offset,
    )


_DETAIL_SQL = text(
    """
    SELECT c.customer_id, c.first_name, c.last_name, c.email, c.phone, c.created_at,
           c.id_card_no,
           EXISTS (SELECT 1 FROM app_user u WHERE u.customer_id = c.customer_id) AS has_login,
           COUNT(b.booking_id) FILTER (WHERE b.status <> 'cancelled') AS trips,
           COALESCE(SUM(b.check_out_date - b.check_in_date)
                    FILTER (WHERE b.status IN ('checked_in', 'checked_out')), 0) AS nights,
           COUNT(b.booking_id) FILTER (
               WHERE b.status IN ('pending', 'confirmed') AND b.check_in_date >= CURRENT_DATE
           ) AS upcoming,
           COALESCE(SUM(vb.grand_total)
                    FILTER (WHERE b.status <> 'cancelled'), 0) AS lifetime_value,
           MIN(b.check_in_date)  FILTER (WHERE b.status <> 'cancelled') AS first_stay,
           MAX(b.check_out_date) FILTER (WHERE b.status <> 'cancelled') AS last_stay
    FROM customer c
    LEFT JOIN booking b ON b.customer_id = c.customer_id
    -- v_booking_bill computes each bill per booking (LATERAL inside the view), so
    -- this join only bills this guest's bookings, not the whole hotel
    LEFT JOIN v_booking_bill vb ON vb.booking_id = b.booking_id
    WHERE c.customer_id = :id
    GROUP BY c.customer_id
    """
)
_RECENT_SQL = text(
    """
    SELECT b.booking_id, b.check_in_date, b.check_out_date, b.status, b.note,
           COALESCE(string_agg(DISTINCT rt.name, ', '), '')       AS room_types,
           COALESCE(vb.grand_total, 0)                            AS grand_total,
           -- the view applies BR-9 in full (refunds back, cancelled = 0),
           -- the same rule as Booking.balance_due
           COALESCE(vb.balance_due, 0)                            AS balance_due
    FROM booking b
    LEFT JOIN booking_room br   ON br.booking_id = b.booking_id
    LEFT JOIN room rm           ON rm.room_id = br.room_id
    LEFT JOIN room_type rt      ON rt.room_type_id = rm.room_type_id
    LEFT JOIN v_booking_bill vb ON vb.booking_id = b.booking_id
    WHERE b.customer_id = :id
    GROUP BY b.booking_id, vb.grand_total, vb.balance_due
    ORDER BY b.check_in_date DESC, b.booking_id DESC
    LIMIT 12
    """
)


@router.get("/{customer_id}", response_model=CustomerDetailOut)
async def get_customer(customer_id: int, db: DbSession, _: RequireStaff) -> CustomerDetailOut:
    row = (await db.execute(_DETAIL_SQL, {"id": customer_id})).mappings().first()
    if row is None:
        raise NotFoundError("customer not found")
    recent = (await db.execute(_RECENT_SQL, {"id": customer_id})).mappings().all()
    return CustomerDetailOut(**row, recent_bookings=[GuestBookingRow(**b) for b in recent])


@router.patch("/{customer_id}", response_model=CustomerDetailOut)
async def update_customer(
    customer_id: int, body: CustomerPatch, db: DbSession, user: RequireStaff
) -> CustomerDetailOut:
    customer = await db.get(Customer, customer_id)
    if customer is None:
        raise NotFoundError("customer not found")
    changes = body.model_dump(exclude_unset=True)
    for name_field in ("first_name", "last_name"):
        if name_field in changes:
            value = (changes[name_field] or "").strip()
            if not value:
                raise ConflictError(f"{name_field} cannot be blank", code="bad_value")
            changes[name_field] = value
    for opt_field in ("phone", "id_card_no"):
        if opt_field in changes:
            changes[opt_field] = (changes[opt_field] or "").strip() or None
    for key, value in changes.items():
        setattr(customer, key, value)
    await db.flush()
    await ops_service.write_audit(
        db,
        actor_user_id=user.user_id,
        actor_label=user.username,
        action="customer.update",
        entity_type="customer",
        entity_id=str(customer_id),
        # the fields that changed, never the ID number itself (personal data)
        summary=f"{customer.full_name}: " + ", ".join(sorted(changes)),
        data={"fields": sorted(changes)},
    )
    return await get_customer(customer_id, db, user)
