import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { bookings, catalog, customers, services, ApiError } from "../lib/api";
import type { AvailableRoomType, CustomerRow, Service } from "../lib/types";
import { Alert, Field, Spinner } from "../components/ui";
import { AddonPicker } from "../components/AddonPicker";
import { addonLines, addonsTotal, coverPicks, type AddonPicks } from "../lib/addons";
import { useToast } from "../components/ToastProvider";
import { clampInt, isPastDate, todayISO } from "../lib/validation";
import { useT } from "../i18n/I18n";

function isoPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function nights(a: string, b: string): number {
  return Math.max(0, Math.round((+new Date(b) - +new Date(a)) / 86_400_000));
}

export function NewBooking() {
  const nav = useNavigate();
  const toast = useToast();
  const { t } = useT();
  const [checkIn, setCheckIn] = useState(isoPlus(1));
  const [checkOut, setCheckOut] = useState(isoPlus(3));
  const [types, setTypes] = useState<AvailableRoomType[] | null>(null);
  const [typeId, setTypeId] = useState<number | null>(null);
  const [rooms, setRooms] = useState("1");
  const [guests, setGuests] = useState("2");

  const [q, setQ] = useState("");
  const [matches, setMatches] = useState<CustomerRow[]>([]);
  const [guest, setGuest] = useState<CustomerRow | null>(null);
  const [note, setNote] = useState("");

  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [addonCatalog, setAddonCatalog] = useState<Service[]>([]);
  const [picks, setPicks] = useState<AddonPicks>({});
  const n = nights(checkIn, checkOut);

  useEffect(() => {
    services
      .list()
      .then(setAddonCatalog)
      .catch(() => setAddonCatalog([]));
  }, []);
  const datesValid = n >= 1 && !isPastDate(checkIn);

  async function search(e: FormEvent) {
    e.preventDefault();
    if (!datesValid) {
      setErr(isPastDate(checkIn) ? t("search.badPastCheckIn") : t("search.badOrder"));
      return;
    }
    setErr("");
    setTypes(null);
    setTypeId(null);
    try {
      setTypes(await catalog.typeAvailability(checkIn, checkOut));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("search.failed"));
    }
  }

  useEffect(() => {
    if (guest || q.trim().length < 2) {
      setMatches([]);
      return;
    }
    const t = setTimeout(() => {
      customers.list({ q, limit: 6 }).then((p) => setMatches(p.items)).catch(() => setMatches([]));
    }, 200);
    return () => clearTimeout(t);
  }, [q, guest]);

  async function confirm() {
    if (!typeId || !guest || !picked || !guestsValid || !datesValid) return;
    setBusy(true);
    setErr("");
    try {
      const b = await bookings.create({
        customer_id: guest.customer_id,
        check_in_date: checkIn,
        check_out_date: checkOut,
        num_guests: clampInt(guests, 1, capacity),
        note: note.trim() || undefined,
        rooms: Array.from({ length: qty }, () => ({ room_type_id: typeId })),
        services: addonLines(picks),
      });
      toast.success(t("nb.bookingCreatedFor", { name: `${guest.first_name} ${guest.last_name}` }));
      nav(`/admin/bookings/${b.booking_id}?new=1`);
    } catch (e) {
      const m = e instanceof ApiError ? e.message : t("nb.couldNotCreate");
      setErr(m);
      toast.error(m);
    } finally {
      setBusy(false);
    }
  }

  const picked = types?.find((t) => t.room_type_id === typeId) ?? null;
  const qty = picked ? Math.max(1, Math.min(picked.available_count, Number(rooms) || 1)) : 1;
  const capacity = picked ? picked.max_occupancy * qty : 0;
  const extrasTotal = addonsTotal(addonCatalog, picks);
  const guestsNum = Number(guests);
  // at least one guest per room, and no more than the rooms sleep
  const guestsValid =
    Number.isFinite(guestsNum) &&
    guestsNum >= 1 &&
    (!picked || (guestsNum >= qty && guestsNum <= capacity));
  // extras are measured against the stay (BR-29) - breakfast per guest per night ...
  const stayGuests = clampInt(guests, 1, Math.max(capacity, 1));
  const stay = useMemo(() => ({ nights: n, rooms: qty, guests: stayGuests }), [n, qty, stayGuests]);
  useEffect(() => {
    setPicks((p) => coverPicks(addonCatalog, p, stay));
  }, [addonCatalog, stay]);

  return (
    <>
      <div className="admin__head">
        <div>
          <p className="eyebrow">{t("ov.eyebrow")}</p>
          <h1>{t("nb.title")}</h1>
        </div>
      </div>

      {err && <Alert>{err}</Alert>}

      {/* 1 - dates */}
      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="panel__head">{t("nb.step1Dates")}</div>
        <form
          style={{ padding: 20, display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 16, alignItems: "end" }}
          onSubmit={search}
        >
          <Field label={t("search.checkIn")} type="date" value={checkIn} min={todayISO()}
            onChange={(e) => setCheckIn(e.target.value)} />
          <Field label={t("search.checkOut")} type="date" value={checkOut} min={checkIn}
            onChange={(e) => setCheckOut(e.target.value)} />
          <button className="btn btn--gold" disabled={!datesValid}>{t("nb.findRoomsBtn")}</button>
        </form>
      </div>

      {/* 2 - room type */}
      {types && (
        <div className="panel" style={{ marginBottom: 20 }}>
          <div className="panel__head">
            {t("nb.step2RoomType", { n, ns: n > 1 ? "s" : "" })}
          </div>
          <div style={{ padding: 20 }}>
            {types.length === 0 ? (
              <p className="muted">{t("nb.nothingAvailable")}</p>
            ) : (
              <div className="stack stack--tight">
                {types.map((rt) => {
                  const out = rt.available_count < 1;
                  return (
                    <label
                      key={rt.room_type_id}
                      className="row"
                      aria-disabled={out || undefined}
                      style={{
                        justifyContent: "space-between",
                        cursor: out ? "not-allowed" : "pointer",
                        opacity: out ? 0.45 : 1,
                      }}
                    >
                      <span className="row" style={{ gap: 10 }}>
                        <input type="radio" name="rt" disabled={out}
                          checked={typeId === rt.room_type_id}
                          onChange={() => !out && setTypeId(rt.room_type_id)} />
                        <span>
                          <strong>{rt.name}</strong> · {t("nb.sleepsInline", { n: rt.max_occupancy })} ·{" "}
                          {out
                            ? t("nb.soldOutInline")
                            : t("search.leftCount", { n: rt.available_count })}
                        </span>
                      </span>
                      <span className="muted">
                        ฿{Number(rt.price_per_night).toLocaleString()} {t("rooms.perNight")}
                      </span>
                    </label>
                  );
                })}
                {types.every((rt) => rt.available_count < 1) && (
                  <p className="tiny" style={{ color: "var(--danger)" }}>
                    {t("nb.allSoldOut")}
                  </p>
                )}
                {picked && picked.available_count > 1 && (
                  <Field
                    label={t("confirm.roomsMax", { n: picked.available_count })}
                    type="number" min={1}
                    max={picked.available_count} value={rooms}
                    onChange={(e) => setRooms(e.target.value)} />
                )}
                <Field
                  label={t("nb.guestsLabel")}
                  type="number"
                  min={picked ? qty : 1}
                  max={capacity || undefined}
                  value={guests}
                  onChange={(e) => setGuests(e.target.value)}
                  hint={
                    picked
                      ? t("nb.sleepsUpTo", {
                          m: picked.max_occupancy,
                          cap: capacity,
                          q: qty,
                          qs: qty > 1 ? "s" : "",
                        })
                      : undefined
                  }
                />
                {picked && !guestsValid && (
                  <p className="tiny" style={{ color: "var(--danger)" }}>
                    {guestsNum < qty
                      ? t("confirm.tooFewGuests", { q: qty })
                      : t("nb.enterBetween", { n: capacity })}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 3 - guest */}
      {picked && (
        <div className="panel" style={{ marginBottom: 20 }}>
          <div className="panel__head">{t("nb.step3Guest")}</div>
          <div style={{ padding: 20 }}>
            {guest ? (
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span>{guest.first_name} {guest.last_name} · {guest.email}</span>
                <button className="btn btn--sm btn--quiet" onClick={() => { setGuest(null); setQ(""); }}>
                  {t("nb.changeBtn")}
                </button>
              </div>
            ) : (
              <>
                <Field label={t("nb.findGuest")} placeholder={t("nb.findGuestPlaceholder")}
                  value={q} onChange={(e) => setQ(e.target.value)} />
                {matches.length > 0 && (
                  <div className="stack stack--tight" style={{ marginTop: 10 }}>
                    {matches.map((m) => (
                      <button key={m.customer_id} className="btn btn--sm btn--quiet"
                        style={{ justifyContent: "flex-start" }}
                        onClick={() => setGuest(m)}>
                        {m.first_name} {m.last_name} · {m.email}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {picked && guest && addonCatalog.length > 0 && (
        <div className="panel" style={{ marginBottom: 20 }}>
          <div className="panel__head">
            {t("nb.step4Extras")}
            {extrasTotal > 0 && (
              <span className="tiny">
                {t("nb.extrasTotal", {
                  amount: `฿${extrasTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
                })}
              </span>
            )}
          </div>
          <div style={{ padding: "8px 20px 16px" }}>
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

      {picked && guest && (
        <label className="field" style={{ marginTop: 16, maxWidth: 460 }}>
          <span>{t("nb.notesLabel")}</span>
          <textarea
            rows={2}
            maxLength={255}
            placeholder={t("nb.notesPlaceholder")}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      )}

      {picked && guest && (
        <button
          className="btn btn--gold"
          style={{ marginTop: 14 }}
          disabled={busy || !guestsValid || !datesValid}
          onClick={confirm}
        >
          {busy ? (
            <Spinner />
          ) : (
            t("nb.confirmBtn", {
              amount: `฿${(Number(picked.price_per_night) * n * qty + extrasTotal).toLocaleString(
                "en-US",
                { minimumFractionDigits: 2 },
              )}`,
            })
          )}
        </button>
      )}
    </>
  );
}
