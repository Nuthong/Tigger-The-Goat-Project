import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useT } from "../i18n/I18n";
import { fmtDate } from "../lib/format";
import {
  activeFilterCount,
  fieldKeys,
  isFieldActive,
  rangeIsInverted,
  type FilterField,
  type FilterValues as Values,
} from "../lib/filters";

export type { FilterField } from "../lib/filters";

/** "Room type: Suite", "Stay: 1 Sep 2026 to 5 Sep 2026", "Total: ≥ ฿1,000" ... */
function chipText(
  f: FilterField,
  v: Values,
  t: (k: string, vars?: Record<string, string | number>) => string,
  lang: "en" | "th",
): string {
  if (f.type === "text") return `${f.label}: “${v[f.key]}”`;
  if (f.type === "select") {
    const opt = f.options.find((o) => o.value === v[f.key]);
    return `${f.label}: ${opt?.label ?? v[f.key]}`;
  }
  const show = (x: string) =>
    f.type === "date-range"
      ? fmtDate(x, lang)
      : `${f.prefix ?? ""}${Number(x).toLocaleString()}`;
  const a = v[f.from];
  const b = v[f.to];
  if (a && b) return `${f.label}: ${t("filter.between", { a: show(a), b: show(b) })}`;
  if (a) return `${f.label}: ${t(f.type === "date-range" ? "filter.onOrAfter" : "filter.atLeast", { v: show(a) })}`;
  return `${f.label}: ${t(f.type === "date-range" ? "filter.onOrBefore" : "filter.atMost", { v: show(b) })}`;
}

/**
 * "Filters" for a staff table: a button (with a count of active filters) that
 * opens a panel with one control per column, and - always visible next to it -
 * a chip for every filter in force, each removable on its own. Text fields
 * wait for a pause in typing before they apply. Values live in the caller's
 * state, so a server-paged table sends them as query params and a small
 * client-side table runs them through `lib/filters`.
 */
