import { useEffect, useState } from "react";
import { reports, ApiError } from "../lib/api";
import type { DailyRevenueRow } from "../lib/types";
import { Alert, TableSkeleton } from "../components/ui";
import { baht, fmtDate, fmtDayShort } from "../lib/format";
import { toCsv, downloadCsv } from "../lib/csv";
import { todayISO } from "../lib/validation";
import { fillNights, isoMinus } from "../lib/revenue";
import { useT } from "../i18n/I18n";

const RANGES = [7, 30, 90] as const;

/** Room revenue earned night by night (reads the `v_daily_revenue` view) -
 *  the accounting view of the stays actually slept, not bookings taken. */
export function DailyRevenue() {
  const { t, lang } = useT();
  const [range, setRange] = useState<number>(30);
  const [rows, setRows] = useState<DailyRevenueRow[] | null>(null);
  const [err, setErr] = useState("");
  const [hover, setHover] = useState<number | null>(null);

  const to = todayISO();
  const from = isoMinus(to, range - 1);

  useEffect(() => {
    setRows(null);
    setErr("");
    reports
      .dailyRevenue({ from, to })
      .then((r) => setRows(fillNights(r, from, to)))
      .catch((e) => setErr(e instanceof ApiError ? e.message : t("common.failedToLoad")));
  }, [from, to, t]);

  const total = (rows ?? []).reduce((s, r) => s + Number(r.room_revenue), 0);
  const nights = (rows ?? []).reduce((s, r) => s + r.room_nights, 0);
  const max = Math.max(1, ...(rows ?? []).map((r) => Number(r.room_revenue)));
  const focus = rows && hover != null ? rows[hover] : null;

  const exportCsv = () =>
    downloadCsv(
      `daily-revenue-${from}-to-${to}.csv`,
      toCsv(rows ?? [], [
        { header: "Night", value: (r) => r.stay_date },
        { header: "Bookings", value: (r) => r.bookings },
        { header: "Room-nights", value: (r) => r.room_nights },
        { header: "Room revenue", value: (r) => r.room_revenue },
      ]),
    );

  return (
    <div className="panel" style={{ marginTop: 24 }}>
      <div className="panel__head">
        {t("dr.title")}
        <span className="row">
          <select
            aria-label={t("dr.rangeAria")}
            value={range}
            onChange={(e) => {
              setHover(null);
              setRange(Number(e.target.value));
            }}
            style={{ padding: "5px 9px", border: "1px solid var(--p-line)", borderRadius: 8, font: "inherit" }}
          >
            {RANGES.map((n) => (
              <option key={n} value={n}>
                {t("dr.lastNights", { n })}
              </option>
            ))}
          </select>
          {rows && (
            <button className="btn btn--sm btn--quiet" onClick={exportCsv}>
              {t("ov.exportCsv")}
            </button>
          )}
        </span>
      </div>

      {err && (
        <div style={{ padding: 16 }}>
          <Alert>{err}</Alert>
        </div>
      )}
      {!rows && !err && <TableSkeleton rows={4} cols={4} />}

      {rows && (
        <div style={{ padding: "16px 20px 20px" }}>
          <div className="row" style={{ gap: 28, flexWrap: "wrap", marginBottom: 14 }}>
            <span>
              <span className="kpi__label">{t("dr.total")}</span>
              <br />
              <strong style={{ fontSize: 20 }}>{baht(total)}</strong>
            </span>
            <span>
              <span className="kpi__label">{t("dr.roomNights")}</span>
              <br />
              <strong style={{ fontSize: 20 }}>{nights.toLocaleString()}</strong>
            </span>
            <span>
              <span className="kpi__label">{t("dr.adr")}</span>
              <br />
              <strong style={{ fontSize: 20 }}>{nights ? baht(total / nights) : "-"}</strong>
            </span>
            <span className="tiny" style={{ marginLeft: "auto", alignSelf: "flex-end" }}>
              {focus
                ? t("dr.readout", {
                    date: fmtDate(focus.stay_date, lang),
                    amount: baht(focus.room_revenue),
                    n: focus.room_nights,
                  })
                : t("dr.hoverHint")}
            </span>
          </div>

          {total === 0 ? (
            <p className="muted" style={{ margin: "12px 0" }}>
              {t("dr.none")}
            </p>
          ) : (
            <>
              <div style={{ display: "flex", gap: 8 }}>
                <div
                  className="tiny"
                  aria-hidden
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    textAlign: "right",
                    minWidth: 48,
                  }}
                >
                  <span>{baht(max)}</span>
                  <span>฿0</span>
                </div>
                <div
                  role="img"
                  aria-label={t("dr.chartAria", { from: fmtDate(from, lang), to: fmtDate(to, lang), amount: baht(total) })}
                  onMouseLeave={() => setHover(null)}
                  style={{
                    flex: 1,
                    height: 150,
                    display: "flex",
                    alignItems: "flex-end",
                    gap: range > 60 ? 1 : 2,
                    borderBottom: "1px solid var(--p-line)",
                    backgroundImage:
                      "linear-gradient(to top, var(--p-line-soft) 1px, transparent 1px)",
                    backgroundSize: "100% 50%",
                  }}
                >
                  {rows.map((r, i) => {
                    const v = Number(r.room_revenue);
                    const h = v > 0 ? Math.max(2, (v / max) * 100) : 0;
                    return (
                      <div
                        key={r.stay_date}
                        onMouseEnter={() => setHover(i)}
                        title={`${fmtDate(r.stay_date, lang)} · ${baht(v)}`}
                        style={{ flex: 1, height: "100%", display: "flex", alignItems: "flex-end" }}
                      >
                        <div
                          style={{
                            width: "100%",
                            height: `${h}%`,
                            background: "var(--p-gold)",
                            opacity: hover == null || hover === i ? 1 : 0.45,
                            borderRadius: "4px 4px 0 0",
                            transition: "opacity 0.12s",
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
              <div
                className="tiny"
                aria-hidden
                style={{ display: "flex", justifyContent: "space-between", marginLeft: 56, marginTop: 6 }}
              >
                <span>{fmtDayShort(from, lang)}</span>
                <span>{fmtDayShort(to, lang)}</span>
              </div>
            </>
          )}

          <details style={{ marginTop: 14 }}>
            <summary className="tiny" style={{ cursor: "pointer" }}>
              {t("dr.showTable")}
            </summary>
            <div className="table-wrap" style={{ marginTop: 8 }}>
              <table className="dtable dtable--compact">
                <thead>
                  <tr>
                    <th>{t("ov.colNight")}</th>
                    <th style={{ textAlign: "right" }}>{t("dr.colBookings")}</th>
                    <th style={{ textAlign: "right" }}>{t("dr.roomNights")}</th>
                    <th style={{ textAlign: "right" }}>{t("dr.colRevenue")}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...rows].reverse().map((r) => (
                    <tr key={r.stay_date}>
                      <td style={{ whiteSpace: "nowrap" }}>{fmtDayShort(r.stay_date, lang)}</td>
                      <td style={{ textAlign: "right" }}>{r.bookings}</td>
                      <td style={{ textAlign: "right" }}>{r.room_nights}</td>
                      <td style={{ textAlign: "right" }}>{baht(r.room_revenue, true)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <p className="tiny" style={{ marginTop: 10 }}>
            {t("dr.note")}
          </p>
        </div>
      )}
    </div>
  );
}
