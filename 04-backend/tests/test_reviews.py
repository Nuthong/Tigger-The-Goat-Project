"""Module 7 - Reviews: guest-only, after check-out, one per booking."""

from __future__ import annotations

from decimal import Decimal

from tests.conftest import (
    SEED_PASSWORD,
    arrive_now,
    auth_header,
    login,
    make_booking,
    transition,
)


async def _checked_out_booking_for_customer_1(client: object, staff: str) -> int:
    b = await make_booking(client, staff, customer_id=1, room_id=1, days_ahead=4000)
    bid = b["booking_id"]
    await arrive_now(bid)
    assert await transition(client, staff, bid, "check-in") == 200
    assert await transition(client, staff, bid, "check-out") == 200
    return bid


async def test_guest_reviews_after_checkout(client: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    bid = await _checked_out_booking_for_customer_1(client, staff)

    somchai = await login(client, "somchai", SEED_PASSWORD)
    resp = await client.post(  # type: ignore[attr-defined]
        f"/api/v1/bookings/{bid}/review",
        json={"rating": 5, "comment": "great stay"},
        headers=auth_header(somchai),
    )
    assert resp.status_code == 201

    # second review on the same booking -> 409
    dup = await client.post(  # type: ignore[attr-defined]
        f"/api/v1/bookings/{bid}/review",
        json={"rating": 4},
        headers=auth_header(somchai),
    )
    assert dup.status_code == 409


async def test_cannot_review_before_checkout(client: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    b = await make_booking(client, staff, customer_id=1, room_id=2, days_ahead=4100)
    somchai = await login(client, "somchai", SEED_PASSWORD)
    resp = await client.post(  # type: ignore[attr-defined]
        f"/api/v1/bookings/{b['booking_id']}/review",
        json={"rating": 5},
        headers=auth_header(somchai),
    )
    assert resp.status_code == 409


async def test_staff_cannot_review(client: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    bid = await _checked_out_booking_for_customer_1(client, staff)
    resp = await client.post(  # type: ignore[attr-defined]
        f"/api/v1/bookings/{bid}/review", json={"rating": 5}, headers=auth_header(staff)
    )
    assert resp.status_code in (403, 404)  # staff has no customer scope


async def test_rating_out_of_range_is_422(client: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    bid = await _checked_out_booking_for_customer_1(client, staff)
    somchai = await login(client, "somchai", SEED_PASSWORD)
    resp = await client.post(  # type: ignore[attr-defined]
        f"/api/v1/bookings/{bid}/review", json={"rating": 9}, headers=auth_header(somchai)
    )
    assert resp.status_code == 422


async def test_get_review_returns_it_or_404(client: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    # seed booking 1 carries a review
    got = await client.get(  # type: ignore[attr-defined]
        "/api/v1/bookings/1/review", headers=auth_header(staff)
    )
    assert got.status_code == 200 and got.json()["rating"] == 5

    # a fresh booking has none
    b = await make_booking(client, staff, customer_id=1, room_id=3, days_ahead=4200)
    none = await client.get(  # type: ignore[attr-defined]
        f"/api/v1/bookings/{b['booking_id']}/review", headers=auth_header(staff)
    )
    assert none.status_code == 404


async def test_room_type_review_feed_is_public(client: object) -> None:
    resp = await client.get("/api/v1/room-types/1/reviews")  # type: ignore[attr-defined]
    assert resp.status_code == 200
    body = resp.json()
    assert body["count"] >= 1
    assert set(body["distribution"].keys()) == {"1", "2", "3", "4", "5"}
    assert isinstance(body["items"], list)
    if body["items"]:
        assert {"rating", "comment", "guest_name", "created_at"} <= body["items"][0].keys()


async def test_admin_review_board_paginates_and_stats_cover_the_whole_set(client: object) -> None:
    """The feedback board is a page envelope; `/reviews/stats` is over every
    review, and a star filter narrows both the page and its total."""
    staff = await login(client, "recep01", SEED_PASSWORD)

    page = await client.get(  # type: ignore[attr-defined]
        "/api/v1/admin/reviews?limit=5", headers=auth_header(staff)
    )
    assert page.status_code == 200
    body = page.json()
    assert set(body) == {"items", "total", "limit", "offset"}
    assert body["total"] >= 1
    assert len(body["items"]) == min(5, body["total"])

    # a second page does not repeat the first
    p2 = await client.get(  # type: ignore[attr-defined]
        "/api/v1/admin/reviews?limit=5&offset=5", headers=auth_header(staff)
    )
    ids1 = {r["review_id"] for r in body["items"]}
    assert ids1.isdisjoint({r["review_id"] for r in p2.json()["items"]})

    stats = await client.get(  # type: ignore[attr-defined]
        "/api/v1/admin/reviews/stats", headers=auth_header(staff)
    )
    assert stats.status_code == 200
    s = stats.json()
    assert set(s) == {"count", "average", "r5", "r4", "r3", "r2", "r1"}
    assert s["r5"] + s["r4"] + s["r3"] + s["r2"] + s["r1"] == s["count"] == body["total"]
    assert Decimal("1") <= Decimal(s["average"]) <= Decimal("5")

    # filtering to 5-star: every row is 5 and the total matches the stats bucket
    five = await client.get(  # type: ignore[attr-defined]
        "/api/v1/admin/reviews?rating=5&limit=5", headers=auth_header(staff)
    )
    fb = five.json()
    assert fb["total"] == s["r5"]
    assert all(r["rating"] == 5 for r in fb["items"])

    # a guest cannot open the staff feedback board
    somchai = await login(client, "somchai", SEED_PASSWORD)
    denied = await client.get(  # type: ignore[attr-defined]
        "/api/v1/admin/reviews", headers=auth_header(somchai)
    )
    assert denied.status_code == 403
