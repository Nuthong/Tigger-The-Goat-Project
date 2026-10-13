"""Shared response schemas."""

from __future__ import annotations

from typing import Generic, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    limit: int
    offset: int


class Message(BaseModel):
    detail: str


class ErrorResponse(BaseModel):
    detail: str
    code: str = Field(default="error")
