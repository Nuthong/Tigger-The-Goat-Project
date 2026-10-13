"""FastAPI application factory."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app import __version__
from app.api.router import api_router
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.core.middleware import RequestIDMiddleware, SecurityHeadersMiddleware
from app.db.session import engine
from app.exceptions import register_exception_handlers


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    yield
    await engine.dispose()


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)

    app = FastAPI(
        title="Room Booking System API",
        version=__version__,
        summary="310-2209 Database Systems - Mini-DB Project",
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url=None,
    )

    # CORS - explicit allowlist, credentials enabled for the refresh cookie
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
        max_age=600,
    )
    app.add_middleware(SecurityHeadersMiddleware, hsts=settings.is_production)
    # added last so it's outermost: sees every request first (sets the ID before CORS/
    # security-headers/router run) and touches every response last (header always present)
    app.add_middleware(RequestIDMiddleware)

    register_exception_handlers(app)
    app.include_router(api_router)

    @app.get("/health", tags=["health"])
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/health/ready", tags=["health"])
    async def ready() -> dict[str, str]:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return {"status": "ready"}

    return app


app = create_app()
