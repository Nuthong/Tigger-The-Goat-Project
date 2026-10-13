import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { bookings, ratePlans, services, ApiError } from "../lib/api";
import type { Quote, Service } from "../lib/types";
import { Alert, Field, Money, Spinner } from "../components/ui";
import { AddonPicker } from "../components/AddonPicker";
import { addonLines, addonsTotal, coverPicks, type AddonPicks } from "../lib/addons";
import { BackLink } from "../components/BackLink";
import { Steps } from "../components/Steps";
import { useToast } from "../components/ToastProvider";
import { baht, bookingRef, fmtDate, fmtStay, nightsBetween } from "../lib/format";
import { roomTagline } from "../lib/rooms";
import { clampInt } from "../lib/validation";
import { HOTEL } from "../lib/hotel";
import { useT } from "../i18n/I18n";

/** What `Search` hands over when the guest picks a room to book. */
export interface ReserveDraft {
  roomTypeId: number;
  roomTypeName: string;
  checkIn: string;
  checkOut: string;
  pricePerNight: string;
  maxOccupancy: number;
  availableCount: number;
  rooms: number;
  adults: number;
  kids: number;
}

const ADULT_OPTS = [1, 2, 3, 4, 5, 6];
const KID_OPTS = [0, 1, 2, 3, 4];

