import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { catalog, ApiError } from "../lib/api";
import type { AvailableRoomType, RoomType } from "../lib/types";
import type { ReserveDraft } from "./ConfirmReservation";
import { Alert, CardsSkeleton, EmptyState, Field, Money, Spinner } from "../components/ui";
import { Reveal } from "../components/Reveal";
import { Steps } from "../components/Steps";
import { Photo } from "../components/Photo";
import { roomPhoto, roomTagline, roomFacts, slugify, type RoomView } from "../lib/rooms";
import { isPastDate, slideStay, todayISO } from "../lib/validation";
import { useT } from "../i18n/I18n";

type ViewFilter = "Any" | RoomView;
type Sort = "price-asc" | "price-desc" | "rating" | "popular";
const VIEWS: ViewFilter[] = ["Any", "City", "Park", "Skyline"];
const VIEW_KEY: Record<ViewFilter, string> = {
  Any: "search.viewAny",
  City: "search.viewCity",
  Park: "search.viewPark",
  Skyline: "search.viewSkyline",
};
const SORTS: Sort[] = ["price-asc", "price-desc", "rating", "popular"];
const SORT_KEY: Record<Sort, string> = {
  "price-asc": "search.sortPriceAsc",
  "price-desc": "search.sortPriceDesc",
  rating: "search.sortRating",
  popular: "search.sortPopular",
};
const ADULT_OPTS = [1, 2, 3, 4, 5, 6];
const KID_OPTS = [0, 1, 2, 3, 4];

function isoPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function nights(a: string, b: string): number {
  return Math.max(0, Math.round((+new Date(b) - +new Date(a)) / 86_400_000));
}
function toNum(v: string | number | null): number {
  const n = typeof v === "string" ? Number(v) : (v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function Search() {
  const { user } = useAuth();
  const { t } = useT();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const roomTypeId = Number(params.get("rt")) || null;

  const [checkIn, setCheckIn] = useState(isoPlus(1));
  const [checkOut, setCheckOut] = useState(isoPlus(3));
  const [adults, setAdults] = useState(1);
  const [kids, setKids] = useState(0);
  const [view, setView] = useState<ViewFilter>("Any");
  const [sort, setSort] = useState<Sort>("price-asc");
  const [catalogTypes, setCatalogTypes] = useState<RoomType[]>([]);
  const [types, setTypes] = useState<AvailableRoomType[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const n = nights(checkIn, checkOut);
  const datesValid = n >= 1 && !isPastDate(checkIn);
  const guests = adults + kids;

  // the room-type dropdown is populated straight away, before any search runs
  useEffect(() => {
    catalog.roomTypes().then(setCatalogTypes).catch(() => setCatalogTypes([]));
  }, []);

  const run = useCallback(async () => {
    if (!datesValid) {
      setErr(isPastDate(checkIn) ? t("search.badPastCheckIn") : t("search.badOrder"));
      setTypes(null);
      return;
    }
    setErr("");
    setBusy(true);
    try {
      setTypes(await catalog.typeAvailability(checkIn, checkOut));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("search.failed"));
    } finally {
      setBusy(false);
    }
  }, [checkIn, checkOut, datesValid, t]);

  // rooms show as soon as you land, and refresh when the dates change - no button press
  useEffect(() => {
    const t = setTimeout(() => void run(), 300);
    return () => clearTimeout(t);
  }, [run]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void run();
  }

  function pickRoomType(id: number | null) {
    if (id) params.set("rt", String(id));
    else params.delete("rt");
    setParams(params, { replace: true });
  }

  /** Jump the whole window forward (or back), clamped so check-in never lands in
   *  the past. Used by the "no availability" nudges. */
  function shiftWindow(days: number) {
    const w = slideStay(checkIn, checkOut, days);
    setCheckIn(w.checkIn);
    setCheckOut(w.checkOut);
  }

  const filtersNarrowed = view !== "Any" || roomTypeId != null;
  function clearFilters() {
    setView("Any");
    pickRoomType(null);
  }

  const visible = useMemo(() => {
    const list = (types ?? []).filter((t) => {
      if (roomTypeId && t.room_type_id !== roomTypeId) return false;
      // keep big groups seeing everything - Confirm books enough rooms and checks capacity
      if (adults > t.max_occupancy) return false;
      if (view !== "Any" && roomFacts(t.room_type_id)?.view !== view) return false;
      return true;
    });
    list.sort((a, b) => {
      // sold-out categories are still shown, but always sink to the bottom
      const open = Number(b.available_count > 0) - Number(a.available_count > 0);
      if (open) return open;
      switch (sort) {
        case "price-desc":
          return toNum(b.price_per_night) - toNum(a.price_per_night);
        case "rating":
          return toNum(b.avg_rating) - toNum(a.avg_rating) || b.booking_count - a.booking_count;
        case "popular":
          return b.booking_count - a.booking_count;
        case "price-asc":
        default:
          return toNum(a.price_per_night) - toNum(b.price_per_night);
      }
    });
    return list;
  }, [types, roomTypeId, adults, view, sort]);

  const openCount = useMemo(
    () => visible.filter((t) => t.available_count > 0).length,
    [visible],
  );

  function reserve(t: AvailableRoomType) {
    // pre-fill enough rooms for the party, capped at what's free
    const need = Math.min(
      t.available_count,
      Math.max(1, Math.ceil(guests / Math.max(1, t.max_occupancy))),
    );
    const draft: ReserveDraft = {
      roomTypeId: t.room_type_id,
      roomTypeName: t.name,
      checkIn,
      checkOut,
      pricePerNight: t.price_per_night,
      maxOccupancy: t.max_occupancy,
      availableCount: t.available_count,
      rooms: need,
      adults,
      kids,
    };
    nav("/book/confirm", { state: draft });
  }

  return (
    <div className="page">
      <section className="section container" style={{ paddingBottom: 32 }}>
        <Reveal>
          <p className="eyebrow">{t("search.eyebrow")}</p>
          <div className="rule" />
          <h1 style={{ fontSize: "clamp(34px, 5vw, 56px)" }}>{t("search.title")}</h1>
          <Steps current={1} />
        </Reveal>

        <form className="card bookform" onSubmit={onSubmit}>
          <div className="bookform__dates">
            <Field
              label={t("search.checkIn")}
              type="date"
              value={checkIn}
              min={todayISO()}
              onChange={(e) => setCheckIn(e.target.value)}
            />
            <Field
              label={t("search.checkOut")}
              type="date"
              value={checkOut}
              min={checkIn}
              onChange={(e) => setCheckOut(e.target.value)}
            />
            <button className="btn btn--gold" disabled={busy || !datesValid}>
              {busy ? <Spinner /> : t("search.search")}
            </button>
          </div>

          <div className="bookform__filters">
            <label className="filterbar__group">
              <span>{t("search.room")}</span>
              <select
                value={roomTypeId ?? ""}
                onChange={(e) => pickRoomType(Number(e.target.value) || null)}
              >
                <option value="">{t("search.anyRoom")}</option>
                {catalogTypes.map((rt) => (
                  <option key={rt.room_type_id} value={rt.room_type_id}>
                    {rt.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="filterbar__group">
              <span>{t("search.adults")}</span>
              <select value={adults} onChange={(e) => setAdults(Number(e.target.value))}>
                {ADULT_OPTS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
            <label className="filterbar__group">
              <span>{t("search.children")}</span>
              <select value={kids} onChange={(e) => setKids(Number(e.target.value))}>
                {KID_OPTS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
            <label className="filterbar__group">
              <span>{t("search.view")}</span>
              <select value={view} onChange={(e) => setView(e.target.value as ViewFilter)}>
                {VIEWS.map((v) => (
                  <option key={v} value={v}>
                    {t(VIEW_KEY[v])}
                  </option>
                ))}
              </select>
            </label>
            <label className="filterbar__group">
              <span>{t("search.sort")}</span>
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                {SORTS.map((s) => (
                  <option key={s} value={s}>
                    {t(SORT_KEY[s])}
                  </option>
                ))}
              </select>
            </label>
            <span className="resultbar__spacer" />
            {n >= 1 && (
              <span className="tiny">
                {t("search.nights", { n, ns: n > 1 ? "s" : "" })} ·{" "}
                {t("search.guests", { g: guests, gs: guests > 1 ? "s" : "" })}
              </span>
            )}
          </div>
        </form>

        {roomTypeId && (
          <p className="muted" style={{ marginTop: 14 }}>
            {t("search.showingOnly", {
              name:
                catalogTypes.find((ct) => ct.room_type_id === roomTypeId)?.name ??
                t("search.oneRoomType"),
            })}{" "}
            ·{" "}
            <button className="linkbtn" onClick={() => pickRoomType(null)}>
              {t("search.showAll")}
            </button>
          </p>
        )}

        {err && (
          <div style={{ marginTop: 16 }}>
            <Alert>{err}</Alert>
          </div>
        )}
      </section>

      <section className="section container" style={{ paddingTop: 0 }}>
        {!types && !err && <CardsSkeleton count={6} height={220} />}

        {types && types.length === 0 && !err && (
          <EmptyState title={t("search.nothingForDates", { from: checkIn, to: checkOut })}>
            <button className="btn btn--gold btn--sm" onClick={() => shiftWindow(7)}>
              {t("search.tryWeekAfter")}
            </button>
          </EmptyState>
        )}

        {types && types.length > 0 && (
          <>
            <p className="muted" style={{ marginBottom: 20 }}>
              {t("search.available", {
                open: openCount,
                total: visible.length,
                ts: visible.length === 1 ? "" : "s",
              })}{" "}
              · {t("search.forDates", { from: checkIn, to: checkOut })}
            </p>

            {openCount === 0 && visible.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <EmptyState
                  compact
                  title={t("search.allBooked", { n, ns: n > 1 ? "s" : "" })}
                >
                  <button className="btn btn--gold btn--sm" onClick={() => shiftWindow(7)}>
                    {t("search.jumpWeek")}
                  </button>
                  <button className="btn btn--sm" onClick={() => shiftWindow(1)}>
                    {t("search.shiftNight")}
                  </button>
                </EmptyState>
              </div>
            )}

            {visible.length === 0 ? (
              <EmptyState title={t("search.noFit")}>
                {filtersNarrowed && (
                  <button className="btn btn--gold btn--sm" onClick={clearFilters}>
                    {t("search.clearFilters")}
                  </button>
                )}
                {adults > 2 && (
                  <button className="btn btn--sm" onClick={() => setAdults(2)}>
                    {t("search.set2Adults")}
                  </button>
                )}
              </EmptyState>
            ) : (
              <div className="grid grid-3" style={{ marginTop: 20 }}>
                {visible.map((rt, i) => {
                  const f = roomFacts(rt.room_type_id);
                  const rating = toNum(rt.avg_rating);
                  const out = rt.available_count < 1;
                  return (
                    <Reveal key={rt.room_type_id} delay={i * 45}>
                      <article
                        className={`card roomcard ${out ? "roomcard--out" : "card--hover"}`}
                        style={{ height: "100%" }}
                        aria-disabled={out || undefined}
                      >
                        <div className="roomcard__media">
                          <Link to={`/rooms/${slugify(rt.name)}`}>
                            <Photo
                              src={roomPhoto(rt.room_type_id)}
                              alt={`${rt.name} room`}
                              ratio="4x3"
                            />
                          </Link>
                          {out && (
                            <span className="roomcard__badge">{t("search.unavailable")}</span>
                          )}
                        </div>
                        <div className="roomcard__body">
                          <div className="roomcard__type">{rt.name}</div>
                          <h3 style={{ marginTop: 8 }}>
                            {roomTagline(rt.room_type_id) || rt.name}
                          </h3>
                          <p className="muted" style={{ marginTop: 4 }}>
                            {t("search.sleeps", { n: rt.max_occupancy })} ·{" "}
                            {out
                              ? t("search.noRoomsDates")
                              : t("search.leftCount", { n: rt.available_count })}
                            {f ? ` · ${t(VIEW_KEY[f.view as ViewFilter])}` : ""}
                          </p>
                          {(rating > 0 || rt.booking_count > 0) && (
                            <p className="tiny" style={{ marginTop: 6 }}>
                              {rating > 0 ? `★ ${rating.toFixed(1)}` : t("search.noRatings")}
                              {rt.booking_count > 0
                                ? ` · ${t("search.staysBooked", { n: rt.booking_count })}`
                                : ""}
                            </p>
                          )}
                          <div style={{ marginTop: 16 }}>
                            <Money value={rt.price_per_night} per={t("search.perNight")} />
                          </div>
                          <p className="tiny" style={{ marginTop: 6 }}>
                            ฿
                            {(toNum(rt.price_per_night) * n).toLocaleString("en-US", {
                              minimumFractionDigits: 2,
                            })}{" "}
                            {t("search.forNights", { n, ns: n > 1 ? "s" : "" })}
                          </p>
                          {out ? (
                            <button className="btn btn--sm" style={{ marginTop: 16 }} disabled>
                              {t("search.unavailable")}
                            </button>
                          ) : user ? (
                            <button
                              className="btn btn--sm btn--gold"
                              style={{ marginTop: 16 }}
                              onClick={() => reserve(rt)}
                            >
                              {t("search.bookRoom")}
                            </button>
                          ) : (
                            <Link
                              className="btn btn--sm btn--gold"
                              style={{ marginTop: 16 }}
                              to={`/login?next=${encodeURIComponent(
                                `/book${roomTypeId ? `?rt=${roomTypeId}` : ""}`,
                              )}`}
                            >
                              {t("search.signInToBook")}
                            </Link>
                          )}
                        </div>
                      </article>
                    </Reveal>
                  );
                })}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
