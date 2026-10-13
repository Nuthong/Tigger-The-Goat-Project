"""Declarative base. Models mirror 03-database/schema.sql (DB-first: that file is authoritative)."""

from __future__ import annotations

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass
