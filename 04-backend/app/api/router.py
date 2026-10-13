"""Aggregate router for API v1."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.v1 import (
    admin,
    auth,
    bookings,
    customers,
    housekeeping,
    invoices,
    maintenance,
    rate_plans,
    reports,
    rooms,
    services,
)

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth.router)
api_router.include_router(rooms.router)
api_router.include_router(services.router)
api_router.include_router(bookings.router)
api_router.include_router(customers.router)
api_router.include_router(reports.router)
api_router.include_router(rate_plans.router)
api_router.include_router(invoices.router)
api_router.include_router(housekeeping.router)
api_router.include_router(maintenance.router)
api_router.include_router(admin.router)
