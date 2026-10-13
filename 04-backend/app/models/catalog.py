"""Catalog tables: room_type, room, service."""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy import ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

# physical state of the room; "booked/occupied" is derived from booking
ROOM_STATUSES = ("available", "cleaning", "maintenance", "closed")


class RoomType(Base):
    __tablename__ = "room_type"

    room_type_id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(50), unique=True)
    description: Mapped[str | None] = mapped_column(String(255))
    base_price_per_night: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    max_occupancy: Mapped[int]

    rooms: Mapped[list[Room]] = relationship(back_populates="room_type")


class Room(Base):
    __tablename__ = "room"

    room_id: Mapped[int] = mapped_column(primary_key=True)
    room_number: Mapped[str] = mapped_column(String(10), unique=True)
    floor: Mapped[int]
    room_type_id: Mapped[int] = mapped_column(ForeignKey("room_type.room_type_id"))
    status: Mapped[str] = mapped_column(String(20), default="available")
    note: Mapped[str | None] = mapped_column(String(255))

    # eager: every room we serialize also names its category, and a lazy load
    # inside the async session raises MissingGreenlet
    room_type: Mapped[RoomType] = relationship(back_populates="rooms", lazy="joined")


class Service(Base):
    __tablename__ = "service"

    service_id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    price: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    description: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(default=True)
