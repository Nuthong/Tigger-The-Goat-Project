import { useEffect, useState } from "react";
import { reports, ApiError } from "../lib/api";
import type { RateCalRow } from "../lib/types";
import { Alert, Skeleton } from "../components/ui";
import { baht, fmtDate } from "../lib/format";
import { useT } from "../i18n/I18n";

const MONTH_KEY = () => new Date().toISOString().slice(0, 7);

/** A month grid of the effective nightly rate (`fn_quote_room`) per room type -
 *  shows at a glance where the rate plans lift or cut the list price. Shared by
 *  the Rate plans page and the Reports page. */
export function RateCalendar() {
  const { t, lang } = useT();
  const [month, setMonth] = useState(MONTH_KEY());
  const [rows, setRows] = useState<RateCalRow[] | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    setRows(null);
    setErr("");
    reports
      .rateCalendar(month)
      .then(setRows)
      .catch((e) => setErr(e instanceof ApiError ? e.message : t("common.failedToLoad")));
  }, [month, t]);

  const dayNums = rows?.[0]?.nights.map((n) => Number(n.date.slice(8, 10))) ?? [];
  const isWknd = (iso: string) => {
    const d = new Date(iso + "T00:00:00").getDay();
    return d === 0 || d === 6;
  };

  return (
    <div className="panel" style={{ marginTop: 24 }}>
      <div className="panel__head">
        {t("rc.title")}
        <input
          type="month"
          value={month}
          aria-label={t("rc.monthAria")}
          onChange={(e) => setMonth(e.target.value || MONTH_KEY())}
          style={{
            padding: "5px 9px",
            border: "1px solid var(--p-line)",
            borderRadius: 8,
            font: "inherit",
          }}
        />
      </div>
      {err && <Alert>{err}</Alert>}
      {!rows && !err && (
        <div style={{ padding: 16, display: "grid", gap: 10 }} role="status" aria-label="loading">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} h={12} w={`${88 - i * 6}%`} />
          ))}
        </div>
      )}
      {rows && (
        <div className="table-wrap">
          <table className="dtable" style={{ fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ position: "sticky", left: 0, background: "var(--p-surface)" }}>
                  {t("rp.colRoomType")}
                </th>
                {rows[0]?.nights.map((n) => (
                  <th
                    key={n.date}
                    style={{
                      textAlign: "right",
                      color: isWknd(n.date) ? "var(--p-gold)" : undefined,
                    }}
                  >
                    {Number(n.date.slice(8, 10))}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const base = Number(r.base_price_per_night);
                return (
                  <tr key={r.room_type_id}>
                    <td
                      style={{
                        whiteSpace: "nowrap",
                        position: "sticky",
                        left: 0,
                        background: "var(--p-surface)",
                      }}
                    >
                      {r.room_type_name}
                      <span className="tiny muted"> · {baht(base)}</span>
                    </td>
                    {r.nights.map((n) => {
                      const p = Number(n.price);
                      const bg =
                        p > base + 0.004
                          ? "rgba(156,122,60,0.16)"
                          : p < base - 0.004
                            ? "rgba(47,125,79,0.14)"
                            : undefined;
                      return (
                        <td
                          key={n.date}
                          style={{
                            textAlign: "right",
                            background: bg,
                            fontVariantNumeric: "tabular-nums",
                          }}
                          title={fmtDate(n.date, lang)}
                        >
                          {Math.round(p).toLocaleString("en-US")}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows && dayNums.length > 0 && (
        <p className="tiny" style={{ padding: "10px 14px", color: "var(--p-ink-dim)" }}>
          {t("rc.legend")}
        </p>
      )}
    </div>
  );
}
