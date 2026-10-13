"""Test fixtures. Requires a local PostgreSQL; builds a throwaway `roombooking_test` DB
from ../../03-database/{schema,seed}.sql via psql, then serves the app in-process.

Override the target with env TEST_DATABASE_URL
(default: postgresql+psycopg://localhost:5432/roombooking_test).
"""

from __future__ import annotations

import os
import pathlib
import subprocess
from collections.abc import AsyncIterator, Iterator

import pytest
from sqlalchemy import text

_TEST_DB_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+psycopg://localhost:5432/roombooking_test"
)

# ---- env MUST be set before any `app.*` import (get_settings is cached at import) ----
os.environ["DATABASE_URL"] = _TEST_DB_URL
os.environ.setdefault("JWT_SECRET", "test-secret-" + "x" * 40)
os.environ.setdefault("CORS_ORIGINS", "http://localhost:5173")
os.environ.setdefault("ENVIRONMENT", "local")
os.environ.setdefault("AUTH_RATE_LIMIT", "1000/minute")  # don't let rate-limit mask lockout tests

_SQL_DIR = pathlib.Path(__file__).resolve().parents[2] / "03-database"
_PSQL_URL = _TEST_DB_URL.replace("+psycopg", "")
_ADMIN_URL = _PSQL_URL.rsplit("/", 1)[0] + "/postgres"
_DB_NAME = _PSQL_URL.rsplit("/", 1)[1]

SEED_PASSWORD = "Passw0rd!2026"  # noqa: S105  - matches 03-database/seed.sql test accounts


@pytest.fixture
async def db() -> AsyncIterator[object]:
    """A raw async session, for tests that assert on schema objects (views,
    functions, triggers) rather than on the HTTP API."""
    from app.db.session import SessionLocal

    async with SessionLocal() as session:
        yield session


@pytest.fixture(autouse=True)
async def _reset_dirty_rooms() -> AsyncIterator[None]:
    """Checking a booking out fires `au_booking_checkout_housekeeping`, which
    marks the room 'cleaning' - correct in production (a dirty room is not
    sellable) but it would leak between tests that share one seeded database.
    Hand the rooms back clean after each test; the seeded 'maintenance' room is
    left alone."""
    yield
    from app.db.session import SessionLocal
    from sqlalchemy import text

    async with SessionLocal() as session:
        await session.execute(
            text("UPDATE room SET status = 'available' WHERE status = 'cleaning'")
        )
        await session.commit()


def _psql(url: str, *args: str) -> None:
    subprocess.run(
        ["psql", url, "-v", "ON_ERROR_STOP=1", "-q", *args],
        check=True,
        capture_output=True,
        text=True,
    )


@pytest.fixture(scope="session", autouse=True)
def _database() -> Iterator[None]:
    try:
        _psql(_ADMIN_URL, "-c", f'DROP DATABASE IF EXISTS "{_DB_NAME}" WITH (FORCE)')
        _psql(_ADMIN_URL, "-c", f'CREATE DATABASE "{_DB_NAME}"')
        _psql(_PSQL_URL, "-f", str(_SQL_DIR / "schema.sql"))
        _psql(_PSQL_URL, "-f", str(_SQL_DIR / "seed.sql"))
    except FileNotFoundError:  # psql not installed
        pytest.skip("psql not available on PATH", allow_module_level=True)
    except subprocess.CalledProcessError as exc:  # pragma: no cover
        raise RuntimeError(f"DB setup failed:\n{exc.stderr}") from exc

    yield

    _psql(_ADMIN_URL, "-c", f'DROP DATABASE IF EXISTS "{_DB_NAME}" WITH (FORCE)')


