import { describe, expect, it } from "vitest";
import { stayIcs } from "./ics";
import { HOTEL } from "./hotel";

describe("stayIcs", () => {
  const cal = stayIcs({
    ref: "TIG-01234",
    checkIn: "2027-03-05",
    checkOut: "2027-03-08",
    rooms: "Oriental Suite",
  });

  it("wraps a single all-day VEVENT", () => {
    expect(cal.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(cal.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    expect(cal.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });

  it("uses the check-in date as DTSTART and the check-out date as the exclusive DTEND", () => {
    expect(cal).toContain("DTSTART;VALUE=DATE:20270305");
    expect(cal).toContain("DTEND;VALUE=DATE:20270308");
  });

  it("carries the shared hotel address, not a stale hard-coded one", () => {
    expect(cal).toContain(`LOCATION:${HOTEL.name}\\, ${HOTEL.addressOneLine.replace(/,/g, "\\,")}`);
    expect(cal).not.toContain("Charoen Krung");
  });

  it("escapes commas in the folded text fields", () => {
    // esc() turns "," into "\," per RFC 5545
    expect(cal).toMatch(/LOCATION:[^\r\n]*\\,/);
  });
});
