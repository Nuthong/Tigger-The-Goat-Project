/**
 * Editorial copy + facts for each room category, keyed by the seeded
 * `room_type_id` (1‑5). Concept: **a downtown Bangkok city hotel** - walk-to-BTS,
 * skyline and street views, no river. The database owns the name, price and
 * occupancy; this file only adds the dressing the API doesn't carry.
 */
import { HERO_ROOMS_BY_TYPE, ROOM_FALLBACK } from "./images";

export type RoomView = "City" | "Park" | "Skyline";

export interface RoomFacts {
  size: string;
  bed: string;
  view: RoomView;
}

interface RoomProfile extends RoomFacts {
  tagline: string;
  note: string;
  amenities: string[];
}

const BASE_AMENITIES = [
  "Rain shower & deep bath",
  "Egyptian-cotton linen",
  "Nespresso & complimentary minibar water",
  "300 Mbps Wi-Fi",
  "Smart climate control",
  "In-room safe & USB-C charging",
];

const PROFILES: Record<number, RoomProfile> = {
  1: {
    view: "City",
    size: "30 m²",
    bed: "1 king or 2 twin",
    tagline: "A quiet room in a loud neighbourhood.",
    note: "Our entry room on a mid floor, looking out over the avenue. Double-glazed against the traffic, with a compact work desk and a reading chair - the everyday choice for a night or two in town, two minutes from the BTS.",
    amenities: [...BASE_AMENITIES, "Work desk", "Blackout curtains"],
  },
  2: {
    view: "Park",
    size: "34 m²",
    bed: "1 king",
    tagline: "Wake up over the green.",
    note: "A corner room turned toward Lumphini Park - treetops instead of towers, joggers at dawn, and the city softening at the edges. Sitting area and a wider bath.",
    amenities: [...BASE_AMENITIES, "Park-facing seating", "Bathrobe & slippers"],
  },
  3: {
    view: "Skyline",
    size: "42 m²",
    bed: "1 king",
    tagline: "The skyline, at eye level.",
    note: "High in the tower with a broad view across the business district - best at dusk when the offices light up. A proper lounge chair, a marble bath with a separate shower, and lounge access.",
    amenities: [...BASE_AMENITIES, "Executive lounge access", "Lounge chair & ottoman", "Separate rain shower", "Pillow menu"],
  },
  4: {
    view: "Skyline",
    size: "58 m²",
    bed: "2 bedrooms · 1 king + 2 twin",
    tagline: "Room to stay a while.",
    note: "A two-bedroom residence with a separate living room and a kitchenette - for families or a working week in town. Skyline windows the length of the room and a dining table for four.",
    amenities: [
      ...BASE_AMENITIES,
      "Separate living room",
      "Kitchenette",
      "Dining table for four",
      "Washer / dryer",
    ],
  },
  5: {
    view: "Skyline",
    size: "72 m²",
    bed: "1 king",
    tagline: "The city, from the top of the house.",
    note: "The signature suite: a corner of the top floors with a panoramic city view, a separate living room, a marble bath with a free-standing tub, and a dressing room. Butler service on request.",
    amenities: [
      ...BASE_AMENITIES,
      "Panoramic corner view",
      "Separate living room",
      "Dressing room",
      "Free-standing bath",
      "Butler service on request",
      "Evening turndown",
    ],
  },
};

export function roomPhoto(roomTypeId: number): string {
  return HERO_ROOMS_BY_TYPE[roomTypeId] ?? ROOM_FALLBACK;
}

export function roomTagline(roomTypeId: number): string {
  return PROFILES[roomTypeId]?.tagline ?? "";
}

export function roomNote(roomTypeId: number): string {
  return (
    PROFILES[roomTypeId]?.note ??
    "A comfortable room finished by hand and held against real availability."
  );
}

export function roomFacts(roomTypeId: number): RoomFacts | undefined {
  const p = PROFILES[roomTypeId];
  return p ? { size: p.size, bed: p.bed, view: p.view } : undefined;
}

export function roomAmenities(roomTypeId: number): string[] {
  return PROFILES[roomTypeId]?.amenities ?? BASE_AMENITIES;
}

/** `"Premier Skyline Room"` → `"premier-skyline-room"`. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