export function ConfirmReservation() {
  const draft = (useLocation().state ?? null) as ReserveDraft | null;
  const nav = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const { t, lang } = useT();

  const [quote, setQuote] = useState<Quote | null>(null);
  const [rooms, setRooms] = useState(String(draft?.rooms ?? 1));
  const [adults, setAdults] = useState(draft?.adults ?? 1);
  const [kids, setKids] = useState(draft?.kids ?? 0);
  const [requests, setRequests] = useState("");
  const [agree, setAgree] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [addonCatalog, setAddonCatalog] = useState<Service[]>([]);
  const [picks, setPicks] = useState<AddonPicks>({});

  useEffect(() => {
    services
      .list()
      .then(setAddonCatalog)
      .catch(() => setAddonCatalog([]));
  }, []);

  const draftKey = draft
    ? `${draft.roomTypeId}|${draft.checkIn}|${draft.checkOut}`
    : null;
  useEffect(() => {
    if (!draft) return;
    let live = true;
    ratePlans
      .quote(draft.roomTypeId, draft.checkIn, draft.checkOut)
      .then((q) => live && setQuote(q))
      .catch(() => live && setQuote(null));
    return () => {
      live = false;
    };
    // `draft` is a fresh object each render; `draftKey` is its stable identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  const n = draft ? nightsBetween(draft.checkIn, draft.checkOut) : 0;
  const qty = draft ? Math.max(1, Math.min(draft.availableCount, Number(rooms) || 1)) : 1;
  const capacity = draft ? draft.maxOccupancy * qty : 0;
  const guestsNum = adults + kids;
  // every room needs someone in it, and no room sleeps more than it can
  const tooFewGuests = guestsNum < qty;
  const guestsValid = guestsNum >= 1 && !tooFewGuests && guestsNum <= capacity;
  // what the extras are measured against (BR-29): breakfast per guest per
  // night, an extra bed per room per night, and so on
  const stay = useMemo(
    () => ({ nights: n, rooms: qty, guests: clampInt(guestsNum, 1, Math.max(capacity, 1)) }),
    [n, qty, guestsNum, capacity],
  );
  // every extra covers the whole stay: follow the dates / rooms / guests up and down
  useEffect(() => {
    setPicks((p) => coverPicks(addonCatalog, p, stay));
  }, [addonCatalog, stay]);

  const perNight = quote ? Number(quote.average_per_night) : Number(draft?.pricePerNight ?? 0);
  const roomTotal = useMemo(
    () => (quote ? Number(quote.total) : perNight * n) * qty,
    [quote, perNight, n, qty],
  );
  const extrasTotal = addonsTotal(addonCatalog, picks);
  const pickedLines = addonLines(picks)
    .map((l) => ({ ...l, svc: addonCatalog.find((s) => s.service_id === l.service_id) }))
    .filter((l) => l.svc);

  if (!draft) return <Navigate to="/book" replace />;

  async function confirm() {
    if (!guestsValid || !agree || busy) return;
    setBusy(true);
    setErr("");
    try {
      const b = await bookings.create({
        check_in_date: draft!.checkIn,
        check_out_date: draft!.checkOut,
        num_guests: clampInt(adults + kids, 1, capacity),
        note: requests.trim() || undefined,
        rooms: Array.from({ length: qty }, () => ({ room_type_id: draft!.roomTypeId })),
        services: addonLines(picks),
      });
      toast.success(t("confirm.roomHeld", { ref: bookingRef(b.booking_id) }));
      nav(`/book/pay/${b.booking_id}`, { replace: true });
    } catch (e) {
      const m = e instanceof ApiError ? e.message : t("confirm.couldNotConfirm");
      setErr(m);
      toast.error(m);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page container section" style={{ maxWidth: 1040 }}>
      <BackLink to="/book" label={t("confirm.back")} />
      <Steps current={2} />

      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", marginTop: 14 }}>
        <div>
          <p className="eyebrow">{t("nav.brand")}</p>
          <h1 style={{ fontSize: "clamp(28px, 4.4vw, 44px)" }}>{t("confirm.title")}</h1>
        </div>
      </div>

      {err && (
        <div style={{ marginTop: 16 }}>
          <Alert>{err}</Alert>
        </div>
      )}

      <div className="grid grid-2" style={{ marginTop: 24, alignItems: "start", gap: 28 }}>
        {/* ---- left: the stay ---- */}
        <div className="stack">
          <div className="card card--flat">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h3>{t("confirm.yourStay")}</h3>
              <Link className="link-arrow" to="/book">
                {t("confirm.edit")}
              </Link>
            </div>
            <table className="table" style={{ marginTop: 10 }}>
              <tbody>
                <tr>
                  <td className="muted">{t("confirm.room")}</td>
                  <td style={{ textAlign: "right" }}>
                    <strong>{draft.roomTypeName}</strong>
                    {roomTagline(draft.roomTypeId) ? (
                      <>
                        <br />
                        <span className="tiny">{roomTagline(draft.roomTypeId)}</span>
                      </>
                    ) : null}
                  </td>
                </tr>
                <tr>
                  <td className="muted">{t("confirm.dates")}</td>
                  <td style={{ textAlign: "right" }}>
                    {fmtStay(draft.checkIn, draft.checkOut, lang)}
                    <br />
                    <span className="tiny">
                      {t("search.nights", { n, ns: n > 1 ? "s" : "" })}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>

            <div className="stack stack--tight" style={{ marginTop: 16 }}>
              {draft.availableCount > 1 && (
                <Field
                  label={t("confirm.roomsMax", { n: draft.availableCount })}
                  type="number"
                  min={1}
                  max={draft.availableCount}
                  value={rooms}
                  onChange={(e) => setRooms(e.target.value)}
                />
              )}
              <div className="grid grid-2" style={{ gap: 14 }}>
                <label className="field">
                  <span>{t("search.adults")}</span>
                  <select value={adults} onChange={(e) => setAdults(Number(e.target.value))}>
                    {ADULT_OPTS.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>{t("search.children")}</span>
                  <select value={kids} onChange={(e) => setKids(Number(e.target.value))}>
                    {KID_OPTS.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="hint">
                {t("confirm.guestsLine", {
                  g: guestsNum,
                  gs: guestsNum > 1 ? "s" : "",
                  cap: capacity,
                  q: qty,
                  qs: qty > 1 ? "s" : "",
                })}
              </p>
              {!guestsValid && (
                <p className="tiny" style={{ color: "var(--danger)" }}>
                  {tooFewGuests
                    ? t("confirm.tooFewGuests", { q: qty })
                    : t("confirm.tooManyGuests", { q: qty, qs: qty > 1 ? "s" : "", cap: capacity })}
                </p>
              )}
            </div>
          </div>

          {addonCatalog.length > 0 && (
            <div className="card card--flat">
              <h3>{t("addons.title")}</h3>
              <p className="muted" style={{ marginTop: 6, fontSize: 14 }}>
                {t("addons.guestHint")}
              </p>
              <div style={{ marginTop: 10 }}>
                <AddonPicker
                  catalog={addonCatalog}
                  picks={picks}
                  stay={stay}
                  onChange={setPicks}
                  disabled={busy}
                />
              </div>
            </div>
          )}

          <div className="card card--flat">
            <h3>{t("confirm.guest")}</h3>
            <p className="muted" style={{ marginTop: 8, fontSize: 14 }}>
              {user
                ? t("confirm.bookingAs", { u: user.username, e: user.email })
                : t("confirm.signInToHold")}
            </p>
            <label className="field" style={{ marginTop: 14 }}>
              <span>{t("confirm.specialRequests")}</span>
              <textarea
                rows={3}
                maxLength={255}
                placeholder={t("confirm.requestsPlaceholder")}
                value={requests}
                onChange={(e) => setRequests(e.target.value)}
              />
              <span className="hint">{t("confirm.requestsHint")}</span>
            </label>

            <p className="tiny" style={{ marginTop: 12 }}>
              {t("confirm.freeCancelUntil", {
                date: fmtDate(
                  new Date(new Date(`${draft.checkIn}T00:00:00Z`).getTime() - 48 * 3600_000)
                    .toISOString()
                    .slice(0, 10),
                  lang,
                ),
              })}
            </p>
            <label className="row" style={{ gap: 8, marginTop: 14, alignItems: "flex-start" }}>
              <input
                type="checkbox"
                checked={agree}
                onChange={(e) => setAgree(e.target.checked)}
                style={{ marginTop: 3 }}
              />
              <span style={{ fontSize: 14 }}>{t("confirm.agree")}</span>
            </label>
          </div>
        </div>

        {/* ---- right: booking details ---- */}
        <div className="stack">
          <div className="card">
            <h3>{t("confirm.bookingDetails")}</h3>
            <table className="table" style={{ marginTop: 12 }}>
              <tbody>
                <tr>
                  <td>
                    {draft.roomTypeName}
                    <br />
                    <span className="tiny">
                      {t("confirm.perNight", { price: baht(perNight, true) })} ·{" "}
                      {t("search.nights", { n, ns: n > 1 ? "s" : "" })}
                      {qty > 1 ? ` · ${qty} ${t("search.room")}` : ""}
                    </span>
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{baht(roomTotal, true)}</td>
                </tr>
                {pickedLines.map((l) => (
                  <tr key={l.service_id}>
                    <td>
                      {l.svc!.name}
                      {l.quantity > 1 ? ` ×${l.quantity}` : ""}
                      <br />
                      <span className="tiny">{t("pay.extras")}</span>
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {baht(Number(l.svc!.price) * l.quantity, true)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {quote && quote.breakdown.length > 1 && (
              <details style={{ marginTop: 10 }}>
                <summary className="tiny" style={{ cursor: "pointer" }}>
                  {t("confirm.nightlyBreakdown")}
                </summary>
                <table className="table" style={{ marginTop: 8 }}>
                  <tbody>
                    {quote.breakdown.map((b) => (
                      <tr key={b.night}>
                        <td className="tiny">{fmtDate(b.night, lang)}</td>
                        <td className="tiny" style={{ textAlign: "right" }}>
                          {baht(b.price, true)}
                          {qty > 1 ? ` × ${qty}` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}

            <div
              className="row"
              style={{
                justifyContent: "space-between",
                marginTop: 16,
                paddingTop: 16,
                borderTop: "1px solid var(--line)",
              }}
            >
              <span className="muted">{t("confirm.totalAmount")}</span>
              <Money value={roomTotal + extrasTotal} />
            </div>
            <p className="tiny" style={{ marginTop: 6 }}>
              {extrasTotal > 0 ? t("addons.withExtrasNote") : t("confirm.roomChargesNote")}
            </p>

            <button
              className="btn btn--gold"
              style={{ marginTop: 18, width: "100%" }}
              disabled={busy || !guestsValid || !agree}
              onClick={confirm}
            >
              {busy ? <Spinner /> : t("confirm.continueToPayment")}
            </button>
          </div>

          <div className="card card--flat">
            <h3>{t("confirm.weCanHelp")}</h3>
            <p className="muted" style={{ marginTop: 8, fontSize: 14 }}>
              {t("confirm.helpText", { phone: HOTEL.phone })}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