export function FilterPanel({
  fields,
  values,
  onChange,
  onClear,
}: {
  fields: FilterField[];
  values: Values;
  onChange: (key: string, value: string) => void;
  onClear: () => void;
}) {
  const { t, lang } = useT();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const active = activeFilterCount(fields, values);

  // text fields: keep what is typed locally and apply it after a short pause
  const [draft, setDraft] = useState<Values>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  useEffect(() => {
    const pending = timers.current;
    return () => Object.values(pending).forEach(clearTimeout);
  }, []);
  const typed = (key: string) => draft[key] ?? values[key] ?? "";
  const type = (key: string, value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => {
      onChange(key, value.trim());
      setDraft((d) => {
        const next = { ...d };
        delete next[key];
        return next;
      });
    }, 350);
  };

  const clearField = (f: FilterField) => {
    fieldKeys(f).forEach((k) => {
      clearTimeout(timers.current[k]);
      onChange(k, "");
    });
    setDraft((d) => {
      const next = { ...d };
      fieldKeys(f).forEach((k) => delete next[k]);
      return next;
    });
  };
  const clearAll = () => {
    Object.values(timers.current).forEach(clearTimeout);
    setDraft({});
    onClear();
  };

  // keep the open panel on screen: it hangs from the button, but a button near
  // the right edge would push it off - slide it left just enough
  const bodyRef = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const btn = toggleRef.current?.getBoundingClientRect();
      const width = bodyRef.current?.offsetWidth ?? 0;
      if (!btn || !width) return;
      const gutter = 16;
      const overflow = btn.left + width - (window.innerWidth - gutter);
      setShift(overflow > 0 ? -Math.min(overflow, btn.left - gutter) : 0);
    };
    place();
    window.addEventListener("resize", place);
    // chips appearing or going can wrap the button onto another line - follow it
    const moved = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    if (moved && rootRef.current) moved.observe(rootRef.current);
    return () => {
      window.removeEventListener("resize", place);
      moved?.disconnect();
    };
  }, [open, values]);

  // outside click or Escape closes the panel
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      toggleRef.current?.focus();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="filterpanel" ref={rootRef}>
      <button
        ref={toggleRef}
        type="button"
        className={`filterpanel__toggle${active > 0 ? " is-active" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
          strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4 5h16l-6 7.5V19l-4-2v-4.5L4 5Z" />
        </svg>
        {t("filter.advanced")}
        {active > 0 && <span className="filterpanel__badge">{active}</span>}
      </button>

      {active > 0 && (
        <ul className="filterpanel__chips" aria-label={t("filter.inForce")}>
          {fields
            .filter((f) => isFieldActive(f, values))
            .map((f) => (
              <li key={fieldKeys(f).join("|")} className="filterchip">
                <span>{chipText(f, values, t, lang)}</span>
                <button
                  type="button"
                  aria-label={t("filter.removeOne", { label: f.label })}
                  onClick={() => clearField(f)}
                >
                  ×
                </button>
              </li>
            ))}
          {active > 1 && (
            <li>
              <button type="button" className="filterpanel__clearall" onClick={clearAll}>
                {t("filter.clear")}
              </button>
            </li>
          )}
        </ul>
      )}

      {open && (
        <div
          ref={bodyRef}
          className="filterpanel__body"
          role="dialog"
          aria-label={t("filter.advanced")}
          style={{ "--fp-shift": `${shift}px` } as CSSProperties}
        >
          <div className="filterpanel__head">
            <strong>{t("filter.byColumn")}</strong>
            <button
              type="button"
              className="filterpanel__x"
              aria-label={t("common.close")}
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </div>
          <div className="filterpanel__grid">
            {fields.map((f) => {
              const id = `flt-${fieldKeys(f).join("-")}`;
              const on = isFieldActive(f, values);
              const inverted = rangeIsInverted(f, values);
              return (
                <div
                  key={id}
                  className={`filterpanel__field${on ? " is-on" : ""}${
                    f.type === "date-range" || f.type === "number-range" ? " is-range" : ""
                  }`}
                >
                  <div className="filterpanel__label">
                    <label htmlFor={id}>{f.label}</label>
                    {on && (
                      <button type="button" onClick={() => clearField(f)}>
                        {t("filter.reset")}
                      </button>
                    )}
                  </div>
                  {f.type === "text" && (
                    <input
                      id={id}
                      type="search"
                      value={typed(f.key)}
                      placeholder={f.placeholder ?? t("filter.contains")}
                      onChange={(e) => type(f.key, e.target.value)}
                    />
                  )}
                  {f.type === "select" && (
                    <select
                      id={id}
                      value={values[f.key] ?? ""}
                      onChange={(e) => onChange(f.key, e.target.value)}
                    >
                      <option value="">{t("filter.any")}</option>
                      {f.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  )}
                  {(f.type === "date-range" || f.type === "number-range") && (
                    <div className="filterpanel__range">
                      <input
                        id={id}
                        type={f.type === "date-range" ? "date" : "number"}
                        aria-label={`${f.label} - ${t("filter.from")}`}
                        placeholder={t("filter.from")}
                        value={values[f.from] ?? ""}
                        max={f.type === "date-range" ? values[f.to] || undefined : undefined}
                        min={f.type === "number-range" ? f.min : undefined}
                        step={f.type === "number-range" ? f.step : undefined}
                        onChange={(e) => onChange(f.from, e.target.value)}
                      />
                      <span aria-hidden>{t("filter.to")}</span>
                      <input
                        type={f.type === "date-range" ? "date" : "number"}
                        aria-label={`${f.label} - ${t("filter.toLabel")}`}
                        placeholder={t("filter.toLabel")}
                        value={values[f.to] ?? ""}
                        min={
                          f.type === "date-range"
                            ? values[f.from] || undefined
                            : (f.min ?? undefined)
                        }
                        step={f.type === "number-range" ? f.step : undefined}
                        onChange={(e) => onChange(f.to, e.target.value)}
                      />
                    </div>
                  )}
                  {inverted && <p className="filterpanel__err">{t("filter.inverted")}</p>}
                </div>
              );
            })}
          </div>
          <div className="filterpanel__foot">
            <span className="tiny">
              {active > 0 ? t("filter.activeCount", { n: active }) : t("filter.noneActive")}
            </span>
            <span className="row" style={{ gap: 8 }}>
              {active > 0 && (
                <button type="button" className="btn btn--sm btn--quiet" onClick={clearAll}>
                  {t("filter.clear")}
                </button>
              )}
              <button type="button" className="btn btn--sm btn--gold" onClick={() => setOpen(false)}>
                {t("filter.done")}
              </button>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
