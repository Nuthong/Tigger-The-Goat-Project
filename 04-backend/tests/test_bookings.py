"""Module 4 - Booking creation & retrieval (price snapshot, ownership scoping, validation)."""

from __future__ import annotations

from datetime import date, timedelta

from tests.conftest import SEED_PASSWORD, auth_header, login, make_booking

WIN = {
    "check_in_date": (date.today() + timedelta(days=1500)).isoformat(),
    "check_out_date": (date.today() + timedelta(days=1502)).isoformat(),
}


async def test_staff_creates_booking_with_price_snapshot(client: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    booking = await make_booking(client, staff, customer_id=4, room_id=1, nights=2)
    assert booking["status"] == "confirmed"
    assert booking["rooms"][0]["price_per_night"] == "900.00"  # Cityview Room base price (type 1)

    bill = await client.get(  # type: ignore[attr-defined]
        f"/api/v1/bookings/{booking['booking_id']}/bill", headers=auth_header(staff)
    )
    assert bill.status_code == 200
    assert bill.json()["room_total"] == "1800.00"  # 900 * 2 nights
    assert bill.json()["balance_due"] == "1800.00"


async def test_booking_carries_human_labels(client: object) -> None:
    """The UI must never have to render a bare id - a booking names its guest,
    its rooms and its extras."""
    staff = await login(client, "recep01", SEED_PASSWORD)
    booking = await make_booking(
        client,
        staff,
        customer_id=4,
        room_id=1,
        nights=1,
        days_ahead=2900,
        services=[{"service_id": 1, "quantity": 1}],
    )
    assert booking["customer_name"] == "John Carter"  # seed customer #4
    assert booking["rooms"][0]["room_number"] == "101"
    assert booking["rooms"][0]["room_type"] == "Cityview Room"
    assert booking["services"][0]["service_name"]

    # the same labels survive a re-read and a listing
    got = await client.get(  # type: ignore[attr-defined]
        f"/api/v1/bookings/{booking['booking_id']}", headers=auth_header(staff)
    )
    assert got.json()["rooms"][0]["room_number"] == "101"
    listing = await client.get("/api/v1/bookings", headers=auth_header(staff))  # type: ignore[attr-defined]
    assert all(b["customer_name"] for b in listing.json()["items"])


async def test_booking_with_services_sums_into_bill(client: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    booking = await make_booking(
        client,
        staff,
        customer_id=5,
        room_id=2,
        nights=1,
        services=[{"service_id": 1, "quantity": 2}],  # Breakfast @ 250
    )
    bill = await client.get(  # type: ignore[attr-defined]
        f"/api/v1/bookings/{booking['booking_id']}/bill", headers=auth_header(staff)
    )
    assert bill.json()["service_total"] == "500.00"
    assert bill.json()["grand_total"] == "1400.00"  # 900 + 500


async def test_booking_row_carries_its_payment_standing(client: object) -> None:
    """The list/detail payload exposes balance_due so a client can flag
    'payment due' without a bill round-trip per row."""
    staff = await login(client, "recep01", SEED_PASSWORD)
    booking = await make_booking(client, staff, customer_id=1, room_id=1, nights=2, days_ahead=4100)
    bid = booking["booking_id"]
    assert booking["grand_total"] == "1800.00"
    assert booking["amount_paid"] == "0.00"
    assert booking["balance_due"] == "1800.00"

    somchai = await login(client, "somchai", SEED_PASSWORD)  # owns customer 1
    await client.post(  # type: ignore[attr-defined]
        f"/api/v1/bookings/{bid}/pay", json={"method": "credit_card"}, headers=auth_header(somchai)
    )

    row = next(
        b
        for b in (
            await client.get("/api/v1/bookings", headers=auth_header(somchai))  # type: ignore[attr-defined]
        ).json()["items"]
        if b["booking_id"] == bid
    )
    assert row["amount_paid"] == "1800.00"
    assert row["balance_due"] == "0.00"


async def test_customer_books_for_self(client: object) -> None:
    token = await login(client, "somchai", SEED_PASSWORD)  # customer_id 1
    resp = await client.post(  # type: ignore[attr-defined]
        "/api/v1/bookings",
        json={
            "check_in_date": (date.today() + timedelta(days=1800)).isoformat(),
            "check_out_date": (date.today() + timedelta(days=1802)).isoformat(),
            "customer_id": 999,  # attempt to book for someone else -> ignored
            "rooms": [{"room_id": 12}],
        },
        headers=auth_header(token),
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["customer_id"] == 1  # forced to the caller
    # an online guest booking is only a hold until it's paid
    assert resp.json()["status"] == "pending"


async def test_book_by_room_type_auto_assigns(client: object) -> None:
    token = await login(client, "somchai", SEED_PASSWORD)
    resp = await client.post(  # type: ignore[attr-defined]
        "/api/v1/bookings",
        json={
            "check_in_date": (date.today() + timedelta(days=2600)).isoformat(),
            "check_out_date": (date.today() + timedelta(days=2603)).isoformat(),
            "num_guests": 2,
            "rooms": [{"room_type_id": 5}, {"room_type_id": 5}],  # 2 Oriental Suites, auto-assigned
        },
        headers=auth_header(token),
    )
    assert resp.status_code == 201, resp.text
    assigned = sorted(r["room_id"] for r in resp.json()["rooms"])
    assert len(assigned) == 2 and assigned[0] != assigned[1]


async def test_book_by_room_type_sold_out_is_409(client: object) -> None:
    token = await login(client, "somchai", SEED_PASSWORD)
    # a far-future window no other test touches; grab every Skyline Residence (8),
    # then a follow-up request for the same nights has nothing left -> sold_out
    win = {
        "check_in_date": (date.today() + timedelta(days=5000)).isoformat(),
        "check_out_date": (date.today() + timedelta(days=5003)).isoformat(),
    }
    grab = await client.post(  # type: ignore[attr-defined]
        "/api/v1/bookings",
        json={**win, "num_guests": 8, "rooms": [{"room_type_id": 4}] * 8},
        headers=auth_header(token),
    )
    assert grab.status_code == 201, grab.text

    resp = await client.post(  # type: ignore[attr-defined]
        "/api/v1/bookings",
        json={**win, "num_guests": 3, "rooms": [{"room_type_id": 4}] * 3},
        headers=auth_header(token),
    )
    assert resp.status_code == 409
    assert resp.json()["code"] == "sold_out"


async def test_booking_room_needs_exactly_one_selector(client: object) -> None:
    token = await login(client, "recep01", SEED_PASSWORD)
    resp = await client.post(  # type: ignore[attr-defined]
        "/api/v1/bookings",
        json={**WIN, "customer_id": 3, "rooms": [{"room_id": 1, "room_type_id": 1}]},
        headers=auth_header(token),
    )
    assert resp.status_code == 422


async def test_customer_still_cannot_check_in(client: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    b = await make_booking(client, staff, customer_id=1, room_id=6, days_ahead=1850)
    guest = await login(client, "somchai", SEED_PASSWORD)
    resp = await client.post(  # type: ignore[attr-defined]
        f"/api/v1/bookings/{b['booking_id']}/check-in", headers=auth_header(guest)
    )
    assert resp.status_code == 403


async def test_unknown_room_returns_404(client: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    resp = await client.post(  # type: ignore[attr-defined]
        "/api/v1/bookings",
        json={**WIN, "customer_id": 3, "rooms": [{"room_id": 9999}]},
        headers=auth_header(staff),
    )
    assert resp.status_code == 404


async def test_duplicate_room_in_payload_is_422(client: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    resp = await client.post(  # type: ignore[attr-defined]
        "/api/v1/bookings",
        json={**WIN, "customer_id": 3, "rooms": [{"room_id": 7}, {"room_id": 7}]},
        headers=auth_header(staff),
    )
    assert resp.status_code == 422


async def test_double_booking_is_rejected(client: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    b = await make_booking(client, staff, customer_id=2, room_id=8, days_ahead=1700, nights=4)

    overlap = {
        "customer_id": 3,
        "check_in_date": b["check_in_date"],
        "check_out_date": b["check_out_date"],
        "rooms": [{"room_id": 8}],
    }
    clash = await client.post(  # type: ignore[attr-defined]
        "/api/v1/bookings", json=overlap, headers=auth_header(staff)
    )
    assert clash.status_code == 409


async def test_customer_list_and_get_are_scoped(client: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    # a booking that belongs to customer 2 (anna), not customer 1 (somchai)
    other = await make_booking(client, staff, customer_id=2, room_id=3, days_ahead=2000)

    somchai = await login(client, "somchai", SEED_PASSWORD)
    listing = await client.get("/api/v1/bookings", headers=auth_header(somchai))  # type: ignore[attr-defined]
    assert listing.status_code == 200
    assert all(b["customer_id"] == 1 for b in listing.json()["items"])

    # cannot fetch someone else's booking - 404, not 403 (don't leak existence)
    peek = await client.get(  # type: ignore[attr-defined]
        f"/api/v1/bookings/{other['booking_id']}", headers=auth_header(somchai)
    )
    assert peek.status_code == 404


async def test_check_in_date_cannot_be_in_the_past(client: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    resp = await client.post(  # type: ignore[attr-defined]
        "/api/v1/bookings",
        json={
            "customer_id": 4,
            "check_in_date": (date.today() - timedelta(days=1)).isoformat(),
            "check_out_date": (date.today() + timedelta(days=2)).isoformat(),
            "rooms": [{"room_id": 1}],
        },
        headers=auth_header(staff),
    )
    assert resp.status_code == 422


async def test_guests_cannot_exceed_room_capacity(client: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    # room 1 is a Cityview Room - max_occupancy 2
    resp = await client.post(  # type: ignore[attr-defined]
        "/api/v1/bookings",
        json={**WIN, "customer_id": 4, "num_guests": 3, "rooms": [{"room_id": 1}]},
        headers=auth_header(staff),
    )
    assert resp.status_code == 409
    assert resp.json()["code"] == "over_capacity"


async def test_day_sheet_filters_by_arrival_and_departure_date(client: object) -> None:
    """The front-desk day sheet: `arriving_on` / `departing_on` narrow the list
    to one business date, and the count in the envelope follows the filter."""
    staff = await login(client, "recep01", SEED_PASSWORD)
    a = await make_booking(client, staff, customer_id=6, room_id=10, nights=3, days_ahead=6200)
    b = await make_booking(client, staff, customer_id=7, room_id=11, nights=2, days_ahead=6400)
    a_in, a_out = a["check_in_date"], a["check_out_date"]
    assert a_in != b["check_in_date"]

    arriving = await client.get(  # type: ignore[attr-defined]
        "/api/v1/bookings", params={"arriving_on": a_in}, headers=auth_header(staff)
    )
    assert arriving.status_code == 200
    body = arriving.json()
    ids = [row["booking_id"] for row in body["items"]]
    assert a["booking_id"] in ids and b["booking_id"] not in ids
    assert all(row["check_in_date"] == a_in for row in body["items"])
    assert body["total"] == len(body["items"])  # count matches the filtered set

    departing = await client.get(  # type: ignore[attr-defined]
        "/api/v1/bookings", params={"departing_on": a_out}, headers=auth_header(staff)
    )
    assert departing.status_code == 200
    assert a["booking_id"] in [row["booking_id"] for row in departing.json()["items"]]
    assert all(row["check_out_date"] == a_out for row in departing.json()["items"])


async def test_status_counts_aggregate_matches_the_listing_total(client: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    counts = await client.get(  # type: ignore[attr-defined]
        "/api/v1/bookings/status-counts", headers=auth_header(staff)
    )
    assert counts.status_code == 200
    body = counts.json()
    assert set(body) == {"pending", "confirmed", "checked_in", "checked_out", "cancelled"}
    total = sum(body.values())
    listing = await client.get(  # type: ignore[attr-defined]
        "/api/v1/bookings", params={"limit": 1}, headers=auth_header(staff)
    )
    assert total == listing.json()["total"]  # the whole book, not a page

    # a guest sees only their own tally
    somchai = await login(client, "somchai", SEED_PASSWORD)
    mine = await client.get(  # type: ignore[attr-defined]
        "/api/v1/bookings/status-counts", headers=auth_header(somchai)
    )
    my_total = sum(mine.json().values())
    my_list = await client.get(  # type: ignore[attr-defined]
        "/api/v1/bookings", params={"limit": 1}, headers=auth_header(somchai)
    )
    assert my_total == my_list.json()["total"] and my_total < total


async def test_stay_range_returns_only_overlapping_bookings(client: object) -> None:
    """`stay_from` / `stay_to` is the reservation tape's window query - a stay
    booked long ago for a future week must still come back."""
    staff = await login(client, "recep01", SEED_PASSWORD)
    made = await make_booking(client, staff, customer_id=6, room_id=13, days_ahead=6800, nights=3)
    bid = made["booking_id"]
    ci = date.fromisoformat(made["check_in_date"])

    inside = await client.get(  # type: ignore[attr-defined]
        "/api/v1/bookings",
        params={
            "stay_from": (ci + timedelta(days=1)).isoformat(),
            "stay_to": (ci + timedelta(days=2)).isoformat(),
        },
        headers=auth_header(staff),
    )
    assert bid in [b["booking_id"] for b in inside.json()["items"]]

    win_from, win_to = ci - timedelta(days=10), ci - timedelta(days=5)
    before = await client.get(  # type: ignore[attr-defined]
        "/api/v1/bookings",
        params={"stay_from": win_from.isoformat(), "stay_to": win_to.isoformat()},
        headers=auth_header(staff),
    )
    ids = [b["booking_id"] for b in before.json()["items"]]
    assert bid not in ids  # the stay sits entirely after the window
    for b in before.json()["items"]:  # every row genuinely overlaps [from, to)
        bci = date.fromisoformat(b["check_in_date"])
        bco = date.fromisoformat(b["check_out_date"])
        assert bci < win_to and win_from < bco


async def test_admin_search_matches_ref_guest_or_room(client: object) -> None:
    """The `q` box on the bookings board hits a booking by its reference, the
    guest's name or a room number."""
    staff = await login(client, "recep01", SEED_PASSWORD)
    made = await make_booking(client, staff, customer_id=4, room_id=1, nights=2, days_ahead=6600)
    bid = made["booking_id"]  # seed customer 4 is "John Carter"; room 1 is "101"

    for term in (f"TIG-{bid:05d}", str(bid), "carter", "101"):
        found = await client.get(  # type: ignore[attr-defined]
            "/api/v1/bookings", params={"q": term}, headers=auth_header(staff)
        )
        assert found.status_code == 200, found.text
        ids = [row["booking_id"] for row in found.json()["items"]]
        assert bid in ids, f"q={term!r} did not surface {bid}"

    miss = await client.get(  # type: ignore[attr-defined]
        "/api/v1/bookings", params={"q": "zzq-nobody-here"}, headers=auth_header(staff)
    )
    assert miss.status_code == 200 and miss.json()["total"] == 0
