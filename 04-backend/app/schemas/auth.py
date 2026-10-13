"""Auth request/response schemas - 'In' schemas never accept role/id (SECURITY.md 2.3)."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class RegisterIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str = Field(min_length=3, max_length=50, pattern=r"^[A-Za-z0-9_.-]+$")
    email: EmailStr
    password: str = Field(min_length=10, max_length=128)
    first_name: str = Field(min_length=1, max_length=60)
    last_name: str = Field(min_length=1, max_length=60)
    phone: str | None = Field(default=None, max_length=20)


class LoginIn(BaseModel):
    # `username` accepts the account username, its email, or a guest's phone
    model_config = ConfigDict(extra="forbid")

    username: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=1, max_length=128)


class ChangePasswordIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=10, max_length=128)


class AccessTokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"  # noqa: S105  (OAuth token_type label, not a secret)
    expires_in: int  # seconds


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: int
    username: str
    email: str  # response only - internal/staff addrs (e.g. *.local) need not pass EmailStr
    role: str
    customer_id: int | None
    staff_id: int | None
    is_active: bool
    last_login_at: datetime | None


class MeOut(UserOut):
    """`/auth/me` - the account plus, for a guest, their editable profile."""

    first_name: str | None = None
    last_name: str | None = None
    phone: str | None = None


class ProfilePatch(BaseModel):
    """A guest editing their own contact details. Names stay non-empty; an
    explicit `phone: null` clears the number."""

    model_config = ConfigDict(extra="forbid")

    first_name: str | None = Field(default=None, min_length=1, max_length=60)
    last_name: str | None = Field(default=None, min_length=1, max_length=60)
    phone: str | None = Field(default=None, max_length=20)
