"""/api/v1/reports - management reporting, reads the SQL views from schema.sql.

Every endpoint here only reads, through the app_readonly role (NFR-3)."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlalchemy import text

from app.api.deps import ReadonlyDbSession, RequireAccounting, RequireManager, RequireStaff
from app.core import clock

router = APIRouter(prefix="/reports", tags=["reports"])


class RoomTypeRevenueRow(BaseModel):
    room_type: str
    booking_count: int
    total_room_nights: int
    revenue: Decimal


class OccupancyRow(BaseModel):
    month: str
    room_nights_sold: int
    room_nights_capacity: int
    occupancy_pct: float
    #: average daily rate - room revenue divided by the nights actually sold
    adr: Decimal
    #: revenue per available room - room revenue divided by the nights on offer
    #: (equivalently ADR x occupancy); the yield figure a GM watches
    revpar: Decimal


@router.get("/revenue-by-room-type", response_model=list[RoomTypeRevenueRow])
async def revenue_by_room_type(db: ReadonlyDbSession, _: RequireManager) -> list[dict[str, object]]:
    """Booking count, room-nights and revenue per room type (reads `v_room_type_revenue`)."""
    rows = await db.execute(text("SELECT * FROM v_room_type_revenue"))
    return [dict(r._mapping) for r in rows]


@router.get("/occupancy", response_model=list[OccupancyRow])
async def occupancy(db: ReadonlyDbSession, _: RequireManager) -> list[dict[str, object]]:
    """Monthly occupancy, ADR and RevPAR for the last 24 months."""
    rows = await db.execute(
        text(
            """
            WITH nightly AS (
                SELECT gs::date AS stay_date, br.room_id, br.price_per_night
                FROM booking_room br
                JOIN booking b
                  ON b.booking_id = br.booking_id AND b.status <> 'cancelled'
                CROSS JOIN LATERAL generate_series(
                    b.check_in_date, b.check_out_date - 1, INTERVAL '1 day'
                ) AS gs
            ),
            total_rooms AS (SELECT COUNT(*) AS n FROM room),
            monthly AS (
                SELECT
                    date_trunc('month', n.stay_date) AS m,
                    COUNT(*)::int AS sold,
                    COALESCE(SUM(n.price_per_night), 0) AS revenue,
                    ((SELECT n FROM total_rooms) * EXTRACT(
                        DAY FROM date_trunc('month', n.stay_date)
                                 + INTERVAL '1 month - 1 day'
                    ))::int AS capacity
                FROM nightly n
                GROUP BY date_trunc('month', n.stay_date)
            )
            SELECT
                to_char(m, 'YYYY-MM')                  AS month,
                sold                                   AS room_nights_sold,
                capacity                               AS room_nights_capacity,
                ROUND(100.0 * sold / capacity, 1)::float AS occupancy_pct,
                ROUND(revenue / NULLIF(sold, 0), 2)     AS adr,
                ROUND(revenue / NULLIF(capacity, 0), 2) AS revpar
            FROM (SELECT * FROM monthly ORDER BY m DESC LIMIT 24) recent
            ORDER BY month
            """
        )
    )
    return [dict(r._mapping) for r in rows]


class ForecastRow(BaseModel):
    date: date
    rooms_sold: int
    rooms_available: int
    occupancy_pct: float
    #: room charge already committed for that night (confirmed / in-house only)
    revenue_on_books: Decimal
    arrivals: int
    departures: int


@router.get("/forecast", response_model=list[ForecastRow])
async def forecast(
    db: ReadonlyDbSession,
    _: RequireManager,
    days: Annotated[int, Query(ge=1, le=90)] = 30,
) -> list[dict[str, object]]:
    """Occupancy and room revenue already on the books for the next `days`
    nights - confirmed and in-house stays only; unpaid holds are excluded
    because they can still lapse."""
    rows = await db.execute(
        text(
            """
            WITH horizon AS (
                SELECT (CURRENT_DATE + g)::date AS d
                FROM generate_series(0, :days - 1) AS g
            ),
            total_rooms AS (SELECT COUNT(*) AS n FROM room),
            occ AS (
                SELECT h.d,
                       COUNT(br.room_id)                    AS sold,
                       COALESCE(SUM(br.price_per_night), 0) AS revenue
                FROM horizon h
                LEFT JOIN booking b
                       ON b.status IN ('confirmed', 'checked_in')
                      AND h.d >= b.check_in_date
                      AND h.d <  b.check_out_date
                LEFT JOIN booking_room br ON br.booking_id = b.booking_id
                GROUP BY h.d
            ),
            arr AS (
                SELECT check_in_date AS d, COUNT(*) AS n
                FROM booking WHERE status <> 'cancelled'
                GROUP BY check_in_date
            ),
            dep AS (
                SELECT check_out_date AS d, COUNT(*) AS n
                FROM booking WHERE status <> 'cancelled'
                GROUP BY check_out_date
            )
            SELECT o.d                                          AS date,
                   o.sold                                       AS rooms_sold,
                   (SELECT n FROM total_rooms)                   AS rooms_available,
                   ROUND(
                       100.0 * o.sold / NULLIF((SELECT n FROM total_rooms), 0), 1
                   )::float                                     AS occupancy_pct,
                   o.revenue                                    AS revenue_on_books,
                   COALESCE(a.n, 0)                             AS arrivals,
                   COALESCE(dp.n, 0)                            AS departures
            FROM occ o
            LEFT JOIN arr a  ON a.d = o.d
            LEFT JOIN dep dp ON dp.d = o.d
            ORDER BY o.d
            """
        ),
        {"days": days},
    )
    return [dict(r._mapping) for r in rows]


class RateCalNight(BaseModel):
    date: date
    price: Decimal


class RateCalRow(BaseModel):
    room_type_id: int
    room_type_name: str
    base_price_per_night: Decimal
    nights: list[RateCalNight]


@router.get("/rate-calendar", response_model=list[RateCalRow])
async def rate_calendar(
    db: ReadonlyDbSession,
    _: RequireManager,
    month: Annotated[str | None, Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")] = None,
) -> list[dict[str, object]]:
    """The effective nightly rate (`fn_quote_room`) for every room type across a
    calendar month - shows where the rate plans actually bite."""
    anchor = datetime.strptime(month, "%Y-%m").date() if month else clock.today().replace(day=1)
    start = anchor.replace(day=1)
    end = (start.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)

    rows = await db.execute(
        text(
            """
            SELECT rt.room_type_id,
                   rt.name                        AS room_type_name,
                   rt.base_price_per_night,
                   d::date                        AS night,
                   fn_quote_room(rt.room_type_id, d::date) AS price
            FROM room_type rt
            CROSS JOIN generate_series(:start, :end, INTERVAL '1 day') AS d
            ORDER BY rt.room_type_id, night
            """
        ),
        {"start": start, "end": end},
    )
    by_type: dict[int, dict[str, object]] = {}
    for r in rows:
        row = by_type.setdefault(
            r.room_type_id,
            {
                "room_type_id": r.room_type_id,
                "room_type_name": r.room_type_name,
                "base_price_per_night": r.base_price_per_night,
                "nights": [],
            },
        )
        nights = row["nights"]
        assert isinstance(nights, list)
        nights.append({"date": r.night, "price": r.price})
    return list(by_type.values())


class DailyRevenueRow(BaseModel):
    stay_date: date
    bookings: int
    room_nights: int
    room_revenue: Decimal


@router.get("/daily-revenue", response_model=list[DailyRevenueRow])
async def daily_revenue(
    db: ReadonlyDbSession,
    _: RequireAccounting,
    date_from: Annotated[date | None, Query(alias="from")] = None,
    date_to: Annotated[date | None, Query(alias="to")] = None,
) -> list[dict[str, object]]:
    """Room revenue spread over the nights actually stayed - the accounting view
    (reads `v_daily_revenue`)."""
    sql = "SELECT * FROM v_daily_revenue"
    where: list[str] = []
    params: dict[str, object] = {}
    if date_from:
        where.append("stay_date >= :d1")
        params["d1"] = date_from
    if date_to:
        where.append("stay_date <= :d2")
        params["d2"] = date_to
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY stay_date DESC LIMIT 400"
    rows = await db.execute(text(sql), params)
    return [dict(r._mapping) for r in rows]


class InHouseRow(BaseModel):
    """One occupied room right now - a `v_current_guests` row, plus the stay's
    party size and what is still owed on it (for the check-out conversation)."""

    booking_id: int
    customer_name: str
    room_number: str
    room_type: str
    check_in_date: date
    check_out_date: date
    num_guests: int
    balance_due: Decimal


# v_current_guests is one row per occupied room; v_booking_bill applies the whole
# BR-9 rule (refunds added back, cancelled = 0), the same as Booking.balance_due.
_IN_HOUSE_SQL = text(
    """
    SELECT cg.booking_id, cg.customer_name, cg.room_number, cg.room_type,
           cg.check_in_date, cg.check_out_date, b.num_guests, vb.balance_due
    FROM v_current_guests cg
    JOIN booking b        ON b.booking_id  = cg.booking_id
    JOIN v_booking_bill vb ON vb.booking_id = cg.booking_id
    ORDER BY cg.check_out_date, cg.room_number
    """
)


@router.get("/in-house", response_model=list[InHouseRow])
async def in_house(db: ReadonlyDbSession, _: RequireStaff) -> list[dict[str, object]]:
    """Every room with a checked-in guest (reads `v_current_guests`) - the front
    desk's in-house list, soonest departure first."""
    rows = await db.execute(_IN_HOUSE_SQL)
    return [dict(r._mapping) for r in rows]
