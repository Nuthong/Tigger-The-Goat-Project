import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { adminApi, catalog, ApiError } from "../lib/api";
import type { AdminReviewRow, ReviewStats, RoomType } from "../lib/types";
import { Alert, ChipBar, Pager, TableEmpty, TableSkeleton } from "../components/ui";
import { Stars, ratingWordKey } from "../components/Stars";
import { FilterPanel, type FilterField } from "../components/FilterPanel";
import { withFilter } from "../lib/filters";
import { bookingRef, fmtDate } from "../lib/format";
import { useT } from "../i18n/I18n";

const FILTERS = ["all", "5", "4", "3", "2", "1"] as const;
type Filter = (typeof FILTERS)[number];
const PAGE = 25;

export function Reviews() {
  const { t, lang } = useT();
  const [rows, setRows] = useState<AdminReviewRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<ReviewStats | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [offset, setOffset] = useState(0);
  const [reload, setReload] = useState(0);
  const [err, setErr] = useState("");
  const [adv, setAdv] = useState<Record<string, string>>({});
  const [types, setTypes] = useState<RoomType[]>([]);

  useEffect(() => {
    catalog.roomTypes().then(setTypes).catch(() => setTypes([]));
  }, []);

  // one filter per column (the star rating has the chip bar)
  const advFields: FilterField[] = [
    { type: "text", key: "comment", label: t("rv.colComment") },
    { type: "text", key: "guest", label: t("rv.colGuest") },
    {
      type: "select",
      key: "room_type_id",
      label: t("rv.colRoomType"),
      options: types.map((rt) => ({ value: String(rt.room_type_id), label: rt.name })),
    },
    { type: "text", key: "booking_ref", label: t("rv.colBooking"), placeholder: "TIG-00042" },
    { type: "date-range", label: t("rv.colDate"), from: "created_from", to: "created_to" },
  ];

  // a new star filter starts again from the first page
  useEffect(() => setOffset(0), [filter, adv]);

  useEffect(() => {
    setRows(null);
    setErr("");
    adminApi
      .reviews(
        { rating: filter === "all" ? undefined : Number(filter), limit: PAGE, offset },
        adv,
      )
      .then((p) => {
        setTotal(p.total);
        setRows(p.items);
      })
      .catch((e) => setErr(e instanceof ApiError ? e.message : t("common.failedToLoad")));
  }, [filter, offset, adv, reload, t]);

  // the header average and the star split are whole-board, not per-page
  useEffect(() => {
    adminApi
      .reviewStats()
      .then(setStats)
      .catch(() => setStats(null));
  }, []);

  const avg = stats ? Number(stats.average) : 0;
  const dist = stats
    ? ([5, 4, 3, 2, 1] as const).map((s) => ({
        s,
        n: stats[`r${s}` as "r5" | "r4" | "r3" | "r2" | "r1"],
      }))
    : [];

  return (
    <>
      <div className="admin__head">
        <div>
          <p className="eyebrow">{t("rv.eyebrow")}</p>
          <h1>{t("rv.title")}</h1>
        </div>
        {stats && stats.count > 0 && (
          <span className="row" style={{ gap: 10 }}>
            <Stars value={avg} showValue size={15} />
            <span className="muted" style={{ fontSize: 13 }}>
              {t(ratingWordKey(avg))} ·{" "}
              {t("rv.reviewCount", { n: stats.count.toLocaleString(), ns: stats.count > 1 ? "s" : "" })}
            </span>
          </span>
        )}
      </div>

      {stats && (
        <div className="reviews__dist" style={{ marginBottom: 18, maxWidth: 360 }}>
          {dist.map((d) => {
            const pct = stats.count ? (d.n / stats.count) * 100 : 0;
            return (
              <div key={d.s} className="reviews__distrow">
                <span>{t("rv.starLabel", { n: d.s })}</span>
                <span className="reviews__bar">
                  <span style={{ width: `${pct}%` }} />
                </span>
                <span style={{ textAlign: "right" }}>{d.n.toLocaleString()}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* the filters stay mounted while the table reloads - an open panel or a
          half-typed search must not vanish every time a filter changes */}
      <div className="row" style={{ gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <ChipBar
          options={FILTERS}
          value={filter}
          onChange={setFilter}
          label={(f) => (f === "all" ? t("status.all") : `${f}★`)}
        />
        <FilterPanel
          fields={advFields}
          values={adv}
          onChange={(k, v) => setAdv((a) => withFilter(a, k, v))}
          onClear={() => setAdv({})}
        />
        {rows && (
          <span className="muted" style={{ fontSize: 13 }}>
            {t("filter.rowsFound", { n: total.toLocaleString() })}
          </span>
        )}
      </div>

      {err && <Alert onRetry={() => setReload((r) => r + 1)}>{err}</Alert>}
      {!rows && !err && <TableSkeleton rows={7} cols={5} />}

      {rows && (
        <>

          <div className="panel">
            <div className="table-wrap">
              <table className="dtable">
                <thead>
                  <tr>
                    <th>{t("rv.colRating")}</th>
                    <th>{t("rv.colComment")}</th>
                    <th>{t("rv.colGuest")}</th>
                    <th>{t("rv.colRoomType")}</th>
                    <th>{t("rv.colBooking")}</th>
                    <th>{t("rv.colDate")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.review_id}>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <Stars value={r.rating} size={13} />
                      </td>
                      <td>{r.comment ?? <span className="muted">{t("rv.noComment")}</span>}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{r.customer_name}</td>
                      <td>{r.room_type ?? "-"}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <Link to={`/admin/bookings/${r.booking_id}`}>{bookingRef(r.booking_id)}</Link>
                      </td>
                      <td style={{ whiteSpace: "nowrap" }} className="tiny">
                        {fmtDate(r.created_at.slice(0, 10), lang)}
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <TableEmpty cols={6}>
                      {filter === "all" ? t("rv.noneAtAll") : t("rv.noneWithStars", { n: filter })}
                    </TableEmpty>
                  )}
                </tbody>
              </table>
            </div>
            <Pager offset={offset} limit={PAGE} total={total} onOffset={setOffset} />
          </div>
        </>
      )}
    </>
  );
}
