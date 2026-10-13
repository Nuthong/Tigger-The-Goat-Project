"""Small in-process fixed-window rate limiter, used as a FastAPI dependency.

Brute-force protection for /auth routes (SECURITY.md 2.1). Per-IP, in-memory -
fine for a single instance / this project. For multi-instance prod, back it with Redis.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import Request

from app.core.config import get_settings
from app.exceptions import RateLimitedError

_UNITS = {"second": 1, "sec": 1, "s": 1, "minute": 60, "min": 60, "m": 60, "hour": 3600, "h": 3600}

_hits: dict[str, deque[float]] = defaultdict(deque)


def _parse_spec(spec: str) -> tuple[int, int]:
    count_str, _, unit_str = spec.partition("/")
    unit = _UNITS.get(unit_str.strip().lower().rstrip("s") or "minute", 60)
    return int(count_str.strip()), unit


def _client_key(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _hit(key: str, spec: str) -> None:
    limit, window = _parse_spec(spec)
    now = time.monotonic()
    bucket = _hits[key]
    while bucket and bucket[0] <= now - window:
        bucket.popleft()
    if len(bucket) >= limit:
        raise RateLimitedError("too many attempts - please wait and try again")
    bucket.append(now)


async def rate_limit_auth(request: Request) -> None:
    """Sign-in, sign-up, password change: tight, it is what a password guesser hits."""
    _hit(_client_key(request), get_settings().auth_rate_limit)


async def rate_limit_refresh(request: Request) -> None:
    """Session refresh has its own, looser bucket. Every page load or new tab
    refreshes the session once - sharing the sign-in limit meant opening a
    handful of tabs (a few printed invoices) in a minute signed staff out."""
    _hit(f"refresh:{_client_key(request)}", get_settings().refresh_rate_limit)


def reset() -> None:
    """Test helper - clear all buckets."""
    _hits.clear()
