"""Schemas for the operations modules: rate plans, invoices, housekeeping,
maintenance and the audit trail."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

# --------------------------------------------------------------- rate plans

_KIND = r"^(seasonal|weekend|weekday|promotion)$"


class RatePlanIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    room_type_id: int = Field(gt=0)
    name: str = Field(min_length=1, max_length=80)
    kind: str = Field(default="seasonal", pattern=_KIND)
    price_per_night: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    valid_from: date
    valid_to: date
    applies_weekday: bool = True
    applies_weekend: bool = True
    priority: int = Field(default=0, ge=0, le=999)
    is_active: bool = True

    @model_validator(mode="after")
    def _check(self) -> RatePlanIn:
        if self.valid_to < self.valid_from:
            raise ValueError("valid_to must not be before valid_from")
        if not (self.applies_weekday or self.applies_weekend):
            raise ValueError("a plan must apply to weekdays, weekends, or both")
        return self


class RatePlanPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=80)
    price_per_night: Decimal | None = Field(default=None, gt=0, max_digits=10, decimal_places=2)
    priority: int | None = Field(default=None, ge=0, le=999)
    is_active: bool | None = None


class RatePlanOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    rate_plan_id: int
    room_type_id: int
    room_type_name: str
    name: str
    kind: str
    price_per_night: Decimal
    valid_from: date
    valid_to: date
    applies_weekday: bool
    applies_weekend: bool
    priority: int
    is_active: bool


class QuoteNight(BaseModel):
    night: date
    price: Decimal


class QuoteOut(BaseModel):
    """What a stay costs once rate plans are applied, night by night."""

    room_type_id: int
    room_type_name: str
    check_in_date: date
    check_out_date: date
    nights: int
    base_price_per_night: Decimal
    #: what the booking will charge (nights x the rounded nightly average)
    total: Decimal
    #: the plain sum of the nightly plan prices; may differ from `total` by the
    #: rounding of the average (a few satang)
    rate_total: Decimal
    average_per_night: Decimal
    breakdown: list[QuoteNight]


# ----------------------------------------------------------------- invoices


class InvoiceLineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    line_no: int
    line_type: str
    description: str
    quantity: Decimal
    unit_price: Decimal
    amount: Decimal


class InvoiceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    invoice_id: int
    invoice_no: str
    booking_id: int
    issued_at: datetime
    issued_by_name: str | None
    status: str
    tax_rate: Decimal
    subtotal: Decimal
    tax_amount: Decimal
    total: Decimal
    note: str | None
    lines: list[InvoiceLineOut]


class InvoiceRow(BaseModel):
    """Listing row - reads v_invoice_summary, which adds paid/balance."""

    invoice_id: int
    invoice_no: str
    booking_id: int
    customer_name: str
    issued_at: datetime
    status: str
    subtotal: Decimal
    tax_amount: Decimal
    total: Decimal
    paid_total: Decimal
    balance_due: Decimal


class InvoiceIssueIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tax_rate: Decimal = Field(default=Decimal("0.07"), ge=0, lt=1, max_digits=5, decimal_places=4)
    discount: Decimal = Field(default=Decimal("0"), ge=0, max_digits=10, decimal_places=2)
    note: str | None = Field(default=None, max_length=255)


class DailyRevenueRow(BaseModel):
    stay_date: date
    bookings: int
    room_nights: int
    room_revenue: Decimal


# ------------------------------------------------------------- housekeeping

_HK_TYPE = r"^(checkout_clean|stayover_clean|deep_clean|turndown|inspection)$"
_HK_STATUS = r"^(pending|in_progress|done|skipped)$"


class HousekeepingTaskIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    room_id: int = Field(gt=0)
    task_type: str = Field(default="checkout_clean", pattern=_HK_TYPE)
    scheduled_for: date | None = None
    assigned_to: int | None = Field(default=None, gt=0)
    note: str | None = Field(default=None, max_length=255)


class HousekeepingTaskPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: str | None = Field(default=None, pattern=_HK_STATUS)
    assigned_to: int | None = Field(default=None, gt=0)
    note: str | None = Field(default=None, max_length=255)


class HousekeepingTaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    task_id: int
    room_id: int
    room_number: str
    room_type: str
    floor: int
    booking_id: int | None
    task_type: str
    status: str
    scheduled_for: date
    assigned_to: int | None
    assigned_to_name: str | None
    started_at: datetime | None
    completed_at: datetime | None
    note: str | None
    #: a guest checks into this room today - clean it ahead of the rest
    arriving_today: bool = False


class HousekeepingBoardRow(BaseModel):
    """One line of the printable daily board - reads `v_housekeeping_board`."""

    task_id: int
    scheduled_for: date
    status: str
    task_type: str
    room_id: int
    room_number: str
    floor: int
    room_type: str
    room_status: str
    booking_id: int | None
    assigned_to_name: str | None
    note: str | None


class AutoAssignStaffRow(BaseModel):
    staff_id: int
    name: str
    count: int


class AutoAssignResult(BaseModel):
    assigned: int
    by_staff: list[AutoAssignStaffRow]


# -------------------------------------------------------------- maintenance

_MT_CATEGORY = r"^(plumbing|electrical|hvac|furniture|appliance|other)$"
_MT_PRIORITY = r"^(low|normal|high|urgent)$"
_MT_STATUS = r"^(open|in_progress|resolved|closed|cancelled)$"


class MaintenanceTicketIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    room_id: int | None = Field(default=None, gt=0, description="omit for a common area")
    category: str = Field(default="other", pattern=_MT_CATEGORY)
    priority: str = Field(default="normal", pattern=_MT_PRIORITY)
    title: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)


class MaintenanceTicketPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: str | None = Field(default=None, pattern=_MT_STATUS)
    priority: str | None = Field(default=None, pattern=_MT_PRIORITY)
    assigned_to: int | None = Field(default=None, gt=0)
    resolution: str | None = Field(default=None, max_length=500)


class MaintenanceTicketOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    ticket_id: int
    room_id: int | None
    room_number: str | None
    category: str
    priority: str
    status: str
    title: str
    description: str | None
    reported_by_name: str
    assigned_to: int | None
    assigned_to_name: str | None
    created_at: datetime
    resolved_at: datetime | None
    resolution: str | None


class MaintenanceBacklogRow(BaseModel):
    """An open / in-progress ticket and how many days it has been waiting -
    reads `v_maintenance_open` (already ordered urgent-first, then oldest)."""

    ticket_id: int
    title: str
    category: str
    priority: str
    status: str
    room_number: str | None
    reported_by_name: str
    assigned_to_name: str | None
    created_at: datetime
    age_days: int


# --------------------------------------------------------------- admin/audit


class AuditRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    audit_id: int
    at: datetime
    actor_label: str | None
    action: str
    entity_type: str
    entity_id: str | None
    summary: str | None
    data: dict[str, Any] | None


class StaffOption(BaseModel):
    """A staff member the front desk can assign work to."""

    model_config = ConfigDict(from_attributes=True)

    staff_id: int
    full_name: str
    role: str


class ReviewRow(BaseModel):
    """A guest review, for the staff feedback board."""

    review_id: int
    booking_id: int
    customer_name: str
    room_type: str | None
    rating: int
    comment: str | None
    created_at: datetime


class UserRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: int
    username: str
    email: str
    role: str
    is_active: bool
    customer_id: int | None
    staff_id: int | None
    last_login_at: datetime | None
    locked_until: datetime | None
    #: from the linked `staff` / `customer` record (set by the listing)
    full_name: str | None = None
    phone: str | None = None
    #: staff only - `staff.hired_at`
    hired_at: date | None = None


class AuthEventRow(BaseModel):
    """One sign-in event (`auth_event`). `username` is the account's current
    name, or what was typed when the attempt matched no account."""

    event_id: int
    created_at: datetime
    event_type: str
    user_id: int | None
    username: str | None
    role: str | None
    ip_address: str | None
    user_agent: str | None


class AuthEventStats(BaseModel):
    """Sign-in activity over the last `days` days, for the security header."""

    days: int
    login_success: int
    login_fail: int
    logout: int
    locked: int
    password_change: int
    distinct_users: int


class UserPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: str | None = Field(
        default=None,
        pattern=r"^(customer|receptionist|housekeeping|accounting|manager|admin)$",
    )
    is_active: bool | None = None
    unlock: bool = False


class EmployeeCreateIn(BaseModel):
    """Admin creates a staff login: makes a `staff` record + an `app_user` for it.
    Guests never come through here - they self-register as `customer`."""

    model_config = ConfigDict(extra="forbid")

    username: str = Field(min_length=3, max_length=50, pattern=r"^[A-Za-z0-9_.-]+$")
    password: str = Field(min_length=10, max_length=128)
    # staff use internal addresses (e.g. name@hotel.local) that EmailStr rejects as
    # a reserved domain - a plain shape check is enough here
    email: str = Field(min_length=5, max_length=120, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    first_name: str = Field(min_length=1, max_length=60)
    last_name: str = Field(min_length=1, max_length=60)
    phone: str | None = Field(default=None, max_length=20)
    role: str = Field(pattern=r"^(receptionist|housekeeping|accounting|manager|admin)$")
