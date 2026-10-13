import { describe, expect, it } from "vitest";
import { fillNights, isoMinus } from "./revenue";

describe("isoMinus", () => {
  it("steps back whole calendar days, across a month end", () => {
    expect(isoMinus("2026-09-19", 6)).toBe("2026-09-13");
    expect(isoMinus("2026-10-02", 3)).toBe("2026-09-29");
    expect(isoMinus("2026-09-19", 0)).toBe("2026-09-19");
  });
});

describe("fillNights", () => {
  it("returns every night in the window, zero-filling the gaps", () => {
    const rows = fillNights(
      [{ stay_date: "2026-09-02", bookings: 2, room_nights: 3, room_revenue: "4500.00" }],
      "2026-09-01",
      "2026-09-03",
    );
    expect(rows.map((r) => r.stay_date)).toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]);
    expect(rows[0]).toEqual({ stay_date: "2026-09-01", bookings: 0, room_nights: 0, room_revenue: "0" });
    expect(rows[1].room_revenue).toBe("4500.00");
  });

  it("is empty when the window is inverted", () => {
    expect(fillNights([], "2026-09-05", "2026-09-01")).toEqual([]);
  });
});
