"""Room / room-type / availability schemas."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class RoomTypeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    room_type_id: int
    name: str
    description: str | None
    base_price_per_night: Decimal
    max_occupancy: int
    #: mean guest rating 1-5 (None until the type has a review) and how many
    avg_rating: Decimal | None = None
    review_count: int = 0


class RoomTypePatch(BaseModel):
    """Manager edits a category's list price, wording or capacity. The name is
    fixed - the guest site keys its photography and copy to each category."""

    model_config = ConfigDict(extra="forbid")

    description: str | None = Field(default=None, max_length=255)
    base_price_per_night: Decimal | None = Field(
        default=None, ge=0, max_digits=10, decimal_places=2
    )
    max_occupancy: int | None = Field(default=None, gt=0, le=20)


class RoomStatusLogOut(BaseModel):
    """One change of a room's physical status (`room_status_log`)."""

    log_id: int
    room_id: int
    old_status: str
    new_status: str
    changed_at: datetime
    changed_by: int
    changed_by_name: str


class ReviewItemOut(BaseModel):
    """One published guest review - no ids, guest shown as 'First L.'"""

    rating: int
    comment: str | None
    guest_name: str
    created_at: datetime


class RoomTypeReviewsOut(BaseModel):
    room_type_id: int
    name: str
    average: Decimal | None
    count: int
    #: how many gave each score, 1..5
    distribution: dict[int, int]
    items: list[ReviewItemOut]


class RoomOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    room_id: int
    room_number: str
    floor: int
    room_type_id: int
    status: str
    note: str | None
    #: a guest is currently checked in - derived from bookings, not stored on the
    #: room (the schema's status set is available/cleaning/maintenance/closed)
    occupied: bool = False


class RoomCreateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    room_number: str = Field(min_length=1, max_length=10)
    floor: int = Field(ge=0)
    room_type_id: int = Field(gt=0)
    note: str | None = Field(default=None, max_length=255)


class RoomStatusUpdateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: str = Field(pattern=r"^(available|cleaning|maintenance|closed)$")


class AvailabilityQuery(BaseModel):
    check_in: date
    check_out: date

    @model_validator(mode="after")
    def _check_range(self) -> AvailabilityQuery:
        if self.check_out <= self.check_in:
            raise ValueError("check_out must be after check_in")
        return self


class AvailableRoomOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    room_id: int
    room_number: str
    room_type: str
    price_per_night: Decimal
    max_occupancy: int


class AvailableRoomTypeOut(BaseModel):
    """One card per category - the guest-facing view (like real hotel sites)."""

    room_type_id: int
    name: str
    description: str | None
    #: what these dates cost per night with rate plans applied
    price_per_night: Decimal
    #: the list price, so the UI can show a promotion as a strike-through
    base_price_per_night: Decimal
    max_occupancy: int
    available_count: int
    #: mean guest rating (1-5), or None when the type has no reviews yet
    avg_rating: Decimal | None = None
    #: non-cancelled bookings ever made for this type - a popularity signal
    booking_count: int = 0
