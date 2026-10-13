/** Presentation helpers - money, dates, booking refs, status labels. */
import type { Lang } from "./i18n";

const MONTHS: Record<Lang, string[]> = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  th: [
    "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
    "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
  ],
};

const WEEKDAYS: Record<Lang, string[]> = {
  en: ["Sun.", "Mon.", "Tue.", "Wed.", "Thu.", "Fri.", "Sat."],
  th: ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."],
};

/** `3` (0-indexed) + `"th"` -> `"เม.ย."`. Used by the reservation tape's month header. */
export function monthAbbr(month: number, lang: Lang = "en"): string {
  return MONTHS[lang][month] ?? MONTHS.en[month];
}

/** `0` (Sunday) + `"th"` -> `"อา."`. Used by the reservation tape's day-of-week row. */
export function weekdayAbbr(dow: number, lang: Lang = "en"): string {
  return WEEKDAYS[lang][dow] ?? WEEKDAYS.en[dow];
}

function toNum(v: string | number): number {
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : 0;
}

/**
 * Thai baht. `withDecimals` forces `.00` (bills, line items); the default is a
 * clean integer amount for lists and headline figures.
 */
export function baht(value: string | number, withDecimals = false): string {
  return (
    "฿" +
    toNum(value).toLocaleString("en-US", {
      minimumFractionDigits: withDecimals ? 2 : 0,
      maximumFractionDigits: 2,
    })
  );
}

/** `12` → `TIG-00012` - the guest-facing confirmation number. */
export function bookingRef(id: number): string {
  return `TIG-${String(id).padStart(5, "0")}`;
}

function parseISO(d: string): Date {
  // Accept "YYYY-MM-DD" or a full ISO timestamp; treat as calendar dates.
  return new Date(`${d.slice(0, 10)}T00:00:00`);
}

/** `2026-10-12` → `12 Oct 2026` (or `12 ต.ค. 2026` for `lang: "th"`). */
export function fmtDate(d: string, lang: Lang = "en"): string {
  const dt = parseISO(d);
  if (Number.isNaN(dt.getTime())) return d;
  return `${dt.getDate()} ${monthAbbr(dt.getMonth(), lang)} ${dt.getFullYear()}`;
}

/** A stay as a tight range: `12-15 Oct 2026`, `29 Sep - 2 Oct 2026`. */
export function fmtStay(checkIn: string, checkOut: string, lang: Lang = "en"): string {
  const a = parseISO(checkIn);
  const b = parseISO(checkOut);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) {
    return `${checkIn} - ${checkOut}`;
  }
  const sameMonth = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  const sameYear = a.getFullYear() === b.getFullYear();
  if (sameMonth) {
    return `${a.getDate()}-${b.getDate()} ${monthAbbr(b.getMonth(), lang)} ${b.getFullYear()}`;
  }
  const left = sameYear
    ? `${a.getDate()} ${monthAbbr(a.getMonth(), lang)}`
    : `${a.getDate()} ${monthAbbr(a.getMonth(), lang)} ${a.getFullYear()}`;
  return `${left} - ${b.getDate()} ${monthAbbr(b.getMonth(), lang)} ${b.getFullYear()}`;
}

/** `2026-09-11` → `Fri, Sep 11` (or `ศ. 11 ก.ย.` for `lang: "th"`) - weekday + short date, no year. */
export function fmtDayShort(d: string, lang: Lang = "en"): string {
  const dt = parseISO(d);
  if (Number.isNaN(dt.getTime())) return d;
  if (lang === "en") {
    return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }
  return `${weekdayAbbr(dt.getDay(), "th")} ${dt.getDate()} ${monthAbbr(dt.getMonth(), "th")}`;
}

/** Whole nights between two calendar dates (never negative). */
export function nightsBetween(checkIn: string, checkOut: string): number {
  const a = parseISO(checkIn).getTime();
  const b = parseISO(checkOut).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** `checked_in` → `Checked in`, `in_progress` → `In progress`. */
export function statusLabel(status: string): string {
  const s = status.replace(/_/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : status;
}
