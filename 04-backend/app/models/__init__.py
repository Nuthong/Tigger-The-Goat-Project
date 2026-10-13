"""Import all models so Base.metadata is fully populated."""

from app.models.auth import AppUser, AuthEvent
from app.models.booking import (
    Booking,
    BookingRoom,
    BookingService,
    Payment,
    Review,
    RoomStatusLog,
)
from app.models.catalog import Room, RoomType, Service
from app.models.ops import (
    AuditLog,
    HousekeepingTask,
    Invoice,
    InvoiceLine,
    MaintenanceTicket,
    RatePlan,
)
from app.models.people import Customer, Staff

__all__ = [
    "AppUser",
    "AuditLog",
    "AuthEvent",
    "Booking",
    "BookingRoom",
    "BookingService",
    "Customer",
    "HousekeepingTask",
    "Invoice",
    "InvoiceLine",
    "MaintenanceTicket",
    "Payment",
    "RatePlan",
    "Review",
    "Room",
    "RoomStatusLog",
    "RoomType",
    "Service",
    "Staff",
]
