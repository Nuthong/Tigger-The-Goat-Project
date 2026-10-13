/** Build a minimal RFC-5545 VCALENDAR for a hotel stay and hand it to the
 *  browser as a download. All-day VEVENT from check-in to check-out (the
 *  check-out date is the exclusive DTEND, which is what an all-day event wants). */
import { HOTEL } from "./hotel";

const LOCATION = `${HOTEL.name}, ${HOTEL.addressOneLine}`;

function icsDate(iso: string): string {
  // "2027-03-05" -> "20270305"
  return iso.slice(0, 10).replace(/-/g, "");
}

function esc(s: string): string {
  return s.replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
}

export function stayIcs(opts: {
  ref: string;
  checkIn: string;
  checkOut: string;
  rooms: string;
}): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Tigger Oriental//Booking//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${opts.ref}@tiggeroriental`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${icsDate(opts.checkIn)}`,
    `DTEND;VALUE=DATE:${icsDate(opts.checkOut)}`,
    `SUMMARY:${esc(`Stay at ${HOTEL.name} (${opts.ref})`)}`,
    `LOCATION:${esc(LOCATION)}`,
    `DESCRIPTION:${esc(
      `Booking ${opts.ref} · ${opts.rooms}\n` +
        `Check-in from ${HOTEL.checkInFrom}, check-out by ${HOTEL.checkOutBy}.`,
    )}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

export function downloadIcs(filename: string, body: string): void {
  const blob = new Blob([body], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
