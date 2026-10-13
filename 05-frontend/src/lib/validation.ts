/**
 * Small pure input-validation helpers shared across forms. Keep these dependency-
 * free and side-effect-free - they mirror the server's Pydantic rules so the UI
 * can disable a control before the request is ever sent.
 */

/** Today as a calendar date, `YYYY-MM-DD`, in the browser's local zone. */
export function todayISO(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` (or ISO timestamp) strictly before today. */
export function isPastDate(iso: string): boolean {
  if (!iso) return false;
  return iso.slice(0, 10) < todayISO();
}

/** `d` is today or later. */
export function isTodayOrFuture(iso: string): boolean {
  return !!iso && iso.slice(0, 10) >= todayISO();
}

/**
 * Parse a money string to a positive number, or `null` when it is blank,
 * non-numeric, zero or negative. Matches `PaymentIn.amount` (`gt=0`).
 */
export function toPositiveAmount(input: string): number | null {
  const n = Number(String(input).trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

/**
 * Coerce a text field to an integer within `[min, max]`. Blank/NaN falls back to
 * `min`. Use when a value must never leave the form as `NaN`.
 */
export function clampInt(input: string | number, min: number, max: number): number {
  const n = Math.floor(Number(input));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/**
 * Slide a stay window by `deltaDays` (negative = earlier) while keeping its
 * length, and never let check-in fall before today. Returns `YYYY-MM-DD`
 * strings. Powers the availability search's "try another week" nudges.
 */
export function slideStay(
  checkIn: string,
  checkOut: string,
  deltaDays: number,
): { checkIn: string; checkOut: string } {
  const DAY = 86_400_000;
  const span = Math.max(1, Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / DAY));
  const floor = Date.parse(todayISO());
  const start = Math.max(floor, Date.parse(checkIn) + deltaDays * DAY);
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { checkIn: iso(start), checkOut: iso(start + span * DAY) };
}

/**
 * True when `next` is a safe in-app path to redirect to: a single leading slash,
 * no scheme, no protocol-relative `//host`. Guards the `?next=` param on the auth
 * pages against open redirects.
 */
export function isSafeNext(next: string | null | undefined): next is string {
  return !!next && /^\/(?!\/)/.test(next);
}
