import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { bookings as bookingsApi, reports } from "../lib/api";
import type {
  Booking,
  BookingStatus,
  BookingStatusCounts,
  ForecastRow,
  OccupancyRow,
  RevenueRow,
} from "../lib/types";
import { Alert, KpiSkeleton, StatusTag, TableEmpty, TableSkeleton } from "../components/ui";
import { Donut, CHART_COLORS } from "../components/Donut";
import { baht, bookingRef, fmtDayShort, fmtStay } from "../lib/format";
import { toCsv, downloadCsv } from "../lib/csv";
import { useT } from "../i18n/I18n";

const STATUS_COLOR: Record<BookingStatus, string> = {
  pending: "#bf5b00",
  confirmed: "#9c7a3c",
  checked_in: "#1d8a4e",
  checked_out: "#6b5d49",
  cancelled: "#c02a2a",
};

/** A tight headline figure for the donut centre: ฿1.2M, ฿847k, ฿12,877k → ฿12.9M. */
function compactBaht(n: number): string {
  if (n >= 1_000_000) return `฿${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `฿${Math.round(n / 1_000).toLocaleString("en-US")}k`;
  return `฿${Math.round(n)}`;
}

const todayKey = () => new Date().toISOString().slice(0, 10);

const FORECAST_NIGHTS = 14;

const isWeekend = (iso: string) => {
  const dow = new Date(iso + "T00:00:00").getDay();
  return dow === 0 || dow === 6;
};

export function Overview() {
  const { t, lang } = useT();
  const [revenue, setRevenue] = useState<RevenueRow[] | null>(null);
  const [occ, setOcc] = useState<OccupancyRow[] | null>(null);
  const [inhouse, setInhouse] = useState<Booking[]>([]);
  const [arrList, setArrList] = useState<Booking[]>([]);
  const [counts, setCounts] = useState<BookingStatusCounts | null>(null);
  const [forecast, setForecast] = useState<ForecastRow[]>([]);
  const [arrivingToday, setArrivingToday] = useState(0);
  const [departingToday, setDepartingToday] = useState(0);
  const [err, setErr] = useState("");

  useEffect(() => {
    const today = todayKey();
    Promise.all([
      reports.revenueByRoomType(),
      reports.occupancy(),
      bookingsApi.list("checked_in", { limit: 200 }),
      bookingsApi.list(undefined, { arriving_on: today, limit: 200 }),
      bookingsApi.list(undefined, { departing_on: today, limit: 200 }),
      bookingsApi.statusCounts(),
      reports.forecast(FORECAST_NIGHTS),
    ])
      .then(([r, o, inh, arr, dep, sc, fc]) => {
        setRevenue(r);
        setOcc(o);
        setInhouse(inh.items);
        setArrList(arr.items);
        setCounts(sc);
        setForecast(fc);
        // arrivals still to walk in; departures still in the house
        setArrivingToday(
          arr.items.filter((x) => x.status === "confirmed" || x.status === "pending").length,
        );
        setDepartingToday(dep.items.filter((x) => x.status === "checked_in").length);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : t("common.failedToLoad")));
  }, [t]);

  const totalRevenue = revenue?.reduce((s, r) => s + Number(r.revenue), 0) ?? 0;
  // API returns occupancy oldest-first; the KPI + table want the newest month on top
  const occByNewest = [...(occ ?? [])].sort((a, b) => b.month.localeCompare(a.month));
  // the headline figure is the current month, not a stray far-future reservation;
  // fall back to the most recent month that has actually started
  const thisMonth = new Date().toISOString().slice(0, 7);
  const latestOcc =
    occByNewest.find((o) => o.month === thisMonth) ??
    occByNewest.find((o) => o.month <= thisMonth) ??
    occByNewest[0];
  // in-house guests first, then the day's expected arrivals
  const board = [
    ...inhouse,
    ...arrList
      .filter((b) => b.status === "confirmed" || b.status === "pending")
      .sort((a, b) => a.check_in_date.localeCompare(b.check_in_date)),
  ].slice(0, 8);

  const statusCounts: Record<string, number> = counts ?? {};
  const totalBookings = Object.values(statusCounts).reduce((s, n) => s + n, 0);

  const avgForecastOcc = forecast.length
    ? forecast.reduce((s, f) => s + f.occupancy_pct, 0) / forecast.length
    : 0;
  const onBooksTotal = forecast.reduce((s, f) => s + Number(f.revenue_on_books), 0);

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
      `forecast-on-the-books-${todayKey()}.csv`,
      toCsv(forecast, [
        { header: "Date", value: (f) => f.date },
        { header: "Rooms sold", value: (f) => f.rooms_sold },
        { header: "Rooms available", value: (f) => f.rooms_available },
        { header: "Occupancy %", value: (f) => f.occupancy_pct },
        { header: "Revenue on books", value: (f) => f.revenue_on_books },
        { header: "Arrivals", value: (f) => f.arrivals },
        { header: "Departures", value: (f) => f.departures },
      ]),
    );

  return (
    <>
      <div className="admin__head">
        <div>
          <p className="eyebrow">{t("ov.eyebrow")}</p>
          <h1>{t("ov.title")}</h1>
        </div>
      </div>

      {err && <Alert>{err}</Alert>}
      {!revenue && !err && (
        <>
          <KpiSkeleton />
          <div className="grid grid-2" style={{ marginTop: 20 }}>
            <TableSkeleton rows={5} cols={2} />
            <TableSkeleton rows={5} cols={2} />
          </div>
          <div style={{ marginTop: 20 }}>
            <TableSkeleton rows={8} cols={6} />
          </div>
        </>
      )}

      {revenue && occ && (
        <>
          <div className="kpi">
            <div className="kpi__card">
              <div className="kpi__label">{t("ov.inHouseNow")}</div>
              <div className="kpi__value">{inhouse.length}</div>
              <div className="kpi__sub">{t("ov.inHouseSub")}</div>
            </div>
            <div className="kpi__card">
              <div className="kpi__label">{t("ov.today")}</div>
              <div className="kpi__value">
                {t("ov.todayInOut", { arr: arrivingToday, dep: departingToday })}
              </div>
              <div className="kpi__sub">
                <Link to="/admin/bookings">{t("ov.todaySub")}</Link>
              </div>
            </div>
            <div className="kpi__card">
              <div className="kpi__label">{t("ov.revenue")}</div>
              <div className="kpi__value">{baht(totalRevenue)}</div>
              <div className="kpi__sub">{t("ov.revenueSub", { n: revenue.length })}</div>
            </div>
            <div className="kpi__card">
              <div className="kpi__label">{t("ov.latestOcc")}</div>
              <div className="kpi__value">
                {latestOcc ? `${latestOcc.occupancy_pct.toFixed(1)}%` : "-"}
              </div>
              <div className="kpi__sub">
                {latestOcc
                  ? `${latestOcc.month} · ADR ${baht(Number(latestOcc.adr))} · RevPAR ${baht(
                      Number(latestOcc.revpar),
                    )}`
                  : ""}
              </div>
            </div>
          </div>

          <div className="grid grid-2" style={{ marginTop: 20 }}>
            <div className="panel">
              <div className="panel__head">{t("ov.revenueByType")}</div>
              <div style={{ padding: 20 }}>
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
              </div>
            </div>

            <div className="panel">
              <div className="panel__head">{t("ov.bookingsByStatus")}</div>
              <div style={{ padding: 20 }}>
                <Donut
                  data={Object.entries(statusCounts)
                    .filter(([, n]) => n > 0)
                    .map(([s, n]) => ({
                      label: t(`status.${s}`),
                      value: n,
                      color: STATUS_COLOR[s as BookingStatus] ?? "#999",
                    }))}
                  centerValue={String(totalBookings)}
                  centerLabel={t("ov.bookings")}
                />
              </div>
            </div>
          </div>

          <div className="panel" style={{ marginTop: 20 }}>
            <div className="panel__head">
              {t("ov.arrivalsInHouse")}
              <Link to="/admin/bookings" className="link-arrow">
                {t("ov.allBookings")}
              </Link>
            </div>
            <div className="table-wrap">
              <table className="dtable">
                <thead>
                  <tr>
                    <th>{t("ov.colRef")}</th>
                    <th>{t("ov.colGuest")}</th>
                    <th>{t("ov.colStay")}</th>
                    <th>{t("ov.colRooms")}</th>
                    <th>{t("ov.colStatus")}</th>
                  </tr>
                </thead>
                <tbody>
                  {board.map((b) => (
                    <tr key={b.booking_id}>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <Link to={`/admin/bookings/${b.booking_id}`}>
                          {bookingRef(b.booking_id)}
                        </Link>
                      </td>
                      <td>{b.customer_name}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {fmtStay(b.check_in_date, b.check_out_date, lang)}
                      </td>
                      <td>
                        {b.rooms.map((r) => r.room_number).join(", ") || (
                          <span className="muted">-</span>
                        )}
                      </td>
                      <td>
                        <StatusTag status={b.status} />
                      </td>
                    </tr>
                  ))}
                  {board.length === 0 && <TableEmpty cols={5}>{t("ov.nothingScheduled")}</TableEmpty>}
                </tbody>
              </table>
            </div>
          </div>

          {forecast.length > 0 && (
            <div className="panel" style={{ marginTop: 20 }}>
              <div className="panel__head">
                {t("ov.nextNights", { n: forecast.length })}
                <span className="row">
                  <span className="muted">
                    {t("ov.avgCommitted", {
                      occ: avgForecastOcc.toFixed(0),
                      amount: baht(onBooksTotal),
                    })}
                  </span>
                  <button className="btn btn--sm btn--quiet" onClick={exportForecast}>
                    {t("ov.exportCsv")}
                  </button>
                </span>
              </div>
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
            </div>
          )}

          <div className="panel" style={{ marginTop: 20 }}>
            <div className="panel__head">
              {t("ov.monthlyYield")}
              <button className="btn btn--sm btn--quiet" onClick={exportOccupancy}>
                {t("ov.exportCsv")}
              </button>
            </div>
            <div className="table-wrap">
              <table className="dtable">
                <thead>
                  <tr>
                    <th>{t("ov.colMonth")}</th>
                    <th style={{ textAlign: "right" }}>{t("ov.colSold")}</th>
                    <th style={{ textAlign: "right" }}>{t("ov.colCapacity")}</th>
                    <th style={{ textAlign: "right" }}>{t("ov.colOccupancy")}</th>
                    <th style={{ textAlign: "right" }} title="Average daily rate">
                      {t("ov.colAdr")}
                    </th>
                    <th style={{ textAlign: "right" }} title="Revenue per available room">
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
          </div>
        </>
      )}
    </>
  );
}
