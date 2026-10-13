import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  fieldKeys,
  inDateRange,
  inNumRange,
  isOneOf,
  overlapsRange,
  rangeIsInverted,
  textHas,
  withFilter,
  type FilterField,
} from "./filters";

const FIELDS: FilterField[] = [
  { type: "text", key: "guest", label: "Guest" },
  { type: "select", key: "status", label: "Status", options: [{ value: "paid", label: "Paid" }] },
  { type: "date-range", label: "Stay", from: "stay_from", to: "stay_to" },
  { type: "number-range", label: "Nights", from: "min_nights", to: "max_nights" },
];

describe("field bookkeeping", () => {
  it("knows which keys a field writes", () => {
    expect(fieldKeys(FIELDS[0])).toEqual(["guest"]);
    expect(fieldKeys(FIELDS[2])).toEqual(["stay_from", "stay_to"]);
  });

  it("counts a from / to pair as one filtered column, and ignores blanks", () => {
    expect(activeFilterCount(FIELDS, {})).toBe(0);
    expect(activeFilterCount(FIELDS, { guest: "  " })).toBe(0);
    expect(
      activeFilterCount(FIELDS, { guest: "ann", stay_from: "2026-09-01", stay_to: "2026-09-05" }),
    ).toBe(2);
    expect(activeFilterCount(FIELDS, { max_nights: "3" })).toBe(1);
  });

  it("flags a range whose from is past its to", () => {
    expect(rangeIsInverted(FIELDS[2], { stay_from: "2026-09-05", stay_to: "2026-09-01" })).toBe(true);
    expect(rangeIsInverted(FIELDS[3], { min_nights: "10", max_nights: "9" })).toBe(true);
    // numbers compare as numbers, not text ("10" < "9" as strings)
    expect(rangeIsInverted(FIELDS[3], { min_nights: "9", max_nights: "10" })).toBe(false);
    expect(rangeIsInverted(FIELDS[3], { min_nights: "9" })).toBe(false);
    expect(rangeIsInverted(FIELDS[0], { guest: "x" })).toBe(false);
  });

  it("sets and drops a value, returning the same object for a no-op", () => {
    const a = withFilter({}, "guest", "ann");
    expect(a).toEqual({ guest: "ann" });
    expect(withFilter(a, "guest", "ann")).toBe(a);
    expect(withFilter(a, "guest", "")).toEqual({});
  });
});

describe("row matchers", () => {
  it("matches text case-insensitively, anywhere in the value", () => {
    expect(textHas("Somchai Jaidee", "JAI")).toBe(true);
    expect(textHas("Somchai Jaidee", "anna")).toBe(false);
    expect(textHas(null, "x")).toBe(false);
    expect(textHas(null, "")).toBe(true);
  });

  it("checks open-ended number ranges", () => {
    expect(inNumRange(5, "3", "")).toBe(true);
    expect(inNumRange("2500.00", "", "2000")).toBe(false);
    expect(inNumRange(null, "1", "")).toBe(false);
    expect(inNumRange(null, "", "")).toBe(true);
  });

  it("compares dates by calendar day, timestamps included", () => {
    expect(inDateRange("2026-09-05T23:10:00+07:00", "2026-09-05", "2026-09-05")).toBe(true);
    expect(inDateRange("2026-09-06", "", "2026-09-05")).toBe(false);
    expect(inDateRange(null, "2026-09-01", "")).toBe(false);
  });

  it("treats a stay as [check-in, check-out) when testing overlap", () => {
    // leaves on the 5th, so it does not touch a window starting on the 5th
    expect(overlapsRange("2026-09-01", "2026-09-05", "2026-09-05", "")).toBe(false);
    expect(overlapsRange("2026-09-01", "2026-09-05", "2026-09-04", "2026-09-10")).toBe(true);
    expect(overlapsRange("2026-09-01", "2026-09-05", "", "2026-08-31")).toBe(false);
  });

  it("matches a select value exactly, blank meaning any", () => {
    expect(isOneOf(true, "true")).toBe(true);
    expect(isOneOf(3, "3")).toBe(true);
    expect(isOneOf("paid", "unpaid")).toBe(false);
    expect(isOneOf("paid", "")).toBe(true);
  });
});
