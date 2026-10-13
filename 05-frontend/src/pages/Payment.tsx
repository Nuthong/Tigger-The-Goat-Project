import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { bookings, ApiError } from "../lib/api";
import type { Bill, Booking } from "../lib/types";
import { Alert, Money, Spinner } from "../components/ui";
import { BackLink } from "../components/BackLink";
import { Steps } from "../components/Steps";
import { useToast } from "../components/ToastProvider";
import { baht, bookingRef, fmtStay, monthAbbr } from "../lib/format";
import { HOTEL } from "../lib/hotel";
import { useT } from "../i18n/I18n";

type Method = "credit_card" | "promptpay";
const METHODS: Method[] = ["credit_card", "promptpay"];

/** Live "room held for MM:SS" ticker. Renders nothing once the hold has lapsed. */
function HoldClock({ expiresAt, now }: { expiresAt: string; now: number }) {
  const { t } = useT();
  const msLeft = new Date(expiresAt).getTime() - now;
  if (msLeft <= 0) return null;
  const mins = Math.floor(msLeft / 60000);
  const secs = Math.floor((msLeft % 60000) / 1000);
  const urgent = msLeft < 5 * 60000;
  return (
    <span className={`holdclock${urgent ? " holdclock--urgent" : ""}`} role="timer">
      {t("pay.roomHeldFor", { mm: mins, ss: String(secs).padStart(2, "0") })}
    </span>
  );
}

