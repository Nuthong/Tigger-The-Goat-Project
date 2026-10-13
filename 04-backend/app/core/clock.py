"""The hotel's local clock.

Arrival days, "today's" boards and the free-cancellation deadline are business
dates in the hotel's time zone. `date.today()` would follow whatever zone the
container runs in (UTC in Docker), so between midnight and 07:00 Bangkok time the
system would still think it was yesterday.
"""

from __future__ import annotations

from datetime import date, datetime, time
from functools import lru_cache
from zoneinfo import ZoneInfo

from app.core.config import get_settings


@lru_cache
def hotel_tz() -> ZoneInfo:
    return ZoneInfo(get_settings().hotel_timezone)


def now() -> datetime:
    """Aware 'now' in the hotel's zone."""
    return datetime.now(hotel_tz())


def today() -> date:
    """The hotel's current business date."""
    return now().date()


def start_of_day(day: date) -> datetime:
    """Midnight at the hotel on `day`, as an aware datetime."""
    return datetime.combine(day, time.min, tzinfo=hotel_tz())
