"""Module 6 - Payments: staff records payments, the bill balance reflects them."""

from __future__ import annotations

from tests.conftest import SEED_PASSWORD, auth_header, login, make_booking


async def _bill(client: object, token: str, booking_id: int) -> dict[str, object]:
    resp = await client.get(  # type: ignore[attr-defined]
        f"/api/v1/bookings/{booking_id}/bill", headers=auth_header(token)
    )
    assert resp.status_code == 200
    return resp.json()


async def test_partial_then_full_payment(client: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    booking = await make_booking(client, staff, customer_id=4, room_id=1, nights=2, days_ahead=3000)
    bid = booking["booking_id"]

    assert (await _bill(client, staff, bid))["balance_due"] == "1800.00"

    pay1 = await client.post(  # type: ignore[attr-defined]
        f"/api/v1/bookings/{bid}/payments",
        json={"amount": "1000.00", "method": "promptpay"},
        headers=auth_header(staff),
    )
    assert pay1.status_code == 201
    assert (await _bill(client, staff, bid))["balance_due"] == "800.00"

    await client.post(  # type: ignore[attr-defined]
        f"/api/v1/bookings/{bid}/payments",
        json={"amount": "800.00", "method": "cash"},
        headers=auth_header(staff),
    )
    bill = await _bill(client, staff, bid)
    assert bill["paid_total"] == "1800.00"
    assert bill["balance_due"] == "0.00"


async def test_customer_cannot_record_payment(client: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    booking = await make_booking(client, staff, customer_id=1, room_id=2, days_ahead=3100)
    somchai = await login(client, "somchai", SEED_PASSWORD)
    resp = await client.post(  # type: ignore[attr-defined]
        f"/api/v1/bookings/{booking['booking_id']}/payments",
        json={"amount": "100.00", "method": "cash"},
        headers=auth_header(somchai),
    )
    assert resp.status_code == 403


async def test_payment_rejects_bad_amount_and_method(client: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    booking = await make_booking(client, staff, customer_id=2, room_id=3, days_ahead=3200)
    bid = booking["booking_id"]
    for bad in ({"amount": "-5.00", "method": "cash"}, {"amount": "10.00", "method": "bitcoin"}):
        resp = await client.post(  # type: ignore[attr-defined]
            f"/api/v1/bookings/{bid}/payments", json=bad, headers=auth_header(staff)
        )
        assert resp.status_code == 422


async def test_cannot_pay_a_cancelled_booking(client: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    booking = await make_booking(client, staff, customer_id=3, room_id=4, days_ahead=3300)
    bid = booking["booking_id"]
    await client.post(f"/api/v1/bookings/{bid}/cancel", headers=auth_header(staff))  # type: ignore[attr-defined]
    resp = await client.post(  # type: ignore[attr-defined]
        f"/api/v1/bookings/{bid}/payments",
        json={"amount": "100.00", "method": "cash"},
        headers=auth_header(staff),
    )
    assert resp.status_code == 409


async def test_guest_settles_their_own_booking_online(client: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    booking = await make_booking(client, staff, customer_id=1, room_id=1, nights=2, days_ahead=3500)
    bid = booking["booking_id"]
    somchai = await login(client, "somchai", SEED_PASSWORD)  # owns customer 1

    assert (await _bill(client, somchai, bid))["balance_due"] == "1800.00"

    paid = await client.post(  # type: ignore[attr-defined]
        f"/api/v1/bookings/{bid}/pay",
        json={"method": "promptpay"},
        headers=auth_header(somchai),
    )
    assert paid.status_code == 200, paid.text
    assert paid.json()["balance_due"] == "0.00"
    assert paid.json()["paid_total"] == "1800.00"
    assert (await _bill(client, somchai, bid))["balance_due"] == "0.00"

    # revisiting the payment page after it is settled is a no-op, not an error
    again = await client.post(  # type: ignore[attr-defined]
        f"/api/v1/bookings/{bid}/pay",
        json={"method": "credit_card"},
        headers=auth_header(somchai),
    )
    assert again.status_code == 200 and again.json()["balance_due"] == "0.00"


async def test_guest_cannot_pay_another_guests_booking(client: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    booking = await make_booking(client, staff, customer_id=2, room_id=2, days_ahead=3600)
    malee = await login(client, "malee", SEED_PASSWORD)  # customer 3, not the owner
    resp = await client.post(  # type: ignore[attr-defined]
        f"/api/v1/bookings/{booking['booking_id']}/pay",
        json={"method": "promptpay"},
        headers=auth_header(malee),
    )
    assert resp.status_code == 404  # never reveal another guest's booking


async def test_guest_pay_rejects_an_offline_method(client: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    booking = await make_booking(client, staff, customer_id=3, room_id=3, days_ahead=3700)
    malee = await login(client, "malee", SEED_PASSWORD)
    resp = await client.post(  # type: ignore[attr-defined]
        f"/api/v1/bookings/{booking['booking_id']}/pay",
        json={"method": "cash"},
        headers=auth_header(malee),
    )
    assert resp.status_code == 422


async def test_payment_cannot_exceed_balance_due(client: object) -> None:
    staff = await login(client, "recep01", SEED_PASSWORD)
    booking = await make_booking(client, staff, customer_id=4, room_id=1, nights=2, days_ahead=3400)
    bid = booking["booking_id"]
    # balance is 1800.00 - a larger payment is refused
    resp = await client.post(  # type: ignore[attr-defined]
        f"/api/v1/bookings/{bid}/payments",
        json={"amount": "5000.00", "method": "cash"},
        headers=auth_header(staff),
    )
    assert resp.status_code == 409
    assert resp.json()["code"] == "over_payment"

    # the exact balance still goes through
    ok = await client.post(  # type: ignore[attr-defined]
        f"/api/v1/bookings/{bid}/payments",
        json={"amount": "1800.00", "method": "cash"},
        headers=auth_header(staff),
    )
    assert ok.status_code == 201
