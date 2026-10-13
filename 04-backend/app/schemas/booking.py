"""Booking schemas - server computes prices & totals, client cannot set status/id."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.core import clock


class BookingRoomIn(BaseModel):
    """Pick a specific room (`room_id`) OR a category (`room_type_id`, auto-assigned)."""

    model_config = ConfigDict(extra="forbid")

    room_id: int | None = Field(default=None, gt=0)
    room_type_id: int | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def _exactly_one(self) -> BookingRoomIn:
        if (self.room_id is None) == (self.room_type_id is None):
            raise ValueError("provide exactly one of room_id or room_type_id")
        return self


class BookingServiceIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    service_id: int = Field(gt=0)
    quantity: int = Field(default=1, gt=0, le=99)


class BookingCreateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    customer_id: int | None = Field(
        default=None,
        description="staff only - omit for a customer booking for themselves",
    )
    check_in_date: date
    check_out_date: date
    num_guests: int = Field(default=1, gt=0, le=20)
    note: str | None = Field(default=None, max_length=255)
    rooms: list[BookingRoomIn] = Field(min_length=1, max_length=10)
    services: list[BookingServiceIn] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def _check(self) -> BookingCreateIn:
        if self.check_in_date < clock.today():
            raise ValueError("check_in_date cannot be in the past")
        if self.check_out_date <= self.check_in_date:
            raise ValueError("check_out_date must be after check_in_date")
        specific = [r.room_id for r in self.rooms if r.room_id is not None]
        if len(specific) != len(set(specific)):
            raise ValueError("duplicate room_id in rooms")
        # one line per add-on (uq_booking_service) - a repeat would also dodge
        # the per-stay ceiling by splitting the quantity (BR-29)
        svc_ids = [s.service_id for s in self.services]
        if len(svc_ids) != len(set(svc_ids)):
            raise ValueError("list each service once and set its quantity")
        if self.num_guests < len(self.rooms):
            raise ValueError("each room needs at least one guest")
        return self


class PaymentIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    amount: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    method: str = Field(pattern=r"^(cash|credit_card|bank_transfer|promptpay)$")
    reference_no: str | None = Field(default=None, max_length=50)


class GuestPaymentIn(BaseModel):
    """A guest settling their own reservation online. There is no `amount` - the
    call always clears the whole outstanding balance, with an online method only."""

    model_config = ConfigDict(extra="forbid")

    method: str = Field(pattern=r"^(credit_card|promptpay)$")
    reference_no: str | None = Field(default=None, max_length=50)


class BookingRoomOut(BaseModel):
    """A booked room. Carries the human labels too - a bare `room_id` means
    nothing to a guest or to the front desk."""

    model_config = ConfigDict(from_attributes=True)

    room_id: int
    room_number: str
    room_type: str
    room_type_id: int
    price_per_night: Decimal


class BookingServiceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    service_id: int
    service_name: str
    quantity: int
    unit_price: Decimal


class BookingServiceAddIn(BaseModel):
    """Post a charge to an open folio - the front desk adding breakfast, a late
    checkout or the minibar during the stay. Adding a service already on the
    booking raises its quantity at the price locked when it was first added."""

    model_config = ConfigDict(extra="forbid")

    service_id: int = Field(gt=0)
    quantity: int = Field(default=1, gt=0, le=99)


class PaymentOut(BaseModel):
    """One row of the booking's payment ledger - money in (`paid`) or back out
    (`refunded`); `pending` / `failed` rows never count toward the balance."""

    model_config = ConfigDict(from_attributes=True)

    payment_id: int
    amount: Decimal
    method: str
    status: str
    paid_at: datetime | None
    reference_no: str | None


class BookingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    booking_id: int
    customer_id: int
    customer_name: str
    staff_id: int
    booking_date: datetime
    check_in_date: date
    check_out_date: date
    num_guests: int
    status: str
    note: str | None
    rooms: list[BookingRoomOut]
    services: list[BookingServiceOut]
    #: the payment ledger, oldest first
    payments: list[PaymentOut]
    #: charges vs. what's been paid, so a list view can flag "payment due"
    #: without a round-trip to the bill endpoint per row
    grand_total: Decimal
    amount_paid: Decimal
    amount_refunded: Decimal
    balance_due: Decimal
    #: for an unpaid `pending` hold: when it lapses and the room is freed (UTC);
    #: null once the booking is confirmed
    hold_expires_at: datetime | None
    #: cancel before this (UTC) for a full refund; null once uncancellable
    free_cancellation_deadline: datetime | None


class BookingBillOut(BaseModel):
    booking_id: int
    nights: int
    room_total: Decimal
    service_total: Decimal
    grand_total: Decimal
    paid_total: Decimal
    refunded_total: Decimal
    balance_due: Decimal
