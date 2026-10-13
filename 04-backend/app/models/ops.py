"""Operations tables: rate_plan, invoice(+lines), housekeeping_task,
maintenance_ticket, audit_log.

Mirrors the DDL in 03-database/schema.sql - this project is DB-first, so the
CHECK constraints there are the source of truth and the tuples below exist to
keep the API's validation in step with them.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Numeric, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.catalog import Room, RoomType
from app.models.people import Staff

RATE_PLAN_KINDS = ("seasonal", "weekend", "weekday", "promotion")
INVOICE_STATUSES = ("draft", "issued", "paid", "void")
INVOICE_LINE_TYPES = ("room", "service", "discount")
HOUSEKEEPING_TASK_TYPES = (
    "checkout_clean",
    "stayover_clean",
    "deep_clean",
    "turndown",
    "inspection",
)
HOUSEKEEPING_STATUSES = ("pending", "in_progress", "done", "skipped")
MAINTENANCE_CATEGORIES = (
    "plumbing",
    "electrical",
    "hvac",
    "furniture",
    "appliance",
    "other",
)
MAINTENANCE_PRIORITIES = ("low", "normal", "high", "urgent")
MAINTENANCE_STATUSES = ("open", "in_progress", "resolved", "closed", "cancelled")


class RatePlan(Base):
    __tablename__ = "rate_plan"

    rate_plan_id: Mapped[int] = mapped_column(primary_key=True)
    room_type_id: Mapped[int] = mapped_column(ForeignKey("room_type.room_type_id"))
    name: Mapped[str] = mapped_column(String(80))
    kind: Mapped[str] = mapped_column(String(20), default="seasonal")
    price_per_night: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    valid_from: Mapped[date] = mapped_column(Date)
    valid_to: Mapped[date] = mapped_column(Date)
    applies_weekday: Mapped[bool] = mapped_column(Boolean, default=True)
    applies_weekend: Mapped[bool] = mapped_column(Boolean, default=True)
    priority: Mapped[int] = mapped_column(default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    room_type: Mapped[RoomType] = relationship(lazy="joined")

    @property
    def room_type_name(self) -> str:
        return self.room_type.name


class Invoice(Base):
    __tablename__ = "invoice"

    invoice_id: Mapped[int] = mapped_column(primary_key=True)
    booking_id: Mapped[int] = mapped_column(ForeignKey("booking.booking_id", ondelete="CASCADE"))
    invoice_no: Mapped[str] = mapped_column(String(20), unique=True)
    issued_by: Mapped[int | None] = mapped_column(ForeignKey("staff.staff_id"))
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    status: Mapped[str] = mapped_column(String(20), default="issued")
    tax_rate: Mapped[Decimal] = mapped_column(Numeric(5, 4), default=Decimal("0.07"))
    subtotal: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    tax_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    total: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    note: Mapped[str | None] = mapped_column(String(255))

    lines: Mapped[list[InvoiceLine]] = relationship(
        back_populates="invoice", cascade="all, delete-orphan", lazy="selectin",
        order_by="InvoiceLine.line_no",
    )
    issuer: Mapped[Staff | None] = relationship(lazy="joined")

    @property
    def issued_by_name(self) -> str | None:
        return self.issuer.full_name if self.issuer else None


class InvoiceLine(Base):
    __tablename__ = "invoice_line"

    invoice_line_id: Mapped[int] = mapped_column(primary_key=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoice.invoice_id", ondelete="CASCADE"))
    line_no: Mapped[int]
    line_type: Mapped[str] = mapped_column(String(20))
    description: Mapped[str] = mapped_column(String(160))
    quantity: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    unit_price: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))

    invoice: Mapped[Invoice] = relationship(back_populates="lines")


class HousekeepingTask(Base):
    __tablename__ = "housekeeping_task"

    task_id: Mapped[int] = mapped_column(primary_key=True)
    room_id: Mapped[int] = mapped_column(ForeignKey("room.room_id", ondelete="CASCADE"))
    booking_id: Mapped[int | None] = mapped_column(ForeignKey("booking.booking_id"))
    task_type: Mapped[str] = mapped_column(String(20), default="checkout_clean")
    status: Mapped[str] = mapped_column(String(20), default="pending")
    scheduled_for: Mapped[date] = mapped_column(Date, server_default=func.current_date())
    assigned_to: Mapped[int | None] = mapped_column(ForeignKey("staff.staff_id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    note: Mapped[str | None] = mapped_column(String(255))

    room: Mapped[Room] = relationship(lazy="joined")
    assignee: Mapped[Staff | None] = relationship(lazy="joined")

    #: not mapped - set transiently by list_housekeeping when a guest checks
    #: into this room today, so the board can float it to the top
    arriving_today: bool = False

    @property
    def room_number(self) -> str:
        return self.room.room_number

    @property
    def room_type(self) -> str:
        return self.room.room_type.name

    @property
    def floor(self) -> int:
        return self.room.floor

    @property
    def assigned_to_name(self) -> str | None:
        return self.assignee.full_name if self.assignee else None


class MaintenanceTicket(Base):
    __tablename__ = "maintenance_ticket"

    ticket_id: Mapped[int] = mapped_column(primary_key=True)
    room_id: Mapped[int | None] = mapped_column(ForeignKey("room.room_id"))
    reported_by: Mapped[int] = mapped_column(ForeignKey("staff.staff_id"))
    assigned_to: Mapped[int | None] = mapped_column(ForeignKey("staff.staff_id"))
    category: Mapped[str] = mapped_column(String(20), default="other")
    priority: Mapped[str] = mapped_column(String(10), default="normal")
    status: Mapped[str] = mapped_column(String(20), default="open")
    title: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolution: Mapped[str | None] = mapped_column(String(500))

    room: Mapped[Room | None] = relationship(lazy="joined")
    reporter: Mapped[Staff] = relationship(lazy="joined", foreign_keys=[reported_by])
    assignee: Mapped[Staff | None] = relationship(lazy="joined", foreign_keys=[assigned_to])

    @property
    def room_number(self) -> str | None:
        return self.room.room_number if self.room else None

    @property
    def reported_by_name(self) -> str:
        return self.reporter.full_name

    @property
    def assigned_to_name(self) -> str | None:
        return self.assignee.full_name if self.assignee else None


class AuditLog(Base):
    __tablename__ = "audit_log"

    audit_id: Mapped[int] = mapped_column(primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("app_user.user_id"))
    actor_label: Mapped[str | None] = mapped_column(String(50))
    action: Mapped[str] = mapped_column(String(40))
    entity_type: Mapped[str] = mapped_column(String(30))
    entity_id: Mapped[str | None] = mapped_column(String(30))
    summary: Mapped[str | None] = mapped_column(String(255))
    data: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
