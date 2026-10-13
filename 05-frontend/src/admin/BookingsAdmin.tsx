import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { bookings as api, catalog, ApiError } from "../lib/api";
import type { Booking, BookingStatus, RoomType } from "../lib/types";
import { Alert, ChipBar, Pager, StatusTag, TableEmpty, TableSkeleton } from "../components/ui";
import { Clock } from "../components/Clock";
import { FilterPanel, type FilterField } from "../components/FilterPanel";
import { withFilter } from "../lib/filters";
import { useToast } from "../components/ToastProvider";
import { useConfirm } from "../components/ConfirmDialog";
import { baht, bookingRef, fmtDate, fmtStay, nightsBetween } from "../lib/format";
import { todayISO } from "../lib/validation";
import { useT } from "../i18n/I18n";

const FILTERS = [
  "all", "arriving", "departing",
  "pending", "confirmed", "checked_in", "checked_out", "cancelled",
] as const;
type Filter = (typeof FILTERS)[number];
const PAGE = 25;

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

/** What the front desk needs to see at a glance about the money side. */
function PaymentCell({ b }: { b: Booking }) {
  const { t } = useT();
  if (b.status === "cancelled") {
    return Number(b.amount_refunded) > 0.004 ? (
      <span className="tiny">{t("ba.refundedBack", { amount: baht(b.amount_refunded) })}</span>
    ) : (
      <span className="muted">-</span>
    );
  }
  if (Number(b.balance_due) <= 0.004) return <span className="tag tag--ok">{t("ba.paid")}</span>;
  if (b.hold_expires_at) {
    const lapsed = new Date(b.hold_expires_at).getTime() < Date.now();
    return (
      <span className="tag tag--warn" title={t("ba.onlineHoldTitle")}>
        {lapsed ? t("ba.holdLapsed") : t("ba.holdUntil", { time: hhmm(b.hold_expires_at) })}
      </span>
    );
  }
  return (
    <span className="tag tag--warn" title={t("ba.unpaidTitle")}>
      {baht(b.balance_due)}
    </span>
  );
}

