import { useEffect, useState } from "react";
import { reports } from "../lib/api";
import type { ForecastRow, OccupancyRow, RevenueRow } from "../lib/types";
import { Alert, TableSkeleton } from "../components/ui";
import { Donut, CHART_COLORS } from "../components/Donut";
import { baht, fmtDayShort } from "../lib/format";
import { toCsv, downloadCsv } from "../lib/csv";
import { RateCalendar } from "./RateCalendar";
import { useT } from "../i18n/I18n";

const todayKey = () => new Date().toISOString().slice(0, 10);

function compactBaht(n: number): string {
  if (n >= 1_000_000) return `฿${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `฿${Math.round(n / 1_000).toLocaleString("en-US")}k`;
  return `฿${Math.round(n)}`;
}

const isWeekend = (iso: string) => {
  const d = new Date(iso + "T00:00:00").getDay();
  return d === 0 || d === 6;
};

const HORIZONS = [14, 30, 60, 90] as const;

/** Management reporting hub - revenue mix, occupancy + yield history, the
 *  forward book, and the rate calendar, each exportable to CSV. */
export function Reports() {
  const { t, lang } = useT();
  const [revenue, setRevenue] = useState<RevenueRow[] | null>(null);
  const [occ, setOcc] = useState<OccupancyRow[] | null>(null);
  const [forecast, setForecast] = useState<ForecastRow[] | null>(null);
  const [days, setDays] = useState<number>(30);
  const [err, setErr] = useState("");

  useEffect(() => {
    Promise.all([reports.revenueByRoomType(), reports.occupancy()])
      .then(([r, o]) => {
        setRevenue(r);
        setOcc(o);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : t("common.failedToLoad")));
  }, [t]);

  useEffect(() => {
    setForecast(null);
    reports
      .forecast(days)
      .then(setForecast)
      .catch((e) => setErr(e instanceof Error ? e.message : t("common.failedToLoad")));
  }, [days, t]);

  const totalRevenue = revenue?.reduce((s, r) => s + Number(r.revenue), 0) ?? 0;
  const occByNewest = [...(occ ?? [])].sort((a, b) => b.month.localeCompare(a.month));
  const onBooksTotal = (forecast ?? []).reduce((s, f) => s + Number(f.revenue_on_books), 0);
  const avgOcc = forecast?.length
    ? forecast.reduce((s, f) => s + f.occupancy_pct, 0) / forecast.length
    : 0;

  const exportOccupancy = () =>
    downloadCsv(
      `occupancy-yield-${todayKey()}.csv`,
      toCsv(occByNewest, [
        { header: "Month", value: (o) => o.month },
        { header: "Room-nights sold", value: (o) => o.room_nights_sold },
        { header: "Room-nights capacity", value: (o) => o.room_nights_capacity },
        { header: "Occupancy %", value: (o) => o.occupancy_pct },
        { header: "ADR", value: (o) => o.adr },
        { header: "RevPAR", value: (o) => o.revpar },
      ]),
    );

  const exportForecast = () =>
    downloadCsv(
      `forecast-${days}d-${todayKey()}.csv`,
      toCsv(forecast ?? [], [
        { header: "Date", value: (f) => f.date },
        { header: "Rooms sold", value: (f) => f.rooms_sold },
        { header: "Rooms available", value: (f) => f.rooms_available },
        { header: "Occupancy %", value: (f) => f.occupancy_pct },
        { header: "Revenue on books", value: (f) => f.revenue_on_books },
        { header: "Arrivals", value: (f) => f.arrivals },
        { header: "Departures", value: (f) => f.departures },
      ]),
    );

  const exportRevenue = () =>
    downloadCsv(
      `revenue-by-room-type-${todayKey()}.csv`,
      toCsv(revenue ?? [], [
        { header: "Room type", value: (r) => r.room_type },
        { header: "Bookings", value: (r) => r.booking_count },
        { header: "Room-nights", value: (r) => r.total_room_nights },
        { header: "Revenue", value: (r) => r.revenue },
      ]),
    );

  return (
    <>
      <div className="admin__head">
        <div>
          <p className="eyebrow">{t("rp.eyebrow")}</p>
          <h1>{t("rpt.title")}</h1>
        </div>
      </div>

      {err && <Alert>{err}</Alert>}

      <div className="grid grid-2" style={{ marginTop: 4 }}>
        <div className="panel">
          <div className="panel__head">
            {t("ov.revenueByType")}
            {revenue && (
              <button className="btn btn--sm btn--quiet" onClick={exportRevenue}>
                {t("ov.exportCsv")}
              </button>
            )}
          </div>
          <div style={{ padding: 20 }}>
            {!revenue && !err && <TableSkeleton rows={5} cols={2} />}
            {revenue && (
              <Donut
                data={revenue.map((r, i) => ({
                  label: r.room_type,
                  value: Number(r.revenue),
                  color: CHART_COLORS[i % CHART_COLORS.length],
                }))}
                centerValue={compactBaht(totalRevenue)}
                centerLabel={t("ov.total")}
                formatValue={(n) => baht(n)}
              />
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel__head">
            {t("ov.monthlyYield")}
            {occ && (
              <button className="btn btn--sm btn--quiet" onClick={exportOccupancy}>
                {t("ov.exportCsv")}
              </button>
            )}
          </div>
          {!occ && !err && <TableSkeleton rows={8} cols={6} />}
          {occ && (
            <div className="table-wrap">
              <table className="dtable">
                <thead>
                  <tr>
                    <th>{t("ov.colMonth")}</th>
                    <th style={{ textAlign: "right" }}>{t("ov.colSold")}</th>
                    <th style={{ textAlign: "right" }}>{t("rpt.colCap")}</th>
                    <th style={{ textAlign: "right" }}>{t("rpt.colOcc")}</th>
                    <th style={{ textAlign: "right" }} title={t("rpt.adrTitle")}>
                      {t("ov.colAdr")}
                    </th>
                    <th style={{ textAlign: "right" }} title={t("rpt.revparTitle")}>
                      {t("ov.colRevpar")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {occByNewest.map((o) => (
                    <tr key={o.month}>
                      <td>{o.month}</td>
                      <td style={{ textAlign: "right" }}>{o.room_nights_sold}</td>
                      <td style={{ textAlign: "right" }}>{o.room_nights_capacity}</td>
                      <td style={{ textAlign: "right" }}>{o.occupancy_pct.toFixed(1)}%</td>
                      <td style={{ textAlign: "right" }}>{baht(Number(o.adr))}</td>
                      <td style={{ textAlign: "right" }}>{baht(Number(o.revpar))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="panel" style={{ marginTop: 24 }}>
        <div className="panel__head">
          {t("ov.colOnBooks")}
          <span className="row">
            {forecast && (
              <span className="muted">
                {t("ov.avgCommitted", { occ: avgOcc.toFixed(0), amount: baht(onBooksTotal) })}
              </span>
            )}
            <select
              aria-label={t("rpt.forecastHorizonAria")}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              style={{
                padding: "5px 9px",
                border: "1px solid var(--p-line)",
                borderRadius: 8,
                font: "inherit",
              }}
            >
              {HORIZONS.map((h) => (
                <option key={h} value={h}>
                  {t("rpt.nextNightsOption", { h })}
                </option>
              ))}
            </select>
            {forecast && (
              <button className="btn btn--sm btn--quiet" onClick={exportForecast}>
                {t("ov.exportCsv")}
              </button>
            )}
          </span>
        </div>
        {!forecast && !err && <TableSkeleton rows={10} cols={6} />}
        {forecast && (
          <div className="table-wrap">
            <table className="dtable">
              <thead>
                <tr>
                  <th>{t("ov.colNight")}</th>
                  <th style={{ textAlign: "right" }}>{t("ov.colArr")}</th>
                  <th style={{ textAlign: "right" }}>{t("ov.colDep")}</th>
                  <th style={{ textAlign: "right" }}>{t("ov.colSold")}</th>
                  <th>{t("ov.colOccupancy")}</th>
                  <th style={{ textAlign: "right" }}>{t("ov.colOnBooks")}</th>
                </tr>
              </thead>
              <tbody>
                {forecast.map((f) => {
                  const pct = Math.min(100, Math.max(0, f.occupancy_pct));
                  return (
                    <tr
                      key={f.date}
                      style={
                        isWeekend(f.date) ? { background: "var(--p-line-soft)" } : undefined
                      }
                    >
                      <td style={{ whiteSpace: "nowrap" }}>{fmtDayShort(f.date, lang)}</td>
                      <td style={{ textAlign: "right" }}>{f.arrivals || ""}</td>
                      <td style={{ textAlign: "right" }}>{f.departures || ""}</td>
                      <td style={{ textAlign: "right" }}>
                        {f.rooms_sold}
                        <span className="tiny muted"> / {f.rooms_available}</span>
                      </td>
                      <td style={{ minWidth: 96 }}>
                        <div
                          style={{
                            background: `linear-gradient(90deg, var(--p-gold-soft) ${pct}%, transparent ${pct}%)`,
                            borderRadius: 4,
                            padding: "2px 7px",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {f.occupancy_pct.toFixed(0)}%
                        </div>
                      </td>
                      <td style={{ textAlign: "right" }}>{baht(Number(f.revenue_on_books))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <RateCalendar />
    </>
  );
}