@pytest.fixture
async def client() -> AsyncIterator[object]:
    from app.main import app
    from httpx import ASGITransport, AsyncClient

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def login(client: object, username: str, password: str) -> str:
    resp = await client.post(  # type: ignore[attr-defined]
        "/api/v1/auth/login", json={"username": username, "password": password}
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# --- domain helpers (seed accounts, password = SEED_PASSWORD) ----------------
#   staff:  manager01 (manager) · recep01 / recep02 (receptionist)
#   guests: somchai=customer 1 · anna=customer 2 · malee=customer 3

_seq = iter(range(1000, 100000))


async def make_booking(
    client: object,
    staff_token: str,
    *,
    customer_id: int,
    room_id: int,
    days_ahead: int = 400,
    nights: int = 2,
    services: list[dict[str, int]] | None = None,
) -> dict[str, object]:
    """Create a booking on a far-future, per-call-unique date window."""
    from datetime import date, timedelta

    start = date.today() + timedelta(days=days_ahead + next(_seq))
    payload = {
        "customer_id": customer_id,
        "check_in_date": start.isoformat(),
        "check_out_date": (start + timedelta(days=nights)).isoformat(),
        "num_guests": 2,
        "rooms": [{"room_id": room_id}],
        "services": services or [],
    }
    resp = await client.post(  # type: ignore[attr-defined]
        "/api/v1/bookings", json=payload, headers=auth_header(staff_token)
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def settle(client: object, staff_token: str, booking_id: int) -> None:
    """Pay off whatever the booking still owes, at the desk (BR-30: a guest can
    only check out once the folio is settled)."""
    bill = await client.get(  # type: ignore[attr-defined]
        f"/api/v1/bookings/{booking_id}/bill", headers=auth_header(staff_token)
    )
    assert bill.status_code == 200, bill.text
    due = bill.json()["balance_due"]
    if float(due) > 0:
        paid = await client.post(  # type: ignore[attr-defined]
            f"/api/v1/bookings/{booking_id}/payments",
            json={"amount": due, "method": "cash"},
            headers=auth_header(staff_token),
        )
        assert paid.status_code == 201, paid.text


async def transition(client: object, staff_token: str, booking_id: int, action: str) -> int:
    """POST a status change. A check-out settles the balance first, as the front
    desk would - tests that need the unpaid refusal call the endpoint directly."""
    if action == "check-out":
        await settle(client, staff_token, booking_id)
    resp = await client.post(  # type: ignore[attr-defined]
        f"/api/v1/bookings/{booking_id}/{action}", headers=auth_header(staff_token)
    )
    return resp.status_code


# the new window: start = today + :off, end = start + :n nights (default: the
# booking's current length). Static SQL, all values bound.
_VACATE_SQL = text(
    """
    UPDATE booking o SET status = 'cancelled'
    WHERE o.booking_id <> :b
      AND o.status IN ('pending', 'confirmed', 'checked_in')
      AND EXISTS (SELECT 1 FROM booking_room x
                  JOIN booking_room y ON y.room_id = x.room_id
                  WHERE x.booking_id = :b AND y.booking_id = o.booking_id)
      AND o.check_in_date < CURRENT_DATE + :off + COALESCE(CAST(:n AS int),
            (SELECT check_out_date - check_in_date FROM booking WHERE booking_id = :b))
      AND CURRENT_DATE + :off < o.check_out_date
    """
)
_MOVE_SQL = text(
    """
    UPDATE booking
    SET check_out_date = CURRENT_DATE + :off
            + COALESCE(CAST(:n AS int), check_out_date - check_in_date),
        check_in_date = CURRENT_DATE + :off
    WHERE booking_id = :b
    """
)


async def move_stay(booking_id: int, start_offset: int, nights: int | None = None) -> None:
    """Slide a booking so it starts `start_offset` days from today (keeping its
    length unless `nights` is given). Test bookings share a handful of rooms, so
    any other live booking already holding those rooms on the new dates - one an
    earlier test left behind - is cancelled first; otherwise the BR-5 trigger on
    `booking` (correctly) refuses the move as a double booking."""
    from app.db.session import SessionLocal

    async with SessionLocal() as s:
        params = {"b": booking_id, "off": start_offset, "n": nights}
        await s.execute(_VACATE_SQL, params)
        await s.execute(_MOVE_SQL, params)
        await s.commit()


async def arrive_now(booking_id: int) -> None:
    """Slide a booking's window so the guest arrives today - check-in only opens
    on the arrival date, and `make_booking` deliberately uses far-future dates."""
    await move_stay(booking_id, 0)
