/**
 * Column filters for the staff tables. `FilterField` describes one control in
 * the "Advanced filters" panel (`components/FilterPanel`); the helpers below
 * tell which are in force and apply them to rows a table already holds (the
 * tables that are not paged on the server).
 */

/**
 * One filter per table column. A text field matches part of the value, a
 * select picks one value, and the two range kinds take a from / to pair
 * (either end may be left open).
 */
export type FilterField =
  | { type: "text"; key: string; label: string; placeholder?: string }
  | { type: "select"; key: string; label: string; options: { value: string; label: string }[] }
  | { type: "date-range"; label: string; from: string; to: string }
  | {
      type: "number-range";
      label: string;
      from: string;
      to: string;
      min?: number;
      step?: number;
      /** shown before the numbers in the summary chip, e.g. "฿" */
      prefix?: string;
    };

export type FilterValues = Record<string, string>;

/** The keys a field writes to - one for text / select, two for a range. */
export function fieldKeys(f: FilterField): string[] {
  return f.type === "date-range" || f.type === "number-range" ? [f.from, f.to] : [f.key];
}

const set = (v: string | undefined) => v !== undefined && v.trim() !== "";

export function isFieldActive(f: FilterField, values: FilterValues): boolean {
  return fieldKeys(f).some((k) => set(values[k]));
}

/** How many columns are being filtered on (a from / to pair counts once). */
export function activeFilterCount(fields: FilterField[], values: FilterValues): number {
  return fields.filter((f) => isFieldActive(f, values)).length;
}

/** A range whose "from" is past its "to" - nothing can match it. */
export function rangeIsInverted(f: FilterField, values: FilterValues): boolean {
  if (f.type !== "date-range" && f.type !== "number-range") return false;
  const a = values[f.from];
  const b = values[f.to];
  if (!set(a) || !set(b)) return false;
  return f.type === "date-range" ? a > b : Number(a) > Number(b);
}

/** Set (or, with "", drop) one filter value - the same object back when
 *  nothing changed, so a table does not reload for a no-op. */
export function withFilter(values: FilterValues, key: string, value: string): FilterValues {
  if ((values[key] ?? "") === value) return values;
  const next = { ...values };
  if (value === "") delete next[key];
  else next[key] = value;
  return next;
}

/* ---------------------------------------------------- row matchers */

/** Case-insensitive "contains"; an empty needle matches everything. */
export function textHas(hay: string | null | undefined, needle: string | undefined): boolean {
  if (!set(needle)) return true;
  return (hay ?? "").toLowerCase().includes(needle!.trim().toLowerCase());
}

/** `n` within [from, to]; either end may be blank (open). */
export function inNumRange(
  n: number | string | null | undefined,
  from: string | undefined,
  to: string | undefined,
): boolean {
  if (!set(from) && !set(to)) return true;
  const x = Number(n);
  if (n === null || n === undefined || Number.isNaN(x)) return false;
  return (!set(from) || x >= Number(from)) && (!set(to) || x <= Number(to));
}

/** An ISO date (or timestamp) within [from, to], compared by calendar day. */
export function inDateRange(
  iso: string | null | undefined,
  from: string | undefined,
  to: string | undefined,
): boolean {
  if (!set(from) && !set(to)) return true;
  if (!iso) return false;
  const d = iso.slice(0, 10);
  return (!set(from) || d >= from!) && (!set(to) || d <= to!);
}

/** A stay [start, end) that overlaps the window [from, to] at all. */
export function overlapsRange(
  start: string,
  end: string,
  from: string | undefined,
  to: string | undefined,
): boolean {
  return (!set(to) || start.slice(0, 10) <= to!) && (!set(from) || end.slice(0, 10) > from!);
}

/** An exact select value; blank means any. */
export function isOneOf(value: string | number | boolean | null | undefined, pick: string | undefined) {
  return !set(pick) || String(value) === pick;
}
