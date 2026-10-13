/**
 * Add-on picker maths, shared by the guest checkout and the staff booking form.
 * A pick is `service_id -> quantity`, and the quantity is always the full cover
 * for the stay (`addonCap`); the server re-prices every line from the catalog
 * (BR-6), so these totals are the preview the guest sees before booking.
 */
import type { Service, ServiceBasis } from "./types";

export type AddonPicks = Record<number, number>;

/** Largest quantity one booking line may carry (mirrors the API's `le=99`). */
export const MAX_ADDON_QTY = 99;

/** One airport run in, one back out, per room. */
export const TRIPS_PER_ROOM = 2;

/** The shape of the stay the add-ons are for. */
export interface StayShape {
  nights: number;
  rooms: number;
  guests: number;
}

/**
 * The most of one add-on a stay can use (BR-29) - mirrors the API's
 * `addon_rules.max_quantity`, which enforces it: breakfast is per guest per
 * night, an extra bed per room per night, a transfer two trips per room, late
 * check-out once per room.
 */
export function addonCap(basis: ServiceBasis, stay: StayShape): number {
  const nights = Math.max(1, Math.floor(stay.nights) || 1);
  const rooms = Math.max(1, Math.floor(stay.rooms) || 1);
  const guests = Math.max(1, Math.floor(stay.guests) || 1);
  const cap =
    basis === "per_guest_night"
      ? guests * nights
      : basis === "per_trip"
        ? TRIPS_PER_ROOM * rooms
        : basis === "per_room_stay"
          ? rooms
          : rooms * nights;
  return Math.min(cap, MAX_ADDON_QTY);
}

/**
 * Adding an extra covers the whole stay - breakfast for every guest every
 * morning, an extra bed every night, the transfer both ways - so the guest
 * just ticks what they want. `toggleAddon` adds a service at full cover or
 * takes it off again.
 */
export function toggleAddon(picks: AddonPicks, service: Service, stay: StayShape): AddonPicks {
  const next = { ...picks };
  if (next[service.service_id] !== undefined) delete next[service.service_id];
  else next[service.service_id] = addonCap(service.basis, stay);
  return next;
}

/**
 * Keep every picked extra at full cover when the stay changes shape (dates,
 * rooms, guests) - up as well as down. Picks for a service no longer in the
 * catalog are dropped. Returns the same object when nothing had to change.
 */
export function coverPicks(catalog: Service[], picks: AddonPicks, stay: StayShape): AddonPicks {
  if (catalog.length === 0) return picks; // catalog not loaded yet
  const next: AddonPicks = {};
  let changed = false;
  for (const [id, q] of Object.entries(picks)) {
    const s = catalog.find((c) => c.service_id === Number(id));
    if (!s) {
      changed = true;
      continue;
    }
    next[s.service_id] = addonCap(s.basis, stay);
    if (next[s.service_id] !== q) changed = true;
  }
  return changed ? next : picks;
}

function clampQty(q: number): number {
  if (!Number.isFinite(q)) return 0;
  return Math.max(0, Math.min(MAX_ADDON_QTY, Math.floor(q)));
}

/** The request body lines for `POST /bookings` - only real, positive picks. */
export function addonLines(picks: AddonPicks): { service_id: number; quantity: number }[] {
  return Object.entries(picks)
    .map(([id, q]) => ({ service_id: Number(id), quantity: clampQty(q) }))
    .filter((l) => Number.isInteger(l.service_id) && l.service_id > 0 && l.quantity > 0)
    .sort((a, b) => a.service_id - b.service_id);
}

/** What the picked add-ons cost at today's catalog prices. Picks for a
 *  service no longer in the catalog are ignored. */
export function addonsTotal(catalog: Service[], picks: AddonPicks): number {
  const price = new Map(catalog.map((s) => [s.service_id, Number(s.price)]));
  return addonLines(picks).reduce((sum, l) => sum + (price.get(l.service_id) ?? 0) * l.quantity, 0);
}
