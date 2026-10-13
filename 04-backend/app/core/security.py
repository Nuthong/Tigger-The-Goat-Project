"""Password hashing (bcrypt) + JWT encode/decode (SECURITY.md 2.1)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

import bcrypt
import jwt

from app.core.config import get_settings

# --- password hashing -------------------------------------------------------

_BCRYPT_ROUNDS = 12


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt(rounds=_BCRYPT_ROUNDS)).decode()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except ValueError:
        return False


# --- JWT ------------------------------------------------------------------

TokenType = Literal["access", "refresh"]


def _now() -> datetime:
    return datetime.now(UTC)


def create_token(
    *,
    subject: int,
    role: str,
    token_type: TokenType,
    token_version: int,
) -> tuple[str, str]:
    """Return (encoded_jwt, jti)."""
    settings = get_settings()
    jti = uuid.uuid4().hex
    if token_type == "access":  # noqa: S105  (token kind, not a secret)
        expires = _now() + timedelta(minutes=settings.access_token_ttl_minutes)
    else:
        expires = _now() + timedelta(days=settings.refresh_token_ttl_days)
    payload: dict[str, Any] = {
        "sub": str(subject),
        "role": role,
        "type": token_type,
        "tv": token_version,
        "jti": jti,
        "iat": int(_now().timestamp()),
        "exp": int(expires.timestamp()),
    }
    encoded = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return encoded, jti


def decode_token(token: str, *, expected_type: TokenType) -> dict[str, Any]:
    """Raise jwt.InvalidTokenError on any problem (expired, wrong sig, wrong type)."""
    settings = get_settings()
    payload: dict[str, Any] = jwt.decode(
        token,
        settings.jwt_secret,
        algorithms=[settings.jwt_algorithm],
        options={"require": ["exp", "sub", "type", "jti"]},
    )
    if payload.get("type") != expected_type:
        raise jwt.InvalidTokenError("unexpected token type")
    return payload
