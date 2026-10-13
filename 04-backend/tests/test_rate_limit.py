"""The sign-in limiter stays tight while a session refresh - one per page load
or new tab - has its own, looser bucket, so opening a few tabs does not lock a
signed-in user out (and cannot be used to spend a password guesser's budget)."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Any, cast

import pytest
from app.core import rate_limit
from app.core.config import get_settings
from app.exceptions import RateLimitedError


def _req(ip: str) -> Any:
    return cast(Any, SimpleNamespace(client=SimpleNamespace(host=ip)))


def test_refresh_has_its_own_bucket(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "auth_rate_limit", "2/minute")
    monkeypatch.setattr(settings, "refresh_rate_limit", "10/minute")
    rate_limit.reset()
    try:
        # ten refreshes in a row are fine and leave the sign-in allowance alone
        for _ in range(10):
            asyncio.run(rate_limit.rate_limit_refresh(_req("10.0.0.7")))
        asyncio.run(rate_limit.rate_limit_auth(_req("10.0.0.7")))
        asyncio.run(rate_limit.rate_limit_auth(_req("10.0.0.7")))
        # ... which is still enforced: the third sign-in attempt is refused
        with pytest.raises(RateLimitedError):
            asyncio.run(rate_limit.rate_limit_auth(_req("10.0.0.7")))
        # and the refresh bucket has its own ceiling too
        with pytest.raises(RateLimitedError):
            asyncio.run(rate_limit.rate_limit_refresh(_req("10.0.0.7")))
        # another visitor is untouched
        asyncio.run(rate_limit.rate_limit_auth(_req("10.0.0.8")))
    finally:
        rate_limit.reset()
