"""Security response headers (SECURITY.md 2.4)."""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.core.request_id import new_request_id, request_id_var

_STATIC_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Content-Security-Policy": (
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; "
        "connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'"
    ),
}


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: object, *, hsts: bool = False) -> None:
        super().__init__(app)  # type: ignore[arg-type]
        self._hsts = hsts

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        response = await call_next(request)
        for key, value in _STATIC_HEADERS.items():
            response.headers.setdefault(key, value)
        if self._hsts:
            response.headers.setdefault(
                "Strict-Transport-Security", "max-age=63072000; includeSubDomains"
            )
        # uvicorn adds its own `Server:` header below this layer - run it with
        # --no-server-header to drop it; this catches any upstream proxy value.
        if "server" in response.headers:
            del response.headers["server"]
        return response


class RequestIDMiddleware(BaseHTTPMiddleware):
    """Mints a server-side request ID per request - never trusts a client-supplied one,
    since it flows straight into structured logs (SECURITY.md 2.5: no untrusted input in logs)."""

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        token = request_id_var.set(new_request_id())
        try:
            response = await call_next(request)
            response.headers["X-Request-ID"] = request_id_var.get() or ""
            return response
        finally:
            request_id_var.reset(token)
