"""How many of an add-on one stay can sensibly carry (BR-29).

`service` stores a price and a free-text description, not a unit, and
`03-database/` is locked - so the unit is read from the wording the manager
already writes ("ต่อคนต่อวัน", "ต่อคืน", "เที่ยวเดียว" ...). Every add-on then
gets a ceiling that follows the stay: a five-night stay for two cannot carry
forty breakfasts. Anything the wording does not pin down is treated as one per
room per night (laundry bags, mini-bar restocks).
"""

from __future__ import annotations

from typing import Literal

Basis = Literal["per_guest_night", "per_room_night", "per_trip", "per_room_stay"]

# checked in this order - "ต่อคนต่อวัน" also contains "ต่อ..." wording used below
_CUES: tuple[tuple[Basis, tuple[str, ...]], ...] = (
    ("per_guest_night", ("ต่อคน", "per person", "per guest", "breakfast")),
    ("per_room_stay", ("เช็คเอาท์", "เช็กเอาท์", "late check", "checkout", "check-out")),
    ("per_trip", ("เที่ยว", "per trip", "one way", "transfer")),
    ("per_room_night", ("ต่อคืน", "per night", "extra bed")),
)

TRIPS_PER_ROOM = 2  # one in from the airport, one back out


def service_basis(name: str, description: str | None) -> Basis:
    text = f"{name} {description or ''}".lower()
    for basis, cues in _CUES:
        if any(cue in text for cue in cues):
            return basis
    return "per_room_night"


MAX_LINE_QTY = 99  # hard ceiling on one booking line, whatever the stay


def max_quantity(basis: Basis, *, nights: int, rooms: int, guests: int) -> int:
    nights, rooms, guests = max(nights, 1), max(rooms, 1), max(guests, 1)
    if basis == "per_guest_night":
        cap = guests * nights
    elif basis == "per_trip":
        cap = TRIPS_PER_ROOM * rooms
    elif basis == "per_room_stay":
        cap = rooms
    else:
        cap = rooms * nights
    return min(cap, MAX_LINE_QTY)


BASIS_LABEL: dict[Basis, str] = {
    "per_guest_night": "1 per guest per night",
    "per_room_night": "1 per room per night",
    "per_trip": f"{TRIPS_PER_ROOM} trips per room",
    "per_room_stay": "1 per room per stay",
}
