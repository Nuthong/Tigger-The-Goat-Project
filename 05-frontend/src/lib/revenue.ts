/** Helpers for the daily room-revenue panel (the `v_daily_revenue` view). */
import type { DailyRevenueRow } from "./types";

const DAY = 86_400_000;

/** `2026-09-19` minus 6 days -> `2026-09-13` (calendar dates, UTC-safe). */
export function isoMinus(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) - days * DAY).toISOString().slice(0, 10);
}

/** One row per night from `from` to `to` inclusive. `v_daily_revenue` only has
 *  nights with stays on them, so the empty ones are filled with zero to keep an
 *  even time axis. */
export function fillNights(rows: DailyRevenueRow[], from: string, to: string): DailyRevenueRow[] {
  const byDate = new Map(rows.map((r) => [r.stay_date.slice(0, 10), r]));
  const out: DailyRevenueRow[] = [];
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= end; t += DAY) {
    const d = new Date(t).toISOString().slice(0, 10);
    out.push(byDate.get(d) ?? { stay_date: d, bookings: 0, room_nights: 0, room_revenue: "0" });
  }
  return out;
}
