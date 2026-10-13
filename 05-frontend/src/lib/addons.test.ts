import { describe, expect, it } from "vitest";
import { addonCap, addonLines, addonsTotal, coverPicks, toggleAddon } from "./addons";
import type { Service } from "./types";

const CATALOG: Service[] = [
  {
    service_id: 1,
    name: "Breakfast Buffet",
    price: "250.00",
    description: null,
    is_active: true,
    basis: "per_guest_night",
  },
  {
    service_id: 2,
    name: "Airport Transfer",
    price: "600.00",
    description: null,
    is_active: true,
    basis: "per_trip",
  },
];

describe("addonCap", () => {
  const stay = { nights: 5, rooms: 1, guests: 2 };

  it("follows the unit of each add-on", () => {
    expect(addonCap("per_guest_night", stay)).toBe(10); // 2 guests x 5 mornings
    expect(addonCap("per_room_night", stay)).toBe(5); // 1 room x 5 nights
    expect(addonCap("per_trip", stay)).toBe(2); // in and out
    expect(addonCap("per_room_stay", stay)).toBe(1); // one late check-out
  });

  it("scales with rooms and never passes the line ceiling", () => {
    expect(addonCap("per_room_stay", { nights: 3, rooms: 3, guests: 6 })).toBe(3);
    expect(addonCap("per_guest_night", { nights: 30, rooms: 10, guests: 20 })).toBe(99);
  });

  it("treats a missing or bad shape as one night, one room, one guest", () => {
    expect(addonCap("per_guest_night", { nights: 0, rooms: 0, guests: Number.NaN })).toBe(1);
  });
});

describe("toggleAddon", () => {
  const stay = { nights: 5, rooms: 1, guests: 2 };

  it("adds a service at full cover for the stay, and takes it off again", () => {
    const a = toggleAddon({}, CATALOG[0], stay);
    expect(a).toEqual({ 1: 10 }); // breakfast: 2 guests x 5 mornings
    const b = toggleAddon(a, CATALOG[1], stay);
    expect(b).toEqual({ 1: 10, 2: 2 }); // transfer: in and out
    expect(toggleAddon(b, CATALOG[0], stay)).toEqual({ 2: 2 });
    expect(a).toEqual({ 1: 10 }); // input untouched
  });
});

describe("coverPicks", () => {
  it("follows the stay down and back up", () => {
    const picks = { 1: 10, 2: 2 };
    const shorter = coverPicks(CATALOG, picks, { nights: 2, rooms: 1, guests: 2 });
    expect(shorter).toEqual({ 1: 4, 2: 2 });
    expect(coverPicks(CATALOG, shorter, { nights: 3, rooms: 2, guests: 4 })).toEqual({
      1: 12,
      2: 4,
    });
  });

  it("returns the same object when the cover is already right", () => {
    const picks = { 1: 10 };
    expect(coverPicks(CATALOG, picks, { nights: 5, rooms: 1, guests: 2 })).toBe(picks);
  });

  it("drops a retired service, but waits for the catalog to load", () => {
    expect(coverPicks(CATALOG, { 1: 10, 9: 3 }, { nights: 5, rooms: 1, guests: 2 })).toEqual({
      1: 10,
    });
    const picks = { 9: 3 };
    expect(coverPicks([], picks, { nights: 5, rooms: 1, guests: 2 })).toBe(picks);
  });
});

describe("addonLines", () => {
  it("emits only positive picks, in service order", () => {
    expect(addonLines({ 2: 1, 1: 3, 5: 0 })).toEqual([
      { service_id: 1, quantity: 3 },
      { service_id: 2, quantity: 1 },
    ]);
  });
});

describe("addonsTotal", () => {
  it("prices picks from the catalog", () => {
    expect(addonsTotal(CATALOG, { 1: 2, 2: 1 })).toBe(1100);
  });

  it("ignores picks for services that are not in the catalog", () => {
    expect(addonsTotal(CATALOG, { 9: 4 })).toBe(0);
    expect(addonsTotal([], { 1: 1 })).toBe(0);
  });
});
