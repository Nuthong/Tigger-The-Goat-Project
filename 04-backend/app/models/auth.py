"""Auth layer: app_user, auth_event (SECURITY.md §1, §2.1)."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import INET
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

# Must stay in step with the CHECK constraints in 03-database/schema.sql.
#   admin        = Super Admin      · manager    = Hotel Manager
#   receptionist = Front Desk       · housekeeping / accounting = ops teams
#   customer     = the guest signing in on the public site
USER_ROLES = ("customer", "receptionist", "housekeeping", "accounting", "manager", "admin")
STAFF_USER_ROLES = ("receptionist", "housekeeping", "accounting", "manager", "admin")

# Who may work the reservation desk (create bookings, check in/out, take payment).
FRONT_DESK_ROLES = ("receptionist", "manager", "admin")
# Who may see money and management reports.
MANAGER_ROLES = ("manager", "admin")
HOUSEKEEPING_ROLES = ("housekeeping", "manager", "admin")
ACCOUNTING_ROLES = ("accounting", "manager", "admin")
AUTH_EVENT_TYPES = ("login_success", "login_fail", "logout", "locked", "password_change")


class AppUser(Base):
    __tablename__ = "app_user"

    user_id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True)
    email: Mapped[str] = mapped_column(String(120), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20))
    customer_id: Mapped[int | None] = mapped_column(
        ForeignKey("customer.customer_id", ondelete="CASCADE")
    )
    staff_id: Mapped[int | None] = mapped_column(ForeignKey("staff.staff_id", ondelete="CASCADE"))
    is_active: Mapped[bool] = mapped_column(default=True)
    failed_login_count: Mapped[int] = mapped_column(default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    password_changed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    token_version: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AuthEvent(Base):
    __tablename__ = "auth_event"

    event_id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("app_user.user_id", ondelete="SET NULL")
    )
    username_tried: Mapped[str | None] = mapped_column(String(50))
    event_type: Mapped[str] = mapped_column(String(20))
    ip_address: Mapped[str | None] = mapped_column(INET)
    user_agent: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
