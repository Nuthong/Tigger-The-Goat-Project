"""Application configuration - loaded once from environment / .env (SECURITY.md 2.6)."""

from __future__ import annotations

from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- database ---
    database_url: str = Field(
        ...,
        description="SQLAlchemy async URL, e.g. postgresql+psycopg://app_rw:pw@host:5432/roombooking",
    )
    #: read-only reporting connection (role app_readonly, NFR-3); falls back to
    #: database_url when unset, e.g. in tests
    database_url_readonly: str | None = None

    # --- the hotel's own clock ---
    #: "today", arrival days and the free-cancellation deadline are all the
    #: hotel's local dates, not UTC ones (the database session uses it too)
    hotel_timezone: str = "Asia/Bangkok"

    # --- auth / jwt ---
    jwt_secret: str = Field(..., min_length=32)
    jwt_algorithm: str = "HS256"
    access_token_ttl_minutes: int = 15
    refresh_token_ttl_days: int = 7

    # --- account lockout ---
    max_failed_logins: int = 5
    lockout_minutes: int = 15

    # --- reservations ---
    #: how long an unpaid online booking holds its room before it's released
    hold_expiry_minutes: int = 30
    #: cancel more than this many hours before check-in for a full refund;
    #: later cancellations keep a one-night fee
    free_cancellation_hours: int = 48

    # --- rate limiting ---
    auth_rate_limit: str = "5/minute"
    # a refresh cannot guess a password (it needs a valid signed token), so it
    # only needs a flood guard - one per page load / tab
    refresh_rate_limit: str = "60/minute"

    # --- cors --- (comma-separated in env; NoDecode keeps pydantic from JSON-parsing it)
    cors_origins: Annotated[list[str], NoDecode] = Field(default_factory=list)

    # --- misc ---
    environment: Literal["local", "production"] = "local"
    log_level: str = "INFO"

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, v: object) -> object:
        if isinstance(v, str):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
