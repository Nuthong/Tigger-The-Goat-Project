"""BR-5 under concurrency. The overlap trigger alone suffers write skew at
READ COMMITTED: two transactions each insert a `booking_room` row for the same
room, neither trigger sees the other's uncommitted row, and both commit. The
service locks the room rows (`SELECT ... FOR UPDATE`) before its overlap check,
so the second writer waits for the first and is then rejected.

Each test holds transaction A open after its write, starts B in a second
session, and only commits A once B is provably parked on the room lock."""

from __future__ import annotations

import asyncio
from datetime import date, timedelta
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from tests.conftest import SEED_PASSWORD, auth_header, login, make_booking

ROOM = 9
_STAFF_ID_SQL = text("SELECT staff_id FROM staff WHERE role = 'receptionist' ORDER BY staff_id")
_ACTIVE_SQL = text(
    "SELECT COUNT(DISTINCT b.booking_id) FROM booking b "
    "JOIN booking_room br ON br.booking_id = b.booking_id "
    "WHERE br.room_id = :room AND b.status IN ('pending', 'confirmed', 'checked_in') "
    "AND b.check_in_date < :co AND :ci < b.check_out_date"
)


def _payload(customer_id: int, check_in: date, nights: int) -> Any:
    from app.schemas.booking import BookingCreateIn

    return BookingCreateIn.model_validate(
        {
            "customer_id": customer_id,
            "check_in_date": check_in.isoformat(),
            "check_out_date": (check_in + timedelta(days=nights)).isoformat(),
            "num_guests": 1,
            "rooms": [{"room_id": ROOM}],
        }
    )


async def _race(first: Any, second: Any) -> tuple[bool, bool]:
    """Run `first(session)` and leave its transaction open, start
    `second(session)` in another session, then commit the first. Returns
    whether each committed."""
    from app.db.session import SessionLocal
    from app.exceptions import ConflictError

    async def attempt(op: Any, session: Any) -> bool:
        try:
            await op(session)
            await session.commit()
        except (ConflictError, DBAPIError):
            await session.rollback()
            return False
        return True

    async with SessionLocal() as a, SessionLocal() as b:
        await first(a)  # row written, lock held, not committed
        task_b = asyncio.create_task(attempt(second, b))
        await asyncio.sleep(0.5)
        # B cannot have finished: it must be waiting on A's room lock
        assert not task_b.done(), "second writer did not wait for the first"
        await a.commit()
        return True, await asyncio.wait_for(task_b, timeout=10)


async def _active_on(check_in: date, check_out: date) -> int:
    from app.db.session import SessionLocal

    async with SessionLocal() as s:
        return int(
            await s.scalar(_ACTIVE_SQL, {"room": ROOM, "ci": check_in, "co": check_out}) or 0
        )


async def test_concurrent_bookings_for_one_room_only_one_wins() -> None:
    from app.db.session import SessionLocal
    from app.services import booking_service

    async with SessionLocal() as s:
        staff_id = int(await s.scalar(_STAFF_ID_SQL) or 0)
    check_in = date.today() + timedelta(days=3000)

    async def book(customer_id: int, nights: int) -> Any:
        async def op(session: Any) -> None:
            await booking_service.create_booking(
                session,
                customer_id=customer_id,
                staff_id=staff_id,
                data=_payload(customer_id, check_in, nights),
            )

        return op

    # overlapping, not identical, windows: 3 nights vs 2 nights from the same day
    results = await _race(await book(2, 3), await book(3, 2))

    assert results == (True, False)
    assert await _active_on(check_in, check_in + timedelta(days=3)) == 1


async def test_concurrent_reschedule_into_a_new_booking_only_one_wins(client: object) -> None:
    from app.db.session import SessionLocal
    from app.services import booking_service

    staff = await login(client, "recep01", SEED_PASSWORD)
    moving = await make_booking(client, staff, customer_id=2, room_id=ROOM, days_ahead=3100)
    async with SessionLocal() as s:
        staff_id = int(await s.scalar(_STAFF_ID_SQL) or 0)
    target = date.fromisoformat(str(moving["check_out_date"])) + timedelta(days=30)

    async def new_booking(session: Any) -> None:
        await booking_service.create_booking(
            session, customer_id=3, staff_id=staff_id, data=_payload(3, target, 2)
        )

    async def reschedule(session: Any) -> None:
        await booking_service.reschedule_booking(
            session,
            int(str(moving["booking_id"])),
            check_in=target + timedelta(days=1),
            check_out=target + timedelta(days=3),
        )

    results = await _race(new_booking, reschedule)

    assert results == (True, False)
    assert await _active_on(target, target + timedelta(days=3)) == 1
    # the loser kept its original dates
    kept = await client.get(  # type: ignore[attr-defined]
        f"/api/v1/bookings/{moving['booking_id']}", headers=auth_header(staff)
    )
    assert kept.json()["check_in_date"] == moving["check_in_date"]


async def test_trigger_rejection_maps_to_409(
    client: object, monkeypatch: pytest.MonkeyPatch
) -> None:
    """If the app's own pre-check is ever bypassed, the BR-5 trigger still
    stops the insert - and the API answers 409, not 500."""
    from app.services import booking_service

    staff = await login(client, "recep01", SEED_PASSWORD)
    b = await make_booking(client, staff, customer_id=2, room_id=ROOM, days_ahead=3200)

    async def _no_clashes(*_: object, **__: object) -> set[int]:
        return set()

    monkeypatch.setattr(booking_service, "_overlapping_room_ids", _no_clashes)
    clash = await client.post(  # type: ignore[attr-defined]
        "/api/v1/bookings",
        json={
            "customer_id": 3,
            "check_in_date": b["check_in_date"],
            "check_out_date": b["check_out_date"],
            "rooms": [{"room_id": ROOM}],
        },
        headers=auth_header(staff),
    )
    assert clash.status_code == 409, clash.text
    assert clash.json()["code"] == "double_booking"
