"""/api/v1/invoices - tax invoices.

Accounting and management work the whole ledger; a guest may fetch the invoice
for their own stay and nobody else's.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlalchemy import text

from app.api.deps import CurrentUser, DbSession, PageParams, RequireAccounting, RequireStaff
from app.exceptions import ForbiddenError, NotFoundError
from app.models.booking import Booking
from app.models.ops import Invoice
from app.schemas.common import Page
from app.schemas.ops import InvoiceIssueIn, InvoiceOut, InvoiceRow
from app.services import ops_service

router = APIRouter(tags=["invoices"])

# the page and its count share one filter (all values bound, never interpolated) -
# kept as two full literals so they stay in lockstep without string building.
# CAST(), not `::` - text() treats ":name::date" as a bind param named "name::date".
_LIST_SQL = text(
    """
    SELECT invoice_id, invoice_no, booking_id, customer_name, issued_at, status,
           subtotal, tax_amount, total, paid_total, balance_due
    FROM v_invoice_summary
    WHERE (:status = '' OR status = :status)
      AND (:unpaid = FALSE OR balance_due > 0)
      AND (:q = '' OR invoice_no ILIKE :like OR customer_name ILIKE :like
           OR (:qid <> 0 AND booking_id = :qid))
      AND (CAST(:issued_from AS date) IS NULL OR issued_at::date >= :issued_from)
      AND (CAST(:issued_to AS date) IS NULL OR issued_at::date <= :issued_to)
      AND (CAST(:min_total AS numeric) IS NULL OR total >= :min_total)
      AND (CAST(:max_total AS numeric) IS NULL OR total <= :max_total)
      AND (:invoice_no = '' OR invoice_no ILIKE :invoice_no_like)
      AND (:booking_ref = 0 OR booking_id = :booking_ref)
      AND (:guest = '' OR customer_name ILIKE :guest_like)
      AND (:balance = '' OR (:balance = 'outstanding' AND balance_due > 0)
           OR (:balance = 'settled' AND balance_due <= 0))
    ORDER BY issued_at DESC
    LIMIT :limit OFFSET :offset
    """
)
_COUNT_SQL = text(
    """
    SELECT COUNT(*) FROM v_invoice_summary
    WHERE (:status = '' OR status = :status)
      AND (:unpaid = FALSE OR balance_due > 0)
      AND (:q = '' OR invoice_no ILIKE :like OR customer_name ILIKE :like
           OR (:qid <> 0 AND booking_id = :qid))
      AND (CAST(:issued_from AS date) IS NULL OR issued_at::date >= :issued_from)
      AND (CAST(:issued_to AS date) IS NULL OR issued_at::date <= :issued_to)
      AND (CAST(:min_total AS numeric) IS NULL OR total >= :min_total)
      AND (CAST(:max_total AS numeric) IS NULL OR total <= :max_total)
      AND (:invoice_no = '' OR invoice_no ILIKE :invoice_no_like)
      AND (:booking_ref = 0 OR booking_id = :booking_ref)
      AND (:guest = '' OR customer_name ILIKE :guest_like)
      AND (:balance = '' OR (:balance = 'outstanding' AND balance_due > 0)
           OR (:balance = 'settled' AND balance_due <= 0))
    """
)
_STATS_SQL = text(
    """
    SELECT
        COALESCE(SUM(balance_due) FILTER (WHERE status <> 'void'), 0) AS outstanding,
        COUNT(*) FILTER (WHERE status = 'issued')                     AS issued,
        COUNT(*) FILTER (WHERE status = 'paid')                       AS paid,
        COUNT(*) FILTER (WHERE status = 'void')                       AS void,
        COUNT(*) FILTER (WHERE status = 'draft')                      AS draft
    FROM v_invoice_summary
    """
)


class InvoiceLedgerStats(BaseModel):
    """Whole-ledger tallies for the accounting header - the outstanding total is
    every unpaid balance, not just the rows on the current page."""

    outstanding: Decimal
    issued: int
    paid: int
    void: int
    draft: int


def _invoice_filter_params(
    status: str | None,
    unpaid_only: bool,
    q: str,
    issued_from: date | None,
    issued_to: date | None,
    min_total: Decimal | None,
    max_total: Decimal | None,
    invoice_no: str = "",
    booking_ref: str = "",
    guest: str = "",
    balance: str = "",
) -> dict[str, object]:
    term = q.strip()
    digits = term.removeprefix("TIG-").removeprefix("tig-").lstrip("0")
    ref = booking_ref.strip().upper().removeprefix("TIG-").lstrip("0")
    return {
        # one filter per column of the ledger; a booking ref that is not a
        # number matches nothing (-1), an empty one is "any" (0)
        "invoice_no": invoice_no.strip(),
        "invoice_no_like": f"%{invoice_no.strip()}%",
        "booking_ref": (int(ref) if ref.isdigit() else -1) if booking_ref.strip() else 0,
        "guest": guest.strip(),
        "guest_like": f"%{guest.strip()}%",
        "balance": balance,
        "status": status or "",
        "unpaid": unpaid_only,
        "q": term,
        "like": f"%{term}%",
        "qid": int(digits) if digits.isdigit() else 0,
        "issued_from": issued_from,
        "issued_to": issued_to,
        "min_total": min_total,
        "max_total": max_total,
    }


@router.get("/invoices", response_model=Page[InvoiceRow])
async def list_invoices(
    db: DbSession,
    _: RequireAccounting,
    page: PageParams,
    status: Annotated[str | None, Query(pattern=r"^(draft|issued|paid|void)$")] = None,
    unpaid_only: Annotated[bool, Query()] = False,
    q: Annotated[str, Query(max_length=80, description="invoice no, guest or booking ref")] = "",
    issued_from: Annotated[
        date | None, Query(description="only invoices issued on/after this date")
    ] = None,
    issued_to: Annotated[
        date | None, Query(description="only invoices issued on/before this date")
    ] = None,
    min_total: Annotated[
        Decimal | None, Query(ge=0, description="only invoices totalling at least this")
    ] = None,
    max_total: Annotated[
        Decimal | None, Query(ge=0, description="only invoices totalling at most this")
    ] = None,
    invoice_no: Annotated[str, Query(max_length=30, description="invoice no, partial")] = "",
    booking_ref: Annotated[str, Query(max_length=20, description="TIG-00042 or 42")] = "",
    guest: Annotated[str, Query(max_length=80, description="guest name, partial")] = "",
    balance: Annotated[str, Query(pattern=r"^(|outstanding|settled)$")] = "",
) -> Page[InvoiceRow]:
    params = _invoice_filter_params(
        status,
        unpaid_only,
        q,
        issued_from,
        issued_to,
        min_total,
        max_total,
        invoice_no=invoice_no,
        booking_ref=booking_ref,
        guest=guest,
        balance=balance,
    )
    total = await db.scalar(_COUNT_SQL, params) or 0
    result = await db.execute(_LIST_SQL, {**params, "limit": page.limit, "offset": page.offset})
    rows = result.mappings().all()
    return Page(
        items=[InvoiceRow(**row) for row in rows],
        total=total,
        limit=page.limit,
        offset=page.offset,
    )


@router.get("/invoices/stats", response_model=InvoiceLedgerStats)
async def invoice_stats(db: DbSession, _: RequireAccounting) -> dict[str, object]:
    row = (await db.execute(_STATS_SQL)).one()
    return dict(row._mapping)


async def _authorise(db: DbSession, user: CurrentUser, invoice: Invoice) -> None:
    """Guests see only their own invoice; staff see all."""
    if user.role != "customer":
        return
    booking = await db.get(Booking, invoice.booking_id)
    if booking is None or booking.customer_id != user.customer_id:
        # don't confirm that someone else's invoice exists
        raise NotFoundError("invoice not found")


@router.get("/invoices/{invoice_id}", response_model=InvoiceOut)
async def get_invoice(invoice_id: int, db: DbSession, user: CurrentUser) -> Invoice:
    invoice = await ops_service.get_invoice(db, invoice_id)
    await _authorise(db, user, invoice)
    return invoice


@router.get("/bookings/{booking_id}/invoice", response_model=InvoiceOut)
async def get_booking_invoice(booking_id: int, db: DbSession, user: CurrentUser) -> Invoice:
    invoice = await ops_service.invoice_for_booking(db, booking_id)
    await _authorise(db, user, invoice)
    return invoice


@router.post("/bookings/{booking_id}/invoice", response_model=InvoiceOut, status_code=201)
async def issue_invoice(
    booking_id: int, body: InvoiceIssueIn, db: DbSession, user: RequireStaff
) -> Invoice:
    invoice = await ops_service.issue_invoice(
        db, booking_id=booking_id, staff_id=user.staff_id, data=body
    )
    await ops_service.write_audit(
        db,
        actor_user_id=user.user_id,
        actor_label=user.username,
        action="invoice.issue",
        entity_type="invoice",
        entity_id=str(invoice.invoice_id),
        summary=f"{invoice.invoice_no} · booking #{booking_id}",
        data={"total": str(invoice.total)},
    )
    return invoice


@router.post("/invoices/{invoice_id}/void", response_model=InvoiceOut)
async def void_invoice(invoice_id: int, db: DbSession, user: RequireAccounting) -> Invoice:
    if user.staff_id is None:
        raise ForbiddenError("this account is not linked to a staff record")
    invoice = await ops_service.void_invoice(db, invoice_id)
    await ops_service.write_audit(
        db,
        actor_user_id=user.user_id,
        actor_label=user.username,
        action="invoice.void",
        entity_type="invoice",
        entity_id=str(invoice_id),
        summary=f"voided {invoice.invoice_no}",
    )
    return invoice
