"""Domain exceptions + handlers. Responses never leak internals (SECURITY.md 2.5)."""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.core.request_id import request_id_var

logger = logging.getLogger("app.error")


class AppError(Exception):
    status_code: int = status.HTTP_400_BAD_REQUEST
    code: str = "error"

    def __init__(self, detail: str, *, code: str | None = None) -> None:
        self.detail = detail
        if code:
            self.code = code
        super().__init__(detail)


class AuthError(AppError):
    status_code = status.HTTP_401_UNAUTHORIZED
    code = "unauthorized"


class ForbiddenError(AppError):
    status_code = status.HTTP_403_FORBIDDEN
    code = "forbidden"


class NotFoundError(AppError):
    status_code = status.HTTP_404_NOT_FOUND
    code = "not_found"


class ConflictError(AppError):
    status_code = status.HTTP_409_CONFLICT
    code = "conflict"


# SQLSTATE of a PL/pgSQL `RAISE EXCEPTION` with no explicit code. The only ones in
# 03-database/schema.sql are the BR-5 double-booking triggers
# (trg_check_room_overlap on booking_room, trg_check_booking_overlap on booking).
_PLPGSQL_RAISE = "P0001"
# deadlock / serialization failure: two requests raced for the same rooms and the
# database aborted one of them - nothing was written, the client can simply retry
_CONCURRENCY_ABORT = {"40P01", "40001"}


class RateLimitedError(AppError):
    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    code = "rate_limited"


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "detail": exc.detail,
                "code": exc.code,
                "request_id": request_id_var.get(),
            },
        )

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={
                "detail": "validation error",
                "code": "invalid_input",
                "errors": jsonable_encoder(exc.errors()),  # handles Decimal etc. in ctx
                "request_id": request_id_var.get(),
            },
        )

    @app.exception_handler(IntegrityError)
    async def _integrity(_: Request, exc: IntegrityError) -> JSONResponse:
        # DB constraint / trigger fired (e.g. double-booking trigger). Log detail, hide it.
        logger.warning("integrity_error", extra={"pgerror": str(getattr(exc, "orig", exc))})
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={
                "detail": "request conflicts with current data",
                "code": "conflict",
                "request_id": request_id_var.get(),
            },
        )

    @app.exception_handler(DBAPIError)
    async def _dbapi(request: Request, exc: DBAPIError) -> JSONResponse:
        # psycopg surfaces the BR-5 trigger's RAISE as a ProgrammingError, not an
        # IntegrityError - map it to the same 409 the service's pre-check gives
        if getattr(exc.orig, "sqlstate", None) == _PLPGSQL_RAISE:
            logger.warning("double_booking", extra={"pgerror": str(exc.orig)})
            return JSONResponse(
                status_code=status.HTTP_409_CONFLICT,
                content={
                    "detail": "room(s) already booked for those dates",
                    "code": "double_booking",
                    "request_id": request_id_var.get(),
                },
            )
        if getattr(exc.orig, "sqlstate", None) in _CONCURRENCY_ABORT:
            logger.warning("concurrency_abort", extra={"pgerror": str(exc.orig)})
            return JSONResponse(
                status_code=status.HTTP_409_CONFLICT,
                content={
                    "detail": "another booking for these rooms was saved at the same moment - "
                    "please try again",
                    "code": "retry",
                    "request_id": request_id_var.get(),
                },
            )
        return await _unhandled(request, exc)

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        logger.exception("unhandled_error", extra={"error_type": type(exc).__name__})
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "detail": "internal server error",
                "code": "internal_error",
                "request_id": request_id_var.get(),
            },
        )
