"""Async engine + session factory + FastAPI dependency."""

from __future__ import annotations

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import get_settings

_settings = get_settings()

# every session runs in the hotel's time zone, so CURRENT_DATE and ::date casts
# in SQL agree with app.core.clock.today()
_connect_args = {"options": f"-c timezone={_settings.hotel_timezone}"}

engine: AsyncEngine = create_async_engine(
    _settings.database_url,
    echo=False,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
    connect_args=_connect_args,
)

SessionLocal = async_sessionmaker(
    bind=engine,
    expire_on_commit=False,
    autoflush=False,
)

# reports read through the app_readonly role (NFR-3): they can never write, even
# by mistake. Without a separate URL (tests, dev) they share the main engine.
readonly_engine: AsyncEngine = (
    create_async_engine(
        _settings.database_url_readonly,
        echo=False,
        pool_pre_ping=True,
        pool_size=3,
        max_overflow=5,
        connect_args=_connect_args,
    )
    if _settings.database_url_readonly
    else engine
)

ReadonlySessionLocal = async_sessionmaker(
    bind=readonly_engine,
    expire_on_commit=False,
    autoflush=False,
)


async def get_db() -> AsyncGenerator[AsyncSession]:
    """Yield a session; commit on success, rollback on error, always close."""
    async with SessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def get_readonly_db() -> AsyncGenerator[AsyncSession]:
    """A session on the read-only reporting role. Never commits - there is
    nothing to commit, and app_readonly could not write anyway."""
    async with ReadonlySessionLocal() as session:
        try:
            yield session
        finally:
            await session.rollback()
