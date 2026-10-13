import { describe, expect, it } from "vitest";
import {
  baht,
  bookingRef,
  fmtDate,
  fmtDayShort,
  fmtStay,
  monthAbbr,
  nightsBetween,
  statusLabel,
  weekdayAbbr,
} from "./format";

describe("baht", () => {
  it("formats a plain integer by default", () => {
    expect(baht(1800)).toBe("฿1,800");
    expect(baht("900")).toBe("฿900");
  });
  it("forces two decimals when asked", () => {
    expect(baht(1800, true)).toBe("฿1,800.00");
    expect(baht("2429.9", true)).toBe("฿2,429.90");
  });
  it("treats junk as zero", () => {
    expect(baht("not money")).toBe("฿0");
  });
});

describe("bookingRef", () => {
  it("zero-pads to the TIG-##### form", () => {
    expect(bookingRef(12)).toBe("TIG-00012");
    expect(bookingRef(1279)).toBe("TIG-01279");
  });
});

describe("nightsBetween", () => {
  it("counts whole nights", () => {
    expect(nightsBetween("2026-10-12", "2026-10-15")).toBe(3);
    expect(nightsBetween("2026-10-12", "2026-10-12")).toBe(0);
  });
  it("never returns a negative", () => {
    expect(nightsBetween("2026-10-15", "2026-10-12")).toBe(0);
  });
});

describe("fmtDate / fmtStay", () => {
  it("renders a single date", () => {
    expect(fmtDate("2026-10-12")).toBe("12 Oct 2026");
  });
  it("collapses a same-month range", () => {
    expect(fmtStay("2026-10-12", "2026-10-15")).toBe("12-15 Oct 2026");
  });
  it("spans months", () => {
    expect(fmtStay("2026-09-29", "2026-10-02")).toBe("29 Sep - 2 Oct 2026");
  });
  it("defaults to English when no lang is given", () => {
    expect(fmtDate("2026-10-12")).toBe(fmtDate("2026-10-12", "en"));
  });
  it("renders Thai month abbreviations when asked", () => {
    expect(fmtDate("2026-10-12", "th")).toBe("12 ต.ค. 2026");
  });
  it("renders a Thai same-month stay range", () => {
    expect(fmtStay("2026-10-12", "2026-10-15", "th")).toBe("12-15 ต.ค. 2026");
  });
  it("renders a Thai cross-month stay range", () => {
    expect(fmtStay("2026-09-29", "2026-10-02", "th")).toBe("29 ก.ย. - 2 ต.ค. 2026");
  });
});

describe("fmtDayShort", () => {
  it("renders weekday + short English date by default", () => {
    expect(fmtDayShort("2026-09-11")).toBe("Fri, Sep 11");
  });
  it("renders weekday + short Thai date when asked", () => {
    expect(fmtDayShort("2026-09-11", "th")).toBe("ศ. 11 ก.ย.");
  });
});

describe("monthAbbr / weekdayAbbr", () => {
  it("returns English abbreviations by default", () => {
    expect(monthAbbr(0)).toBe("Jan");
    expect(weekdayAbbr(0)).toBe("Sun.");
  });
  it("returns Thai abbreviations when asked", () => {
    expect(monthAbbr(0, "th")).toBe("ม.ค.");
    expect(weekdayAbbr(0, "th")).toBe("อา.");
  });
});

describe("statusLabel", () => {
  it("humanises snake_case statuses", () => {
    expect(statusLabel("checked_in")).toBe("Checked in");
    expect(statusLabel("in_progress")).toBe("In progress");
  });
});
