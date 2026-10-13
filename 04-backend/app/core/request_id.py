"""Per-request correlation ID, shared by the middleware, logger and error handlers."""

from __future__ import annotations

import uuid
from contextvars import ContextVar

request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)


def new_request_id() -> str:
    return uuid.uuid4().hex
