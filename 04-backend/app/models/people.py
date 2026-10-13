"""People tables: customer, staff."""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Date, DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

STAFF_ROLES = ("receptionist", "housekeeping", "accounting", "manager", "admin")


class Customer(Base):
    __tablename__ = "customer"

    customer_id: Mapped[int] = mapped_column(primary_key=True)
    first_name: Mapped[str] = mapped_column(String(60))
    last_name: Mapped[str] = mapped_column(String(60))
    email: Mapped[str] = mapped_column(String(120), unique=True)
    phone: Mapped[str | None] = mapped_column(String(20))
    id_card_no: Mapped[str | None] = mapped_column(String(30))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}"


class Staff(Base):
    __tablename__ = "staff"

    staff_id: Mapped[int] = mapped_column(primary_key=True)
    first_name: Mapped[str] = mapped_column(String(60))
    last_name: Mapped[str] = mapped_column(String(60))
    email: Mapped[str] = mapped_column(String(120), unique=True)
    phone: Mapped[str | None] = mapped_column(String(20))
    role: Mapped[str] = mapped_column(String(20), default="receptionist")
    hired_at: Mapped[date] = mapped_column(Date, server_default=func.current_date())
    is_active: Mapped[bool] = mapped_column(default=True)

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}"