export function BookingsAdmin() {
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const { t, lang } = useT();
  const filterLabel = (f: Filter) =>
    f === "all"
      ? t("status.all")
      : f === "arriving"
        ? t("ba.filterArriving")
        : f === "departing"
          ? t("ba.filterDeparting")
          : t(`status.${f}`);
  const [items, setItems] = useState<Booking[] | null>(null);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<Filter>("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [err, setErr] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [types, setTypes] = useState<RoomType[]>([]);
  const [adv, setAdv] = useState<Record<string, string>>({});

  useEffect(() => {
    catalog.roomTypes().then(setTypes).catch(() => setTypes([]));
  }, []);

  // one filter per column (status has the chip bar above the table)
  const advFields: FilterField[] = [
    { type: "text", key: "ref", label: t("ba.colRef"), placeholder: "TIG-00042" },
    { type: "text", key: "guest", label: t("ba.colGuest") },
    { type: "date-range", label: t("ba.colStay"), from: "stay_from", to: "stay_to" },
    { type: "number-range", label: t("filter.nights"), from: "min_nights", to: "max_nights", min: 1 },
    { type: "number-range", label: t("filter.guests"), from: "min_guests", to: "max_guests", min: 1 },
    { type: "text", key: "room", label: t("ba.colRoom"), placeholder: "305" },
    {
      type: "select",
      key: "room_type_id",
      label: t("filter.roomType"),
      options: types.map((rt) => ({ value: String(rt.room_type_id), label: rt.name })),
    },
    {
      type: "select",
      key: "payment_status",
      label: t("ba.colPayment"),
      options: [
        { value: "unpaid", label: t("filter.unpaid") },
        { value: "paid", label: t("filter.paid") },
      ],
    },
  ];

  // debounce the search box so a query fires 300ms after typing stops
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // a new filter or search term starts again from the first page
  useEffect(() => setOffset(0), [filter, search, adv]);

  const load = useCallback(() => {
    setItems(null);
    setErr("");
    const today = todayISO();
    const p: {
      limit: number;
      offset: number;
      q?: string;
      arriving_on?: string;
      departing_on?: string;
    } = { limit: PAGE, offset };
    if (search) p.q = search;
    let statusArg: BookingStatus | undefined;
    if (filter === "arriving") p.arriving_on = today;
    else if (filter === "departing") p.departing_on = today;
    else if (filter !== "all") statusArg = filter as BookingStatus;
    // the panel's keys are the API's query params, so they go through as-is
    api
      .list(statusArg, p, adv)
      .then((res) => {
        setTotal(res.total);
        setItems(res.items);
      })
      .catch((e) => setErr(e instanceof ApiError ? e.message : t("common.failedToLoad")));
  }, [filter, search, offset, adv, t]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(b: Booking, action: "check-in" | "check-out" | "cancel" | "no-show") {
    const id = b.booking_id;
    if (action === "cancel" || action === "no-show") {
      const paid = Number(b.amount_paid) - Number(b.amount_refunded);
      const free =
        action === "cancel" &&
        b.free_cancellation_deadline != null &&
        new Date(b.free_cancellation_deadline).getTime() > Date.now();
      const oneNight = b.rooms.reduce((s, r) => s + Number(r.price_per_night), 0);
      const body =
        paid <= 0
          ? t("ba.releasedNothingPaid")
          : free
            ? t("ba.refundedFull", { amount: baht(paid, true) })
            : t("ba.feeKeptRefund", {
                fee: baht(Math.min(oneNight, paid), true),
                refund: baht(Math.max(0, paid - oneNight), true),
              });
      if (
        !(await confirm({
          title:
            action === "no-show"
              ? t("ba.markNoShowTitle", { ref: bookingRef(id) })
              : t("ba.cancelTitle", { ref: bookingRef(id) }),
          body,
          confirmLabel: action === "no-show" ? t("ba.markNoShowBtn") : t("account.cancelBookingBtn"),
          cancelLabel: t("account.cancelKeepIt"),
          tone: "danger",
        }))
      ) {
        return;
      }
    }
    setBusyId(id);
    setErr("");
    try {
      await api.transition(id, action);
      const ref = bookingRef(id);
      toast.success(
        action === "cancel"
          ? t("ba.cancelledMsg", { ref })
          : action === "no-show"
            ? t("ba.noShowMsg", { ref })
            : action === "check-in"
              ? t("ba.checkedInMsg", { ref })
              : t("ba.checkedOutMsg", { ref }),
      );
      load();
    } catch (e) {
      const m = e instanceof ApiError ? e.message : t("detail.actionFailed");
      setErr(m);
      toast.error(m);
    } finally {
      setBusyId(null);
    }
  }

  const shown = items ?? [];

  return (
    <>
      <div className="admin__head">
        <div>
          <p className="eyebrow">{t("ov.eyebrow")}</p>
          <h1>{t("ba.title")}</h1>
          <Clock />
        </div>
        <span className="row">
          <input
            type="search"
            placeholder={t("ba.searchPlaceholder")}
            aria-label={t("ba.searchAria")}
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              setOffset(0);
            }}
            style={{
              padding: "6px 11px",
              border: "1px solid var(--p-line)",
              borderRadius: 8,
              font: "inherit",
              minWidth: 210,
            }}
          />
          <span className="muted">
            {total} {search ? t("ba.found") : t("ba.totalWord")}
          </span>
          <button className="btn btn--sm btn--gold" onClick={() => navigate("/admin/bookings/new")}>
            {t("ba.newBooking")}
          </button>
        </span>
      </div>

      <div style={{ marginBottom: 18 }}>
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <ChipBar
            options={FILTERS}
            value={filter}
            onChange={(f) => {
              setFilter(f);
              setOffset(0);
            }}
            label={filterLabel}
          />
          <FilterPanel
            fields={advFields}
            values={adv}
            onChange={(k, v) => setAdv((a) => withFilter(a, k, v))}
            onClear={() => setAdv({})}
          />
        </div>
        {(filter === "arriving" || filter === "departing") && (
          <p className="tiny" style={{ marginTop: 8, color: "var(--p-ink-dim)" }}>
            {t(filter === "arriving" ? "ba.checkInsFor" : "ba.checkOutsFor", {
              date: fmtDate(todayISO(), lang),
            })}
          </p>
        )}
      </div>

      {err && <Alert>{err}</Alert>}
      {!items && !err && <TableSkeleton rows={8} cols={7} />}

      {items && (
        <div className="panel">
          <div className="table-wrap">
            <table className="dtable dtable--compact">
              <thead>
                <tr>
                  <th>{t("ba.colRef")}</th>
                  <th>{t("ba.colGuest")}</th>
                  <th>{t("ba.colStay")}</th>
                  <th>{t("ba.colRoom")}</th>
                  <th>{t("ov.colStatus")}</th>
                  <th>{t("ba.colPayment")}</th>
                  <th style={{ textAlign: "right" }}>{t("ba.colActions")}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((b) => {
                  const nights = nightsBetween(b.check_in_date, b.check_out_date);
                  const roomTotal = b.rooms.reduce(
                    (s, r) => s + Number(r.price_per_night) * nights,
                    0,
                  );
                  const notArrivedYet = b.check_in_date.slice(0, 10) > todayISO();
                  const arrivalPast = b.check_in_date.slice(0, 10) < todayISO();
                  return (
                    <tr key={b.booking_id}>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <Link to={`/admin/bookings/${b.booking_id}`}>
                          {bookingRef(b.booking_id)}
                        </Link>
                        {b.note && (
                          <span
                            className="reqflag"
                            title={t("ba.guestRequests", { note: b.note })}
                          >
                            {" "}
                            ✎
                          </span>
                        )}
                      </td>
                      <td>{b.customer_name}</td>
                      <td>
                        <span style={{ whiteSpace: "nowrap" }}>
                          {fmtStay(b.check_in_date, b.check_out_date, lang)}
                        </span>
                        <br />
                        <span className="tiny">
                          {t("ba.nightsPriceGuests", {
                            n: nights,
                            ns: nights > 1 ? "s" : "",
                            price: baht(roomTotal),
                            g: b.num_guests,
                            gs: b.num_guests > 1 ? "s" : "",
                          })}
                        </span>
                      </td>
                      <td>
                        {b.rooms.length === 0 ? (
                          <span className="muted">-</span>
                        ) : (
                          <>
                            <span style={{ whiteSpace: "nowrap" }}>
                              {b.rooms.map((r) => r.room_number).join(", ")}
                            </span>
                            <br />
                            <span className="tiny">{b.rooms[0].room_type}</span>
                          </>
                        )}
                      </td>
                      <td>
                        <StatusTag status={b.status} />
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <PaymentCell b={b} />
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        {b.status === "confirmed" && (
                          <button
                            className="btn btn--sm btn--gold"
                            disabled={busyId === b.booking_id || notArrivedYet}
                            title={
                              notArrivedYet
                                ? t("detail.checkInOpensOn", { date: fmtDate(b.check_in_date, lang) })
                                : undefined
                            }
                            onClick={() => act(b, "check-in")}
                          >
                            {t("detail.checkInBtn")}
                          </button>
                        )}
                        {b.status === "checked_in" && (
                          <button
                            className="btn btn--sm btn--gold"
                            disabled={busyId === b.booking_id}
                            onClick={() => act(b, "check-out")}
                          >
                            {t("detail.checkOutBtn")}
                          </button>
                        )}
                        {b.status === "confirmed" && arrivalPast && (
                          <button
                            className="btn btn--sm btn--quiet"
                            style={{ marginLeft: 6 }}
                            disabled={busyId === b.booking_id}
                            title={t("detail.noShowTitle")}
                            onClick={() => act(b, "no-show")}
                          >
                            {t("detail.noShowBtn")}
                          </button>
                        )}
                        {(b.status === "pending" || b.status === "confirmed") && (
                          <button
                            className="btn btn--sm btn--quiet"
                            style={{ marginLeft: 6 }}
                            disabled={busyId === b.booking_id}
                            onClick={() => act(b, "cancel")}
                          >
                            {t("account.cancelBtn")}
                          </button>
                        )}
                        {(b.status === "checked_out" || b.status === "cancelled") && (
                          <span className="tiny">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {shown.length === 0 && (
                  <TableEmpty cols={7}>
                    {search
                      ? t("ba.nothingMatches", { q: search })
                      : filter === "all"
                        ? t("ba.noBookingsYet")
                        : filter === "arriving"
                          ? t("ba.noArrivalsToday")
                          : filter === "departing"
                            ? t("ba.noDeparturesToday")
                            : t("ba.noneWithStatus", { status: filterLabel(filter) })}
                  </TableEmpty>
                )}
              </tbody>
            </table>
          </div>
          <Pager offset={offset} limit={PAGE} total={total} onOffset={setOffset} />
        </div>
      )}
    </>
  );
}
