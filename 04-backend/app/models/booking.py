"""Transaction tables: booking, booking_room, booking_service, payment, review, room_status_log."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core import clock
from app.core.config import get_settings
from app.db.base import Base
from app.models.catalog import Room, Service
from app.models.people import Customer, Staff

BOOKING_STATUSES = ("pending", "confirmed", "checked_in", "checked_out", "cancelled")
ACTIVE_BOOKING_STATUSES = ("pending", "confirmed", "checked_in")
PAYMENT_METHODS = ("cash", "credit_card", "bank_transfer", "promptpay")
PAYMENT_STATUSES = ("pending", "paid", "refunded", "failed")

_ZERO = Decimal("0.00")


class Booking(Base):
    __tablename__ = "booking"

    booking_id: Mapped[int] = mapped_column(primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customer.customer_id"))
    staff_id: Mapped[int] = mapped_column(ForeignKey("staff.staff_id"))
    booking_date: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    check_in_date: Mapped[date] = mapped_column(Date)
    check_out_date: Mapped[date] = mapped_column(Date)
    num_guests: Mapped[int] = mapped_column(default=1)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    note: Mapped[str | None] = mapped_column(String(255))

    customer: Mapped[Customer] = relationship(lazy="joined")
    staff: Mapped[Staff] = relationship(lazy="joined")
    rooms: Mapped[list[BookingRoom]] = relationship(
        back_populates="booking", cascade="all, delete-orphan", lazy="selectin"
    )
    services: Mapped[list[BookingService]] = relationship(
        back_populates="booking", cascade="all, delete-orphan", lazy="selectin"
    )
    payments: Mapped[list[Payment]] = relationship(
        back_populates="booking",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="Payment.payment_id",
    )

    @property
    def nights(self) -> int:
        return (self.check_out_date - self.check_in_date).days

    @property
    def customer_name(self) -> str:
        """Who the stay is for - the front desk works by name, not by id."""
        return self.customer.full_name

    @property
    def hold_expires_at(self) -> datetime | None:
        """When an unpaid `pending` hold lapses and its room is released;
        `None` once the booking is a real (paid / desk) reservation."""
        if self.status != "pending":
            return None
        return self.booking_date + timedelta(minutes=get_settings().hold_expiry_minutes)

    @property
    def free_cancellation_deadline(self) -> datetime | None:
        """Cancel before this for a full refund; after it a one-night fee is
        kept. `None` once the stay can no longer be cancelled."""
        if self.status not in ("pending", "confirmed"):
            return None
        hours = get_settings().free_cancellation_hours
        # midnight at the hotel on arrival day, not midnight UTC (07:00 in Bangkok)
        check_in_start = clock.start_of_day(self.check_in_date)
        return check_in_start - timedelta(hours=hours)

    # --- money: one source of truth for the bill, reused by BookingOut and the
    #     dedicated bill endpoint. Safe to read only with rooms / services /
    #     payments loaded (they are, everywhere a Booking is serialized).
    @property
    def room_charge(self) -> Decimal:
        return sum((br.price_per_night * self.nights for br in self.rooms), _ZERO)

    @property
    def service_charge(self) -> Decimal:
        return sum((bs.unit_price * bs.quantity for bs in self.services), _ZERO)

    @property
    def grand_total(self) -> Decimal:
        return self.room_charge + self.service_charge

    @property
    def amount_paid(self) -> Decimal:
        return sum((p.amount for p in self.payments if p.status == "paid"), _ZERO)

    @property
    def amount_refunded(self) -> Decimal:
        return sum((p.amount for p in self.payments if p.status == "refunded"), _ZERO)

    @property
    def balance_due(self) -> Decimal:
        """What the guest still owes: the bill less what they have actually paid
        net of refunds. A cancelled stay owes nothing."""
        if self.status == "cancelled":
            return _ZERO
        return self.grand_total - self.amount_paid + self.amount_refunded

    @property
    def first_night_rate(self) -> Decimal:
        """The room charge for a single night - the late-cancellation fee."""
        return sum((br.price_per_night for br in self.rooms), _ZERO)


class BookingRoom(Base):
    __tablename__ = "booking_room"
    __table_args__ = (UniqueConstraint("booking_id", "room_id", name="uq_booking_room"),)

    booking_room_id: Mapped[int] = mapped_column(primary_key=True)
    booking_id: Mapped[int] = mapped_column(ForeignKey("booking.booking_id", ondelete="CASCADE"))
    room_id: Mapped[int] = mapped_column(ForeignKey("room.room_id"))
    price_per_night: Mapped[Decimal] = mapped_column(Numeric(10, 2))

    booking: Mapped[Booking] = relationship(back_populates="rooms")
    room: Mapped[Room] = relationship(lazy="joined")

    @property
    def room_number(self) -> str:
        return self.room.room_number

    @property
    def room_type(self) -> str:
        return self.room.room_type.name

    @property
    def room_type_id(self) -> int:
        return self.room.room_type_id


class BookingService(Base):
    __tablename__ = "booking_service"
    __table_args__ = (UniqueConstraint("booking_id", "service_id", name="uq_booking_service"),)

    booking_service_id: Mapped[int] = mapped_column(primary_key=True)
    booking_id: Mapped[int] = mapped_column(ForeignKey("booking.booking_id", ondelete="CASCADE"))
    service_id: Mapped[int] = mapped_column(ForeignKey("service.service_id"))
    quantity: Mapped[int] = mapped_column(default=1)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(10, 2))

    booking: Mapped[Booking] = relationship(back_populates="services")
    service: Mapped[Service] = relationship(lazy="joined")

    @property
    def service_name(self) -> str:
        return self.service.name


class Payment(Base):
    __tablename__ = "payment"

    payment_id: Mapped[int] = mapped_column(primary_key=True)
    booking_id: Mapped[int] = mapped_column(ForeignKey("booking.booking_id", ondelete="CASCADE"))
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    method: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(20), default="pending")
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reference_no: Mapped[str | None] = mapped_column(String(50))

    booking: Mapped[Booking] = relationship(back_populates="payments")


class Review(Base):
    __tablename__ = "review"

    review_id: Mapped[int] = mapped_column(primary_key=True)
    booking_id: Mapped[int] = mapped_column(
        ForeignKey("booking.booking_id", ondelete="CASCADE"), unique=True
    )
    rating: Mapped[int]
    comment: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RoomStatusLog(Base):
    __tablename__ = "room_status_log"

    log_id: Mapped[int] = mapped_column(primary_key=True)
    room_id: Mapped[int] = mapped_column(ForeignKey("room.room_id", ondelete="CASCADE"))
    changed_by: Mapped[int] = mapped_column(ForeignKey("staff.staff_id"))
    old_status: Mapped[str] = mapped_column(String(20))
    new_status: Mapped[str] = mapped_column(String(20))
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
