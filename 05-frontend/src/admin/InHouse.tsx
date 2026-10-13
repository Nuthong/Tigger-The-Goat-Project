import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { catalog, reports, ApiError } from "../lib/api";
import type { InHouseRow } from "../lib/types";
import { Alert, KpiSkeleton, TableEmpty, TableSkeleton } from "../components/ui";
import { FilterPanel, type FilterField } from "../components/FilterPanel";
import { inNumRange, isOneOf, overlapsRange, textHas, withFilter } from "../lib/filters";
import { baht, bookingRef, fmtStay, nightsBetween } from "../lib/format";
import { todayISO } from "../lib/validation";
import { useT } from "../i18n/I18n";

/** The front desk's in-house list - every occupied room right now, soonest
 *  departure first (reads the `v_current_guests` view). */
export function InHouse() {
  const { t, lang } = useT();
  const [rows, setRows] = useState<InHouseRow[] | null>(null);
  const [totalRooms, setTotalRooms] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [adv, setAdv] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    setErr("");
    setRows(null);
    reports
      .inHouse()
      .then(setRows)
      .catch((e) => setErr(e instanceof ApiError ? e.message : t("common.failedToLoad")));
    catalog
      .rooms({ limit: 1 })
      .then((p) => setTotalRooms(p.total))
      .catch(() => setTotalRooms(null));
  }, [t]);

  useEffect(() => load(), [load]);

  const today = todayISO();
  // the view is one row per occupied room; a stay can hold several rooms
  const stays = new Map<number, InHouseRow>();
  (rows ?? []).forEach((r) => {
    if (!stays.has(r.booking_id)) stays.set(r.booking_id, r);
  });
  const stayList = [...stays.values()];
  const guests = stayList.reduce((s, r) => s + r.num_guests, 0);
  const departing = stayList.filter((r) => r.check_out_date.slice(0, 10) === today).length;
  const overdue = stayList.filter((r) => r.check_out_date.slice(0, 10) < today).length;
  const owed = stayList.reduce((s, r) => s + Math.max(0, Number(r.balance_due)), 0);
  const occupancy =
    rows && totalRooms ? Math.round((rows.length / totalRooms) * 1000) / 10 : null;

  // one filter per column; the list is small, so it is narrowed right here
  const advFields: FilterField[] = [
    { type: "text", key: "room", label: t("ih.colRoom"), placeholder: "305" },
    {
      type: "select",
      key: "room_type",
      label: t("filter.roomType"),
      options: [...new Set((rows ?? []).map((r) => r.room_type))]
        .sort()
        .map((n) => ({ value: n, label: n })),
    },
    { type: "text", key: "guest", label: t("ih.colGuest") },
    { type: "date-range", label: t("ba.colStay"), from: "stay_from", to: "stay_to" },
    {
      type: "select",
      key: "departure",
      label: t("ih.colNightsLeft"),
      options: [
        { value: "overdue", label: t("ih.overdue") },
        { value: "today", label: t("ih.departsToday") },
        { value: "later", label: t("ih.departsLater") },
      ],
    },
    { type: "number-range", label: t("ih.colGuests"), from: "min_guests", to: "max_guests", min: 1 },
    {
      type: "select",
      key: "balance",
      label: t("gd.colBalance"),
      options: [
        { value: "owing", label: t("filter.outstanding") },
        { value: "settled", label: t("ih.settled") },
      ],
    },
  ];

  const term = q.trim().toLowerCase();
  const shown = (rows ?? []).filter((r) => {
    const out = r.check_out_date.slice(0, 10);
    const departure = out < today ? "overdue" : out === today ? "today" : "later";
    const owing = Number(r.balance_due) > 0.004;
    return (
      (!term ||
        r.customer_name.toLowerCase().includes(term) ||
        r.room_number.toLowerCase().includes(term) ||
        bookingRef(r.booking_id).toLowerCase().includes(term)) &&
      textHas(r.room_number, adv.room) &&
      isOneOf(r.room_type, adv.room_type) &&
      (textHas(r.customer_name, adv.guest) || textHas(bookingRef(r.booking_id), adv.guest)) &&
      overlapsRange(r.check_in_date, r.check_out_date, adv.stay_from, adv.stay_to) &&
      isOneOf(departure, adv.departure) &&
      inNumRange(r.num_guests, adv.min_guests, adv.max_guests) &&
      (!adv.balance || (adv.balance === "owing") === owing)
    );
  });

  return (
    <>
      <div className="admin__head">
        <div>
          <p className="eyebrow">{t("ih.eyebrow")}</p>
          <h1>{t("ih.title")}</h1>
        </div>
        <span className="row">
          <input
            type="search"
            placeholder={t("ih.searchPlaceholder")}
            aria-label={t("ih.searchPlaceholder")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{
              padding: "6px 11px",
              border: "1px solid var(--p-line)",
              borderRadius: 8,
              font: "inherit",
              minWidth: 220,
            }}
          />
          <button className="btn btn--sm btn--quiet" onClick={load}>
            {t("ih.refresh")}
          </button>
        </span>
      </div>

      <div className="row" style={{ gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <FilterPanel
          fields={advFields}
          values={adv}
          onChange={(k, v) => setAdv((a) => withFilter(a, k, v))}
          onClear={() => setAdv({})}
        />
      </div>

      {err && <Alert onRetry={load}>{err}</Alert>}

      {!rows && !err && (
        <>
          <KpiSkeleton />
          <TableSkeleton rows={8} cols={7} />
        </>
      )}

      {rows && (
        <>
          <div className="kpi">
            <div className="kpi__card">
              <div className="kpi__label">{t("ih.kpiRooms")}</div>
              <div className="kpi__value">{rows.length}</div>
              <div className="kpi__sub">
                {occupancy != null
                  ? t("ih.kpiRoomsSub", { pct: occupancy.toFixed(1), total: totalRooms ?? 0 })
                  : t("ih.kpiRoomsSubPlain")}
              </div>
            </div>
            <div className="kpi__card">
              <div className="kpi__label">{t("ih.kpiGuests")}</div>
              <div className="kpi__value">{guests}</div>
              <div className="kpi__sub">{t("ih.kpiGuestsSub", { n: stayList.length })}</div>
            </div>
            <div className="kpi__card">
              <div className="kpi__label">{t("ih.kpiDeparting")}</div>
              <div className="kpi__value">{departing}</div>
              <div className="kpi__sub" style={overdue ? { color: "var(--p-danger)" } : undefined}>
                {overdue ? t("ih.kpiOverdueSub", { n: overdue }) : t("ih.kpiDepartingSub")}
              </div>
            </div>
            <div className="kpi__card">
              <div className="kpi__label">{t("ih.kpiOwed")}</div>
              <div className="kpi__value">{baht(owed)}</div>
              <div className="kpi__sub">{t("ih.kpiOwedSub")}</div>
            </div>
          </div>

          <div className="panel">
            <div className="panel__head">
              {t("ih.panel")}
              <span className="tiny">{t("ih.viewNote")}</span>
            </div>
            <div className="table-wrap">
              <table className="dtable">
                <thead>
                  <tr>
                    <th>{t("ih.colRoom")}</th>
                    <th>{t("ih.colGuest")}</th>
                    <th>{t("ba.colStay")}</th>
                    <th style={{ textAlign: "right" }}>{t("ih.colNightsLeft")}</th>
                    <th style={{ textAlign: "right" }}>{t("ih.colGuests")}</th>
                    <th style={{ textAlign: "right" }}>{t("gd.colBalance")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => {
                    const left = nightsBetween(today, r.check_out_date);
                    const out = r.check_out_date.slice(0, 10);
                    const departsToday = out === today;
                    const isOverdue = out < today;
                    return (
                      <tr key={`${r.booking_id}-${r.room_number}`}>
                        <td>
                          <strong>{r.room_number}</strong>
                          <br />
                          <span className="tiny">{r.room_type}</span>
                        </td>
                        <td>
                          {r.customer_name}
                          <br />
                          <span className="tiny">{bookingRef(r.booking_id)}</span>
                        </td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          {fmtStay(r.check_in_date, r.check_out_date, lang)}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          {isOverdue ? (
                            <span className="tag tag--danger">{t("ih.overdue")}</span>
                          ) : departsToday ? (
                            <span className="tag tag--warn">{t("ih.departsToday")}</span>
                          ) : (
                            left
                          )}
                        </td>
                        <td style={{ textAlign: "right" }}>{r.num_guests}</td>
                        <td style={{ textAlign: "right" }}>
                          {Number(r.balance_due) > 0.004 ? (
                            <span className="tag tag--warn">{baht(r.balance_due, true)}</span>
                          ) : (
                            <span className="tag tag--ok">{t("ih.settled")}</span>
                          )}
                        </td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          <Link to={`/admin/bookings/${r.booking_id}`}>{t("ih.open")}</Link>
                        </td>
                      </tr>
                    );
                  })}
                  {shown.length === 0 && (
                    <TableEmpty cols={7}>{rows.length === 0 ? t("ih.none") : t("ih.noneMatch")}</TableEmpty>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}