export function Payment() {
  const { bookingId } = useParams();
  const id = Number(bookingId);
  const nav = useNavigate();
  const toast = useToast();
  const { t, lang } = useT();

  const [booking, setBooking] = useState<Booking | null>(null);
  const [bill, setBill] = useState<Bill | null>(null);
  const [method, setMethod] = useState<Method>("credit_card");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const [heldExpired, setHeldExpired] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (!Number.isFinite(id)) return;
    let live = true;
    Promise.all([bookings.get(id), bookings.bill(id)])
      .then(([b, bl]) => {
        if (!live) return;
        setBooking(b);
        setBill(bl);
      })
      .catch(
        (e) =>
          live &&
          setLoadErr(e instanceof ApiError ? e.message : t("pay.couldNotLoad")),
      );
    return () => {
      live = false;
    };
  }, [id, reloadKey, t]);

  const retryLoad = () => {
    setLoadErr("");
    setBooking(null);
    setBill(null);
    setReloadKey((k) => k + 1);
  };

  const due = bill ? Number(bill.balance_due) : 0;
  const settled = bill != null && due <= 0.004;
  const cancelled = booking?.status === "cancelled";
  const lapsed =
    heldExpired ||
    (!settled &&
      !cancelled &&
      booking?.hold_expires_at != null &&
      new Date(booking.hold_expires_at).getTime() <= now);

  if (!Number.isFinite(id)) return <Navigate to="/book" replace />;

  const ref = bookingRef(id);

  async function pay() {
    if (busy || !bill) return;
    setBusy(true);
    setErr("");
    const payRef = `${method === "promptpay" ? "PP" : "CARD"}-${Date.now()
      .toString(36)
      .toUpperCase()}`;
    try {
      await bookings.settle(id, { method, reference_no: payRef });
      toast.success(t("pay.received", { ref }));
      nav(`/bookings/${id}?new=1`, { replace: true });
    } catch (e) {
      const m = e instanceof ApiError ? e.message : t("pay.couldNotComplete");
      if (e instanceof ApiError && e.code === "hold_expired") setHeldExpired(true);
      setErr(m);
      toast.error(m);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page container section" style={{ maxWidth: 1040 }}>
      <BackLink to="/bookings" label={t("nav.account")} />
      <Steps current={3} />

      <p className="eyebrow" style={{ marginTop: 8 }}>
        {t("nav.brand")}
      </p>
      <h1 style={{ fontSize: "clamp(28px, 4.4vw, 44px)" }}>{t("pay.completeTitle")}</h1>
      <p className="lede" style={{ marginTop: 8 }}>
        {cancelled
          ? t("pay.ledeCancelled", { ref })
          : lapsed
            ? t("pay.ledeLapsed", { ref })
            : settled
              ? t("pay.ledeSettled", { ref })
              : t("pay.ledePending", { ref })}
      </p>

      {loadErr && (
        <div style={{ marginTop: 16 }}>
          <Alert onRetry={retryLoad}>{loadErr}</Alert>
        </div>
      )}
      {!booking && !loadErr && <Spinner />}

      {booking && bill && (
        <div className="grid grid-2" style={{ marginTop: 24, alignItems: "start", gap: 28 }}>
          {/* ---- left: what you're paying for ---- */}
          <div className="card card--flat">
            <h3>{t("pay.orderSummary")}</h3>
            <table className="table" style={{ marginTop: 10 }}>
              <tbody>
                <tr>
                  <td className="muted">{t("confirm.room")}</td>
                  <td style={{ textAlign: "right" }}>
                    <strong>
                      {booking.rooms.map((r) => r.room_type).join(", ") || t("confirm.room")}
                    </strong>
                    <br />
                    <span className="tiny">
                      {booking.rooms.length} {t("search.room")} ·{" "}
                      {t("search.guests", {
                        g: booking.num_guests,
                        gs: booking.num_guests > 1 ? "s" : "",
                      })}
                    </span>
                  </td>
                </tr>
                <tr>
                  <td className="muted">{t("confirm.dates")}</td>
                  <td style={{ textAlign: "right" }}>
                    {fmtStay(booking.check_in_date, booking.check_out_date, lang)}
                    <br />
                    <span className="tiny">
                      {t("search.nights", { n: bill.nights, ns: bill.nights > 1 ? "s" : "" })}
                    </span>
                  </td>
                </tr>
                <tr>
                  <td className="muted">{t("pay.roomCharges")}</td>
                  <td style={{ textAlign: "right" }}>{baht(bill.room_total, true)}</td>
                </tr>
                {Number(bill.service_total) > 0 && (
                  <tr>
                    <td className="muted">{t("pay.extras")}</td>
                    <td style={{ textAlign: "right" }}>{baht(bill.service_total, true)}</td>
                  </tr>
                )}
                {Number(bill.paid_total) > 0 && !settled && (
                  <tr>
                    <td className="muted">{t("pay.alreadyPaid")}</td>
                    <td style={{ textAlign: "right" }}>-{baht(bill.paid_total, true)}</td>
                  </tr>
                )}
              </tbody>
            </table>
            <div
              className="row"
              style={{
                justifyContent: "space-between",
                marginTop: 16,
                paddingTop: 16,
                borderTop: "1px solid var(--line)",
              }}
            >
              <span className="muted">
                {settled ? t("pay.paidInFull") : t("pay.balanceDueNow")}
              </span>
              <Money value={settled ? bill.grand_total : bill.balance_due} />
            </div>
          </div>

          {/* ---- right: how you're paying ---- */}
          <div className="stack">
            {cancelled ? (
              <div className="card">
                <h3>{t("pay.cancelledTitle")}</h3>
                <p className="muted" style={{ marginTop: 8, fontSize: 14 }}>
                  {t("pay.cancelledBody", { ref })}
                </p>
                <Link className="btn btn--gold" style={{ marginTop: 16, width: "100%" }} to="/book">
                  {t("pay.findRoom")}
                </Link>
              </div>
            ) : lapsed ? (
              <div className="card">
                <h3>{t("pay.lapsedTitle")}</h3>
                <p className="muted" style={{ marginTop: 8, fontSize: 14 }}>
                  {t("pay.lapsedBody", { ref })}
                </p>
                <Link className="btn btn--gold" style={{ marginTop: 16, width: "100%" }} to="/book">
                  {t("pay.findRoom")}
                </Link>
              </div>
            ) : settled ? (
              <div className="card">
                <h3>{t("pay.settledTitle")}</h3>
                <p className="muted" style={{ marginTop: 8, fontSize: 14 }}>
                  {t("pay.settledBody", { ref })}
                </p>
                <Link
                  className="btn btn--gold"
                  style={{ marginTop: 16, width: "100%" }}
                  to={`/bookings/${id}`}
                >
                  {t("pay.viewReservation")}
                </Link>
              </div>
            ) : (
              <div className="card">
                <div
                  className="row"
                  style={{ justifyContent: "space-between", alignItems: "baseline", gap: 12 }}
                >
                  <h3>{t("pay.chooseHowToPay")}</h3>
                  {booking.hold_expires_at && (
                    <HoldClock expiresAt={booking.hold_expires_at} now={now} />
                  )}
                </div>
                <div className="stack stack--tight" style={{ marginTop: 12 }}>
                  {METHODS.map((m) => (
                    <label key={m} className={`payopt ${method === m ? "is-on" : ""}`}>
                      <input
                        type="radio"
                        name="method"
                        checked={method === m}
                        onChange={() => setMethod(m)}
                      />
                      <span>
                        <strong>
                          {m === "promptpay" ? t("pay.promptpayLabel") : t("pay.cardLabel")}
                        </strong>
                        <br />
                        <span className="tiny">
                          {m === "promptpay" ? t("pay.promptpayBlurb") : t("pay.cardBlurb")}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>

                {method === "promptpay" && (
                  <div className="promptpay" aria-hidden="true">
                    <div className="promptpay__qr" />
                    <span className="tiny">{t("pay.demoQr")}</span>
                  </div>
                )}

                {err && (
                  <div style={{ marginTop: 14 }}>
                    <Alert>{err}</Alert>
                  </div>
                )}

                <button
                  className="btn btn--gold"
                  style={{ marginTop: 16, width: "100%" }}
                  disabled={busy}
                  onClick={pay}
                >
                  {busy ? (
                    <Spinner />
                  ) : (
                    t("pay.payNowBtn", { amount: baht(bill.balance_due, true) })
                  )}
                </button>
                <p className="tiny" style={{ marginTop: 8 }}>
                  {t("pay.demoNote")}
                  {booking.free_cancellation_deadline && (
                    <>
                      {" "}
                      {t("pay.freeCancelUntil", {
                        date: (() => {
                          const d = new Date(booking.free_cancellation_deadline);
                          return lang === "th"
                            ? `${d.getDate()} ${monthAbbr(d.getMonth(), "th")}`
                            : d.toLocaleDateString("en-US", { day: "numeric", month: "short" });
                        })(),
                      })}
                    </>
                  )}
                </p>
              </div>
            )}

            <div className="card card--flat">
              <p className="muted" style={{ fontSize: 14 }}>
                {t("pay.payAtHotel", { phone: HOTEL.phone })}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
