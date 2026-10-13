import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import {
  bookings as api,
  invoices as invoiceApi,
  ratePlans,
  services as servicesApi,
  ApiError,
} from "../lib/api";
import type { Bill, Booking, Invoice, Payment, Review, Service } from "../lib/types";
import { Alert, Field, Money, Spinner, StatusTag } from "../components/ui";
import { BackLink } from "../components/BackLink";
import { Stars } from "../components/Stars";
import { Steps } from "../components/Steps";
import { useToast } from "../components/ToastProvider";
import { useConfirm } from "../components/ConfirmDialog";
import { baht, bookingRef, fmtDate, fmtStay, nightsBetween } from "../lib/format";
import { toPositiveAmount, todayISO } from "../lib/validation";
import { addonCap, type StayShape } from "../lib/addons";
import { downloadIcs, stayIcs } from "../lib/ics";
import { HOTEL } from "../lib/hotel";
import { useT } from "../i18n/I18n";

export function BookingDetail() {
  const { id } = useParams();
  const bookingId = Number(id);
  const { isStaff, canFrontDesk, user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { t, lang } = useT();
  const inAdmin = useLocation().pathname.startsWith("/admin");
  const isNew = useSearchParams()[0].get("new") === "1";
  const backTo = inAdmin ? "/admin/bookings" : "/bookings";
  const backLabel = inAdmin ? t("detail.backLabelAdmin") : t("nav.account");

  const [booking, setBooking] = useState<Booking | null>(null);
  const [bill, setBill] = useState<Bill | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [datesOpen, setDatesOpen] = useState(false);
  const [dCi, setDCi] = useState("");
  const [dCo, setDCo] = useState("");
  const [dPreview, setDPreview] = useState<{ delta: number; newRoom: number } | null>(null);
  const [addons, setAddons] = useState<Service[]>([]);

  // the add-on catalog, for the desk to post charges to an open folio
  useEffect(() => {
    if (!canFrontDesk) return;
    servicesApi
      .list()
      .then(setAddons)
      .catch(() => setAddons([]));
  }, [canFrontDesk]);

  const load = useCallback(async () => {
    setErr("");
    try {
      const [b, bl] = await Promise.all([api.get(bookingId), api.bill(bookingId)]);
      setBooking(b);
      setBill(bl);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("detail.loadFailed"));
    }
    // an invoice may or may not exist yet - a 404 just means "not issued"
    try {
      setInvoice(await invoiceApi.forBooking(bookingId));
    } catch {
      setInvoice(null);
    }
    setReview(await api.getReview(bookingId));
  }, [bookingId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // preview the re-price when the date editor holds a valid new window
  useEffect(() => {
    setDPreview(null);
    if (!datesOpen || !booking || !dCi || !dCo || dCo <= dCi) return;
    if (dCi === booking.check_in_date.slice(0, 10) && dCo === booking.check_out_date.slice(0, 10))
      return;
    const rooms = booking.rooms;
    const currentNights = nightsBetween(booking.check_in_date, booking.check_out_date);
    const currentRoom = rooms.reduce((s, r) => s + Number(r.price_per_night) * currentNights, 0);
    let cancelled = false;
    const t = setTimeout(() => {
      Promise.all(rooms.map((r) => ratePlans.quote(r.room_type_id, dCi, dCo)))
        .then((qs) => {
          if (cancelled) return;
          const newRoom = qs.reduce((s, q) => s + Number(q.total), 0);
          setDPreview({ newRoom, delta: newRoom - currentRoom });
        })
        .catch(() => {
          if (!cancelled) setDPreview(null);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [datesOpen, dCi, dCo, booking]);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      await fn();
      setMsg(ok);
      toast.success(ok);
      await load();
    } catch (e) {
      const m = e instanceof ApiError ? e.message : t("detail.actionFailed");
      setErr(m);
      toast.error(m);
    } finally {
      setBusy(false);
    }
  }

  function checkIn() {
    void run(() => api.transition(bookingId, "check-in"), t("detail.checkedInMsg"));
  }

  async function cancelBooking() {
    if (!booking) return;
    const paidNow = Number(booking.amount_paid) - Number(booking.amount_refunded);
    const deadline = booking.free_cancellation_deadline
      ? new Date(booking.free_cancellation_deadline)
      : null;
    const free = deadline != null && deadline.getTime() > Date.now();
    const oneNight = booking.rooms.reduce((s, r) => s + Number(r.price_per_night), 0);
    const body =
      paidNow <= 0
        ? t("account.cancelNothingBody")
        : free
          ? t("account.cancelFreeBody", { amount: baht(paidNow, true) })
          : t("account.cancelFeeBody", {
              fee: baht(Math.min(oneNight, paidNow), true),
              refund: baht(Math.max(0, paidNow - oneNight), true),
            });
    if (
      !(await confirm({
        title: t("detail.cancelThisBookingTitle"),
        body,
        confirmLabel: t("account.cancelBookingBtn"),
        tone: "danger",
      }))
    ) {
      return;
    }
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const updated = await api.transition(bookingId, "cancel");
      const refunded = Number(updated.amount_refunded) - Number(booking.amount_refunded);
      const kept = Math.max(0, paidNow - refunded);
      const note =
        refunded > 0.004
          ? t("detail.cancelledRefundedMsg", { refunded: baht(refunded, true) }) +
            (kept > 0.004 ? t("detail.feeKeptSuffix", { fee: baht(kept, true) }) : ".")
          : t("detail.cancelledMsg");
      setMsg(note);
      toast.success(note);
      await load();
    } catch (e) {
      const m = e instanceof ApiError ? e.message : t("account.couldNotCancel");
      setErr(m);
      toast.error(m);
    } finally {
      setBusy(false);
    }
  }

  if (err && !booking) {
    return (
      <div className="page container section">
        <BackLink to={backTo} label={backLabel} />
        <div style={{ marginTop: 16 }}>
          <Alert onRetry={() => void load()}>{err}</Alert>
        </div>
      </div>
    );
  }
  if (!booking || !bill) {
    return (
      <div className="page container section">
        <Spinner />
      </div>
    );
  }

  const owned = user?.customer_id === booking.customer_id;
  const canCancel = ["pending", "confirmed"].includes(booking.status) && (isStaff || owned);
  const arrivalReached = booking.check_in_date.slice(0, 10) <= todayISO();
  const arrivalPast = booking.check_in_date.slice(0, 10) < todayISO();
  const canNoShow = isStaff && booking.status === "confirmed" && arrivalPast;
  const arrivalFuture = booking.check_in_date.slice(0, 10) > todayISO();
  const canReschedule =
    ["pending", "confirmed"].includes(booking.status) &&
    (isStaff || (owned && arrivalFuture));

  function openDates() {
    if (!booking) return;
    setDCi(booking.check_in_date.slice(0, 10));
    setDCo(booking.check_out_date.slice(0, 10));
    setDatesOpen(true);
  }
  async function saveDates() {
    if (!dCi || !dCo || dCo <= dCi) {
      setErr(t("search.badOrder"));
      return;
    }
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      await api.reschedule(bookingId, { check_in_date: dCi, check_out_date: dCo });
      const note = t("detail.datesChangedMsg");
      toast.success(note);
      setMsg(note);
      setDatesOpen(false);
      await load();
    } catch (e) {
      const m = e instanceof ApiError ? e.message : t("detail.couldNotChangeDates");
      setErr(m);
      toast.error(m);
    } finally {
      setBusy(false);
    }
  }
  const canCheckIn = isStaff && booking.status === "confirmed" && arrivalReached;
  const canCheckOut = isStaff && booking.status === "checked_in";
  const canPay =
    isStaff &&
    Number(bill.balance_due) > 0 &&
    ["confirmed", "checked_in", "checked_out"].includes(booking.status);
  // a guest settling their own still-unpaid reservation online
  const guestCanPay =
    owned &&
    !isStaff &&
    Number(bill.balance_due) > 0.004 &&
    ["pending", "confirmed"].includes(booking.status);
  const canReview = owned && booking.status === "checked_out" && !review;
  const canIssueInvoice =
    canFrontDesk &&
    !invoice &&
    ["checked_in", "checked_out"].includes(booking.status);
  // charges move only on an open folio that no live invoice has frozen (BR-16)
  const canEditCharges =
    canFrontDesk &&
    ["pending", "confirmed", "checked_in"].includes(booking.status) &&
    (!invoice || invoice.status === "void");

  async function removeCharge(serviceId: number, name: string) {
    if (
      !(await confirm({
        title: t("detail.removeChargeTitle", { name }),
        body: t("detail.removeChargeBody"),
        confirmLabel: t("detail.removeChargeBtn"),
        tone: "danger",
      }))
    ) {
      return;
    }
    void run(() => api.removeService(bookingId, serviceId), t("detail.chargeRemovedMsg"));
  }
  const hasActions =
    canCheckIn ||
    canCheckOut ||
    canCancel ||
    canPay ||
    canIssueInvoice ||
    canNoShow ||
    canReschedule;
  const nights = nightsBetween(booking.check_in_date, booking.check_out_date);

  return (
    <div className="page container section" style={{ maxWidth: 780 }}>
      {!inAdmin && <BackLink to={backTo} label={backLabel} />}

      {isNew && !inAdmin && booking.status !== "cancelled" && <Steps current={4} />}

      {isNew && booking.status !== "cancelled" && (
        <div className="banner" style={{ margin: "16px 0 4px" }}>
          <span aria-hidden>✓</span>
          <span>
            <strong>
              {inAdmin ? t("detail.bookingCreatedAdmin") : t("detail.bookingConfirmedGuest")}
            </strong>{" "}
            {t("detail.heldRoomFor", {
              ref: bookingRef(booking.booking_id),
              stay: fmtStay(booking.check_in_date, booking.check_out_date, lang),
            })}
          </span>
        </div>
      )}

      <div className="row" style={{ justifyContent: "space-between", marginTop: 16, gap: 16 }}>
        <div>
          <p className="eyebrow">
            {t("detail.bookingRefEyebrow", { ref: bookingRef(booking.booking_id) })}
          </p>
          <h1 style={{ fontSize: "clamp(28px, 4.2vw, 42px)" }}>
            {fmtStay(booking.check_in_date, booking.check_out_date, lang)}
          </h1>
          <p className="muted" style={{ marginTop: 8 }}>
            {t("search.nights", { n: nights, ns: nights > 1 ? "s" : "" })} ·{" "}
            {t("search.guests", {
              g: booking.num_guests,
              gs: booking.num_guests > 1 ? "s" : "",
            })}
            {isStaff ? ` · ${booking.customer_name}` : ""}
          </p>
        </div>
        <StatusTag status={booking.status} />
      </div>

      {msg && (
        <div style={{ marginTop: 16 }}>
          <Alert kind="ok">{msg}</Alert>
        </div>
      )}
      {err && (
        <div style={{ marginTop: 16 }}>
          <Alert>{err}</Alert>
        </div>
      )}

      {guestCanPay && (
        <div className="card" style={{ marginTop: 24 }}>
          <div
            className="row"
            style={{
              justifyContent: "space-between",
              alignItems: "center",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <div>
              <h3>{t("detail.paymentDue")}</h3>
              <p className="muted" style={{ marginTop: 6, fontSize: 14 }}>
                {t("detail.paymentDueBody", { amount: baht(bill.balance_due, true) })}
                {booking.hold_expires_at &&
                  new Date(booking.hold_expires_at).getTime() > Date.now() && (
                    <>
                      {" "}
                      {t("detail.holdReleasedAround", {
                        time: new Date(booking.hold_expires_at).toLocaleTimeString(undefined, {
                          hour: "2-digit",
                          minute: "2-digit",
                        }),
                      })}
                    </>
                  )}
              </p>
            </div>
            <Link to={`/book/pay/${bookingId}`} className="btn btn--gold">
              {t("account.completePayment")}
            </Link>
          </div>
        </div>
      )}

      <div className="grid grid-2" style={{ marginTop: 28, alignItems: "start" }}>
        <div className="card card--flat">
          <h3>{t("detail.rooms")}</h3>
          <table className="table" style={{ marginTop: 10 }}>
            <tbody>
              {booking.rooms.map((r) => (
                <tr key={r.room_id}>
                  <td>
                    <strong>{r.room_type}</strong>
                    <br />
                    <span className="tiny">{t("detail.roomNumber", { n: r.room_number })}</span>
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {baht(r.price_per_night)}
                    <br />
                    <span className="tiny">{t("detail.perNight")}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {(booking.services.length > 0 || canEditCharges) && (
            <>
              <h3 style={{ marginTop: 22 }}>{t("pay.extras")}</h3>
              <table className="table" style={{ marginTop: 10 }}>
                <tbody>
                  {booking.services.map((s) => (
                    <tr key={s.service_id}>
                      <td>
                        {s.service_name}
                        {s.quantity > 1 ? ` ×${s.quantity}` : ""}
                        <br />
                        <span className="tiny">
                          {t("detail.unitPrice", { price: baht(s.unit_price, true) })}
                        </span>
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        {baht(Number(s.unit_price) * s.quantity)}
                        {canEditCharges && (
                          <button
                            type="button"
                            className="linkbtn"
                            style={{ marginLeft: 10, color: "var(--danger)" }}
                            disabled={busy}
                            aria-label={t("detail.removeChargeTitle", { name: s.service_name })}
                            title={t("detail.removeChargeBtn")}
                            onClick={() => void removeCharge(s.service_id, s.service_name)}
                          >
                            ✕
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {booking.services.length === 0 && (
                    <tr>
                      <td className="muted" colSpan={2}>
                        {t("detail.noExtras")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              {canEditCharges && addons.length > 0 && (
                <ChargeForm
                  addons={addons}
                  stay={{
                    nights: nightsBetween(booking.check_in_date, booking.check_out_date),
                    rooms: booking.rooms.length,
                    guests: booking.num_guests,
                  }}
                  onFolio={Object.fromEntries(
                    booking.services.map((s) => [s.service_id, s.quantity]),
                  )}
                  busy={busy}
                  onAdd={(serviceId, qty) =>
                    run(
                      () => api.addService(bookingId, { service_id: serviceId, quantity: qty }),
                      t("detail.chargeAddedMsg"),
                    )
                  }
                />
              )}
              {canFrontDesk &&
                invoice &&
                invoice.status !== "void" &&
                ["pending", "confirmed", "checked_in"].includes(booking.status) && (
                  <p className="tiny" style={{ marginTop: 8 }}>
                    {t("detail.chargesFrozen")}
                  </p>
                )}
            </>
          )}
        </div>

        <div className="card card--flat">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
            <h3>{t("detail.bill")}</h3>
            {isStaff && (
              <Link
                to={`/print/folio/${bookingId}`}
                className="btn btn--sm btn--quiet"
              >
                {t("detail.printFolio")}
              </Link>
            )}
          </div>
          <table className="table" style={{ marginTop: 10 }}>
            <tbody>
              <tr>
                <td>{t("detail.roomsNights", { n: bill.nights, ns: bill.nights > 1 ? "s" : "" })}</td>
                <td style={{ textAlign: "right" }}>{baht(bill.room_total, true)}</td>
              </tr>
              <tr>
                <td>{t("pay.extras")}</td>
                <td style={{ textAlign: "right" }}>{baht(bill.service_total, true)}</td>
              </tr>
              <tr>
                <td>
                  <strong>{t("detail.total")}</strong>
                </td>
                <td style={{ textAlign: "right" }}>
                  <strong>{baht(bill.grand_total, true)}</strong>
                </td>
              </tr>
              <tr>
                <td className="muted">{t("detail.paid")}</td>
                <td className="muted" style={{ textAlign: "right" }}>
                  - {baht(bill.paid_total, true)}
                </td>
              </tr>
              {Number(bill.refunded_total) > 0.004 && (
                <tr>
                  <td className="muted">{t("detail.refunded")}</td>
                  <td className="muted" style={{ textAlign: "right" }}>
                    + {baht(bill.refunded_total, true)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div
            className="row"
            style={{
              justifyContent: "space-between",
              marginTop: 14,
              paddingTop: 14,
              borderTop: "1px solid var(--line)",
            }}
          >
            {booking.status === "cancelled" ? (
              <>
                <span className="muted">{t("detail.cancellationFeeKept")}</span>
                <Money
                  value={(Number(bill.paid_total) - Number(bill.refunded_total)).toFixed(2)}
                />
              </>
            ) : (
              <>
                <span className="muted">{t("detail.balanceDue")}</span>
                <Money value={bill.balance_due} />
              </>
            )}
          </div>
        </div>
      </div>

      {booking.payments.length > 0 && <PaymentLedger payments={booking.payments} />}

      {booking.note && (
        <div className="card card--flat" style={{ marginTop: 24 }}>
          <h3>{inAdmin ? t("detail.guestRequestsAdmin") : t("detail.yourRequestsGuest")}</h3>
          <p style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{booking.note}</p>
          {!inAdmin && (
            <p className="tiny" style={{ marginTop: 8 }}>
              {t("detail.requestsNote")}
            </p>
          )}
        </div>
      )}

      {!inAdmin && owned && ["confirmed", "checked_in"].includes(booking.status) && (
        <div className="card card--flat" style={{ marginTop: 24 }}>
          <div
            className="row"
            style={{
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <h3>{t("detail.beforeYouArrive")}</h3>
            <button
              className="btn btn--sm btn--quiet"
              onClick={() =>
                downloadIcs(
                  `${bookingRef(booking.booking_id)}.ics`,
                  stayIcs({
                    ref: bookingRef(booking.booking_id),
                    checkIn: booking.check_in_date,
                    checkOut: booking.check_out_date,
                    rooms: booking.rooms.map((r) => r.room_type).join(", ") || t("confirm.room"),
                  }),
                )
              }
            >
              {t("detail.addToCalendar")}
            </button>
          </div>
          <ul className="arrivelist" style={{ marginTop: 12 }}>
            <li>{t("detail.checkInFromTo", { from: HOTEL.checkInFrom, to: HOTEL.checkOutBy })}</li>
            <li>
              <strong>{t("detail.address")}</strong> {HOTEL.addressOneLine}
            </li>
            <li>
              <strong>{t("detail.frontDesk")}</strong> {HOTEL.phone} · {t("detail.open24h")}
            </li>
            <li>{t("detail.roomAssignedNote")}</li>
          </ul>
        </div>
      )}

      {invoice && (
        <div className="card card--flat" style={{ marginTop: 24 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <h3>{t("detail.invoiceHeading", { no: invoice.invoice_no })}</h3>
              <p className="tiny" style={{ marginTop: 4 }}>
                {t("detail.issuedOn", { date: invoice.issued_at.slice(0, 10) })}
                {invoice.issued_by_name ? ` · ${invoice.issued_by_name}` : ""} ·{" "}
                {t("detail.vatPct", { pct: (Number(invoice.tax_rate) * 100).toFixed(0) })}
              </p>
            </div>
            <div className="row" style={{ gap: 8 }}>
              {isStaff && (
                <Link
                  to={`/print/invoice/${invoice.invoice_id}`}
                  className="btn btn--sm btn--quiet"
                >
                  {t("detail.print")}
                </Link>
              )}
              <span className={`tag ${invoice.status === "void" ? "tag--danger" : "tag--info"}`}>
                {invoice.status}
              </span>
            </div>
          </div>
          <table className="table" style={{ marginTop: 10 }}>
            <tbody>
              {invoice.lines.map((l) => (
                <tr key={l.line_no}>
                  <td>{l.description}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{baht(l.amount, true)}</td>
                </tr>
              ))}
              <tr>
                <td><strong>{t("detail.totalInclVat")}</strong></td>
                <td style={{ textAlign: "right" }}><strong>{baht(invoice.total, true)}</strong></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {hasActions && (
        <div className="card" style={{ marginTop: 24 }}>
          <h3>{t("detail.actions")}</h3>
          <div className="row" style={{ marginTop: 14 }}>
            {isStaff && booking.status === "confirmed" && (
              <button
                className="btn btn--sm btn--gold"
                disabled={busy || !arrivalReached}
                title={
                  arrivalReached
                    ? undefined
                    : t("detail.checkInOpensOn", { date: fmtDate(booking.check_in_date, lang) })
                }
                onClick={checkIn}
              >
                {t("detail.checkInBtn")}
              </button>
            )}
            {canCheckOut && (
              <button
                className="btn btn--sm btn--gold"
                disabled={busy}
                onClick={() =>
                  run(() => api.transition(bookingId, "check-out"), t("detail.checkedOutMsg"))
                }
              >
                {t("detail.checkOutBtn")}
              </button>
            )}
            {canNoShow && (
              <button
                className="btn btn--sm btn--quiet"
                disabled={busy}
                title={t("detail.noShowTitle")}
                onClick={() =>
                  run(() => api.transition(bookingId, "no-show"), t("detail.noShowMsg"))
                }
              >
                {t("detail.noShowBtn")}
              </button>
            )}
            {canReschedule && !datesOpen && (
              <button className="btn btn--sm btn--quiet" disabled={busy} onClick={openDates}>
                {t("detail.changeDatesBtn")}
              </button>
            )}
            {canCancel && (
              <button
                className="btn btn--sm btn--danger"
                disabled={busy}
                onClick={cancelBooking}
              >
                {t("account.cancelBookingBtn")}
              </button>
            )}
            {canIssueInvoice && (
              <button
                className="btn btn--sm btn--gold"
                disabled={busy}
                onClick={() =>
                  run(() => invoiceApi.issue(bookingId), t("detail.invoiceIssuedMsg"))
                }
              >
                {t("detail.issueInvoiceBtn")}
              </button>
            )}
          </div>

          {datesOpen && (
            <div
              className="row"
              style={{ marginTop: 14, gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}
            >
              <Field
                label={t("detail.newCheckIn")}
                type="date"
                value={dCi}
                min={todayISO()}
                onChange={(e) => setDCi(e.target.value)}
              />
              <Field
                label={t("detail.newCheckOut")}
                type="date"
                value={dCo}
                min={dCi || todayISO()}
                onChange={(e) => setDCo(e.target.value)}
              />
              <button className="btn btn--sm btn--gold" disabled={busy} onClick={saveDates}>
                {t("detail.saveDatesBtn")}
              </button>
              <button
                className="btn btn--sm btn--quiet"
                disabled={busy}
                onClick={() => setDatesOpen(false)}
              >
                {t("account.cancelBtn")}
              </button>
              <p className="tiny" style={{ flexBasis: "100%", margin: 0 }}>
                {dPreview ? (
                  <>
                    {t("detail.newRoomCharge", { amount: baht(dPreview.newRoom, true) })}{" "}
                    {Math.abs(dPreview.delta) < 0.005
                      ? t("detail.sameAsNow")
                      : dPreview.delta > 0
                        ? t("detail.morePay", { amount: baht(dPreview.delta, true) })
                        : t("detail.refundedAmt", { amount: baht(-dPreview.delta, true) })}
                  </>
                ) : (
                  t("detail.samePriced")
                )}
              </p>
            </div>
          )}

          {canCancel && booking.free_cancellation_deadline && (
            <p className="tiny" style={{ marginTop: 10 }}>
              {new Date(booking.free_cancellation_deadline).getTime() > Date.now()
                ? t("detail.freeCancelUntilFull", {
                    date: fmtDate(booking.free_cancellation_deadline.slice(0, 10), lang),
                  })
                : t("detail.cancelNowKeepsFee")}
            </p>
          )}

          {canPay && (
            <PaymentForm
              due={bill.balance_due}
              busy={busy}
              onPay={(amount, method) =>
                run(() => api.pay(bookingId, { amount, method }), t("detail.paymentRecordedMsg"))
              }
            />
          )}
        </div>
      )}

      {canReview && (
        <div className="card" style={{ marginTop: 24 }}>
          <h3>{t("detail.howWasStay")}</h3>
          <p className="muted" style={{ marginTop: 6, fontSize: 14 }}>
            {t("detail.oneReviewPerStay")}
          </p>
          <ReviewForm
            busy={busy}
            onSend={(rating, comment) =>
              run(() => api.review(bookingId, { rating, comment }), t("detail.reviewThanksMsg"))
            }
          />
        </div>
      )}

      {review && (
        <div className="card card--flat" style={{ marginTop: 24 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
            <h3>{owned ? t("detail.yourReview") : t("detail.guestReview")}</h3>
            <Stars value={review.rating} size={16} showValue />
          </div>
          {review.comment && <p style={{ marginTop: 10 }}>{review.comment}</p>}
          <p className="tiny" style={{ marginTop: 8 }}>
            {t("detail.leftOn", { date: fmtDate(review.created_at.slice(0, 10), lang) })}
          </p>
        </div>
      )}
    </div>
  );
}

function PaymentForm({
  due,
  busy,
  onPay,
}: {
  due: string;
  busy: boolean;
  onPay: (amount: string, method: string) => void;
}) {
  const { t } = useT();
  const [amount, setAmount] = useState(due);
  const [method, setMethod] = useState("promptpay");
  const dueNum = Number(due);
  const parsed = toPositiveAmount(amount);
  const overpay = parsed != null && parsed > dueNum + 1e-9;
  const valid = parsed != null && !overpay;
  return (
    <div
      style={{
        marginTop: 20,
        paddingTop: 20,
        borderTop: "1px solid var(--line)",
        display: "flex",
        gap: 12,
        alignItems: "end",
        flexWrap: "wrap",
      }}
    >
      <Field
        label={t("detail.amount")}
        type="number"
        inputMode="decimal"
        min={0.01}
        max={dueNum}
        step={0.01}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        hint={
          overpay
            ? t("detail.cantExceedBalance", { amount: baht(due, true) })
            : t("detail.balanceDueAmount", { amount: baht(due, true) })
        }
      />
      <label className="field">
        <span>{t("detail.method")}</span>
        <select value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="cash">{t("detail.methodCash")}</option>
          <option value="credit_card">{t("detail.methodCard")}</option>
          <option value="bank_transfer">{t("detail.methodBankTransfer")}</option>
          <option value="promptpay">{t("pay.promptpayLabel")}</option>
        </select>
      </label>
      <button
        className="btn btn--sm btn--gold"
        disabled={busy || !valid}
        onClick={() => valid && onPay(String(parsed), method)}
      >
        {t("detail.recordPaymentBtn")}
      </button>
    </div>
  );
}

const METHOD_KEY: Record<string, string> = {
  cash: "detail.methodCash",
  credit_card: "detail.methodCard",
  bank_transfer: "detail.methodBankTransfer",
  promptpay: "pay.promptpayLabel",
};

const PAY_TONE: Record<string, string> = {
  paid: "tag--ok",
  refunded: "tag--info",
  pending: "tag--warn",
  failed: "tag--danger",
};

/** Every payment and refund on the stay (`payment`), oldest first. */
function PaymentLedger({ payments }: { payments: Payment[] }) {
  const { t, lang } = useT();
  return (
    <div className="card card--flat" style={{ marginTop: 24 }}>
      <h3>{t("detail.payments")}</h3>
      <div className="table-wrap">
        <table className="table" style={{ marginTop: 10 }}>
          <tbody>
            {payments.map((p) => (
              <tr key={p.payment_id}>
                <td>
                  {t(METHOD_KEY[p.method] ?? p.method)}
                  <br />
                  <span className="tiny">
                    {p.paid_at ? fmtDate(p.paid_at.slice(0, 10), lang) : t("detail.notYetPaid")}
                    {p.reference_no ? ` · ${p.reference_no}` : ""}
                  </span>
                </td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <span className={`tag ${PAY_TONE[p.status] ?? ""}`}>
                    {t(`detail.payStatus.${p.status}`)}
                  </span>
                  <br />
                  <span
                    style={{
                      color: p.status === "refunded" ? "var(--muted, #6b6b6b)" : undefined,
                      textDecoration: p.status === "failed" ? "line-through" : undefined,
                    }}
                  >
                    {p.status === "refunded" ? "- " : ""}
                    {baht(p.amount, true)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Post an add-on to the folio - pick a service and a quantity, up to what the
 *  stay still has room for (BR-29) after what is already on the folio. */
function ChargeForm({
  addons,
  stay,
  onFolio,
  busy,
  onAdd,
}: {
  addons: Service[];
  stay: StayShape;
  /** quantity already posted, per service_id */
  onFolio: Record<number, number>;
  busy: boolean;
  onAdd: (serviceId: number, quantity: number) => void;
}) {
  const { t } = useT();
  const [serviceId, setServiceId] = useState(String(addons[0]?.service_id ?? ""));
  // null = "the rest of the stay" - adding covers everything by default, and the
  // desk can type a smaller number (e.g. two mini-bar restocks actually used)
  const [typed, setTyped] = useState<string | null>(null);
  const picked = addons.find((a) => String(a.service_id) === serviceId);
  const left = picked
    ? Math.max(0, addonCap(picked.basis, stay) - (onFolio[picked.service_id] ?? 0))
    : 0;
  const qty = typed ?? String(left);
  const q = Math.floor(Number(qty));
  const valid = !!picked && Number.isFinite(q) && q >= 1 && q <= left;
  return (
    <div
      style={{
        marginTop: 14,
        paddingTop: 14,
        borderTop: "1px solid var(--line)",
        display: "flex",
        gap: 10,
        alignItems: "end",
        flexWrap: "wrap",
      }}
    >
      <label className="field" style={{ flex: "1 1 180px", margin: 0 }}>
        <span>{t("detail.addCharge")}</span>
        <select
          value={serviceId}
          onChange={(e) => {
            setServiceId(e.target.value);
            setTyped(null);
          }}
        >
          {addons.map((a) => (
            <option key={a.service_id} value={a.service_id}>
              {a.name} · {baht(a.price)}
            </option>
          ))}
        </select>
      </label>
      <label className="field" style={{ width: 80, margin: 0 }}>
        <span>{t("detail.qty")}</span>
        <input
          type="number"
          min={1}
          max={Math.max(left, 1)}
          value={qty}
          onChange={(e) => setTyped(e.target.value)}
        />
      </label>
      <button
        type="button"
        className="btn btn--sm btn--gold"
        disabled={busy || !valid}
        onClick={() => {
          if (!valid || !picked) return;
          onAdd(picked.service_id, q);
          setTyped(null);
        }}
      >
        {t("detail.addChargeBtn")}
      </button>
      {picked && (
        <p className="tiny muted" style={{ flexBasis: "100%", margin: 0 }}>
          {t(`addons.basis.${picked.basis}`)} ·{" "}
          {left > 0 ? t("addons.leftForStay", { n: left }) : t("addons.noneLeft")}
        </p>
      )}
    </div>
  );
}

function ReviewForm({
  busy,
  onSend,
}: {
  busy: boolean;
  onSend: (rating: number, comment: string) => void;
}) {
  const { t } = useT();
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  return (
    <div className="stack stack--tight" style={{ marginTop: 16, maxWidth: 460 }}>
      <label className="field">
        <span>{t("detail.rating")}</span>
        <select value={rating} onChange={(e) => setRating(Number(e.target.value))}>
          {[5, 4, 3, 2, 1].map((n) => (
            <option key={n} value={n}>
              {"★".repeat(n)}
              {"☆".repeat(5 - n)}
            </option>
          ))}
        </select>
      </label>
      <Field
        label={t("detail.comment")}
        placeholder={t("detail.commentPlaceholder")}
        maxLength={500}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      <div>
        <button className="btn btn--sm btn--gold" disabled={busy} onClick={() => onSend(rating, comment)}>
          {t("detail.submitReviewBtn")}
        </button>
      </div>
    </div>
  );
}
