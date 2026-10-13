import { describe, expect, it } from "vitest";
import {
  clampInt,
  isPastDate,
  isSafeNext,
  isTodayOrFuture,
  slideStay,
  toPositiveAmount,
  todayISO,
} from "./validation";

const DAY = 86_400_000;
const iso = (offsetDays: number) =>
  new Date(Date.parse(todayISO()) + offsetDays * DAY).toISOString().slice(0, 10);

describe("todayISO", () => {
  it("is a YYYY-MM-DD string for today", () => {
    const s = todayISO();
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const d = new Date();
    expect(s).toBe(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate(),
      ).padStart(2, "0")}`,
    );
  });
});

describe("isPastDate / isTodayOrFuture", () => {
  it("flags a clearly past date", () => {
    expect(isPastDate("2000-01-01")).toBe(true);
    expect(isTodayOrFuture("2000-01-01")).toBe(false);
  });
  it("does not flag today or the future", () => {
    expect(isPastDate(todayISO())).toBe(false);
    expect(isTodayOrFuture("2999-12-31")).toBe(true);
  });
  it("treats an empty string as not-past", () => {
    expect(isPastDate("")).toBe(false);
  });
});

describe("toPositiveAmount", () => {
  it("parses a valid positive amount, rounded to cents", () => {
    expect(toPositiveAmount("1200")).toBe(1200);
    expect(toPositiveAmount(" 99.999 ")).toBe(100);
    expect(toPositiveAmount("0.01")).toBe(0.01);
  });
  it("rejects zero, negatives and non-numbers", () => {
    expect(toPositiveAmount("0")).toBeNull();
    expect(toPositiveAmount("-5")).toBeNull();
    expect(toPositiveAmount("")).toBeNull();
    expect(toPositiveAmount("abc")).toBeNull();
  });
});

describe("clampInt", () => {
  it("keeps a value inside the range", () => {
    expect(clampInt("3", 1, 5)).toBe(3);
  });
  it("clamps out-of-range values", () => {
    expect(clampInt("9", 1, 5)).toBe(5);
    expect(clampInt("-2", 1, 5)).toBe(1);
  });
  it("falls back to min for blank / NaN input", () => {
    expect(clampInt("", 1, 5)).toBe(1);
    expect(clampInt("not a number", 2, 5)).toBe(2);
  });
});

describe("slideStay", () => {
  it("moves the window forward and keeps its length", () => {
    const r = slideStay(iso(10), iso(13), 7);
    expect(r).toEqual({ checkIn: iso(17), checkOut: iso(20) });
  });

  it("moves the window back when there is still room before today", () => {
    const r = slideStay(iso(30), iso(32), -7);
    expect(r).toEqual({ checkIn: iso(23), checkOut: iso(25) });
  });

  it("clamps check-in to today when the shift would go into the past, keeping the span", () => {
    const r = slideStay(iso(2), iso(5), -30);
    expect(r.checkIn).toBe(todayISO());
    expect(r.checkOut).toBe(iso(3));
  });

  it("never collapses a stay below one night", () => {
    const r = slideStay(iso(1), iso(1), 5); // degenerate same-day input
    expect(Date.parse(r.checkOut) - Date.parse(r.checkIn)).toBe(DAY);
  });
});

describe("isSafeNext", () => {
  it("accepts an in-app absolute path", () => {
    expect(isSafeNext("/book")).toBe(true);
    expect(isSafeNext("/admin/bookings/12")).toBe(true);
  });
  it("rejects protocol-relative and external URLs", () => {
    expect(isSafeNext("//evil.example.com")).toBe(false);
    expect(isSafeNext("https://evil.example.com")).toBe(false);
    expect(isSafeNext("book")).toBe(false);
    expect(isSafeNext(null)).toBe(false);
    expect(isSafeNext(undefined)).toBe(false);
  });
});
