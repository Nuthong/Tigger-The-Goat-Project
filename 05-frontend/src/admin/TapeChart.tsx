import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { bookings as bookingApi, catalog, ApiError } from "../lib/api";
import type { Booking, BookingStatus, Room, RoomType } from "../lib/types";
import { Alert, Spinner } from "../components/ui";
import { Clock } from "../components/Clock";
import { baht, bookingRef, fmtStay, monthAbbr, nightsBetween, weekdayAbbr } from "../lib/format";
import { useT } from "../i18n/I18n";

const DAY_MS = 86_400_000;
const RANGES = [7, 14, 21, 30] as const;
const MIN_RANGE = 7;
const MAX_RANGE = 92;
const ROOM_COL = 150; // keep in step with --room-col in admin.css
const AUTO_MIN = 26; // floor when the range is long - keeps a day cell readable
const AUTO_MAX = 260; // ceiling only so a very short range doesn't get absurd

type WidthMode = "auto" | 38 | 46 | 58;
const WIDTH_MODES: { value: WidthMode; labelKey: string | null; label: string }[] = [
  { value: "auto", labelKey: "tc.widthFit", label: "Fit" },
  { value: 38, labelKey: null, label: "S" },
  { value: 46, labelKey: null, label: "M" },
  { value: 58, labelKey: null, label: "L" },
];

/** Per-user tape preferences (column width, span, cancelled toggle), in localStorage. */
interface TapePrefs {
  widthMode: WidthMode;
  range: number;
  showCancelled: boolean;
}
const DEFAULT_PREFS: TapePrefs = { widthMode: "auto", range: 21, showCancelled: false };

function readPrefs(key: string | null): TapePrefs {
  if (!key) return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return DEFAULT_PREFS;
    const p = JSON.parse(raw) as Partial<TapePrefs> & { dayW?: number };
    const wm = p.widthMode ?? p.dayW; // migrate the old `dayW` key
    return {
      widthMode: wm === "auto" || wm === 38 || wm === 46 || wm === 58 ? wm : DEFAULT_PREFS.widthMode,
      range:
        typeof p.range === "number"
          ? Math.min(MAX_RANGE, Math.max(MIN_RANGE, Math.round(p.range)))
          : DEFAULT_PREFS.range,
      showCancelled: !!p.showCancelled,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

// the tape uses shorter status words ("In house" / "Departed") than the rest of
// the admin ("Checked in" / "Checked out"), since the legend has no room to spare
const TAPE_STATUS_KEY: Record<BookingStatus, string> = {
  pending: "status.pending",
  confirmed: "status.confirmed",
  checked_in: "tc.checkedInShort",
  checked_out: "tc.checkedOutShort",
  cancelled: "status.cancelled",
};

const ROOM_STATUS_KEY: Record<string, string> = {
  available: "roomStatus.available",
  cleaning: "roomStatus.cleaning",
  maintenance: "roomStatus.maintenance",
  closed: "roomStatus.closed",
  occupied: "roomStatus.occupied",
};

function parseDay(s: string): Date {
  return new Date(`${s.slice(0, 10)}T00:00:00`);
}
function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = startOfDay(d);
  x.setDate(x.getDate() + n);
  return x;
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}
function dayIndex(dateStr: string, start: Date): number {
  return Math.round((parseDay(dateStr).getTime() - start.getTime()) / DAY_MS);
}

export function TapeChart() {
  const { t, lang } = useT();
  const navigate = useNavigate();
  const { user } = useAuth();
  const prefKey = user ? `tape:view:${user.user_id}` : null;

  const tapeStatusLabel = (s: BookingStatus) => t(TAPE_STATUS_KEY[s] ?? s);
  const roomStatusLabel = (s: string) => t(ROOM_STATUS_KEY[s] ?? s);

  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [types, setTypes] = useState<Record<number, string>>({});
  const [all, setAll] = useState<Booking[]>([]);
  const [todayCounts, setTodayCounts] = useState({ arr: 0, dep: 0 });
  const [err, setErr] = useState("");

  const initial = useRef(readPrefs(prefKey)).current;
  const [widthMode, setWidthMode] = useState<WidthMode>(initial.widthMode);
  const [range, setRange] = useState<number>(initial.range);
  const [start, setStart] = useState<Date>(() => startOfDay(new Date()));
  const [showCancelled, setShowCancelled] = useState(initial.showCancelled);

  // "Fit" mode: size the day columns so `range` days span the visible tape width
  const tapeRef = useRef<HTMLDivElement>(null);
  const [autoW, setAutoW] = useState(46);
  useEffect(() => {
    if (widthMode !== "auto") return;
    const el = tapeRef.current;
    if (!el) return;
    const recompute = () => {
      const avail = el.clientWidth - ROOM_COL - 2;
      // ignore a not-yet-laid-out / collapsed container so it doesn't snap tiny
      if (avail > 200) setAutoW(Math.max(AUTO_MIN, Math.min(AUTO_MAX, Math.floor(avail / range))));
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [widthMode, range, rooms]);

  const dayW = widthMode === "auto" ? autoW : widthMode;

  // remember this user's view (column width / span / cancelled toggle)
  useEffect(() => {
    if (!prefKey) return;
    try {
      localStorage.setItem(prefKey, JSON.stringify({ widthMode, range, showCancelled }));
    } catch {
      /* private mode / storage disabled - fine */
    }
  }, [prefKey, widthMode, range, showCancelled]);

  // rooms, types and the header's today counts: once
  useEffect(() => {
    const iso = ymd(new Date());
    Promise.all([
      catalog.rooms({ limit: 300 }),
      catalog.roomTypes(),
      bookingApi.list(undefined, { arriving_on: iso, limit: 200 }),
      bookingApi.list(undefined, { departing_on: iso, limit: 200 }),
    ])
      .then(([r, rts, arr, dep]) => {
        setRooms(r.items);
        setTypes(Object.fromEntries(rts.map((x: RoomType) => [x.room_type_id, x.name])));
        setTodayCounts({
          arr: arr.items.filter((b) => b.status !== "cancelled").length,
          dep: dep.items.filter((b) => b.status !== "cancelled").length,
        });
      })
      .catch((e) => setErr(e instanceof ApiError ? e.message : t("common.failedToLoad")));
  }, [t]);

  const todayStr = ymd(new Date());
  const days = useMemo(
    () => Array.from({ length: range }, (_, i) => addDays(start, i)),
    [start, range],
  );

  // bookings that touch the visible window - refetched whenever it moves, so a
  // stay booked long ago for a future week is never missed
  useEffect(() => {
    setErr("");
    bookingApi
      .list(undefined, {
        stay_from: ymd(start),
        stay_to: ymd(addDays(start, range)),
        limit: 1000,
      })
      .then((b) => setAll(b.items))
      .catch((e) => setErr(e instanceof ApiError ? e.message : t("common.failedToLoad")));
  }, [start, range, t]);
  const laneW = days.length * dayW;

  /** contiguous runs of days that fall in the same calendar month */
  const monthSegs = useMemo(() => {
    const segs: { label: string; span: number }[] = [];
    for (const d of days) {
      const label = `${monthAbbr(d.getMonth(), lang)} ${d.getFullYear()}`;
      const last = segs[segs.length - 1];
      if (last && last.label === label) last.span += 1;
      else segs.push({ label, span: 1 });
    }
    return segs;
  }, [days, lang]);

  const shades = useMemo(
    () =>
      days
        .map((d, i) => ({
          i,
          weekend: d.getDay() === 0 || d.getDay() === 6,
          today: ymd(d) === todayStr,
        }))
        .filter((s) => s.weekend || s.today),
    [days, todayStr],
  );

  /** bookings that touch the window, one entry per (booking, assigned room) */
  const placed = useMemo(() => {
    const byRoom = new Map<number, { b: Booking; startIdx: number; span: number }[]>();
    const unassigned: { b: Booking; startIdx: number; span: number }[] = [];
    for (const b of all) {
      if (b.status === "cancelled" && !showCancelled) continue;
      const s = Math.max(0, dayIndex(b.check_in_date, start));
      const e = Math.min(days.length, dayIndex(b.check_out_date, start));
      const span = e - s;
      if (span <= 0) continue;
      const cell = { b, startIdx: s, span };
      if (b.rooms.length === 0) {
        unassigned.push(cell);
      } else {
        for (const r of b.rooms) {
          const list = byRoom.get(r.room_id) ?? [];
          list.push(cell);
          byRoom.set(r.room_id, list);
        }
      }
    }
    return { byRoom, unassigned };
  }, [all, start, days.length, showCancelled]);

  const floors = useMemo(() => {
    const m = new Map<number, Room[]>();
    for (const r of rooms ?? []) m.set(r.floor, [...(m.get(r.floor) ?? []), r]);
    return [...m.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([f, rs]) => [f, rs.sort((a, b) => a.room_number.localeCompare(b.room_number))] as const);
  }, [rooms]);

  const arrivalsToday = todayCounts.arr;
  const departuresToday = todayCounts.dep;

  function bar(cell: { b: Booking; startIdx: number; span: number }, key: string) {
    const { b, startIdx, span } = cell;
    const nights = nightsBetween(b.check_in_date, b.check_out_date);
    // one flat summary, shared by the hover tooltip and the screen-reader label -
    // a bar reads as just the guest name otherwise
    const summary =
      `${bookingRef(b.booking_id)} · ${b.customer_name} · ` +
      `${fmtStay(b.check_in_date, b.check_out_date, lang)} · ` +
      `${t("tc.nightsCount", { n: nights, ns: nights > 1 ? "s" : "" })} · ` +
      `${t("tc.guestsCount", { n: b.num_guests, ns: b.num_guests > 1 ? "s" : "" })} · ` +
      `${tapeStatusLabel(b.status)}` +
      (Number(b.balance_due) > 0.004 ? ` · ${t("tc.unpaidAmount", { amount: baht(b.balance_due) })}` : "") +
      (b.note ? ` · ${t("tc.noteLabel", { note: b.note })}` : "");
    return (
      <button
        key={key}
        className={`tape__bar tape__bar--${b.status}`}
        style={{ left: startIdx * dayW + 1, width: span * dayW - 3 }}
        onClick={() => navigate(`/admin/bookings/${b.booking_id}`)}
        title={summary}
        aria-label={summary}
      >
        {b.note && <span className="tape__bar__flag" aria-hidden>✎</span>}
        <span className="tape__bar__name">{b.customer_name}</span>
      </button>
    );
  }

  return (
    <>
      <div className="admin__head">
        <div>
          <p className="eyebrow">{t("ov.eyebrow")}</p>
          <h1>{t("admin.nav.tape")}</h1>
          <Clock />
        </div>
        <span className="row" style={{ gap: 14 }}>
          <span className="muted">
            {t("tc.inOutToday", { arr: arrivalsToday, dep: departuresToday })}
          </span>
          <button className="btn btn--sm btn--gold" onClick={() => navigate("/admin/bookings/new")}>
            {t("ba.newBooking")}
          </button>
        </span>
      </div>

      <div
        className="tape__toolbar"
        tabIndex={0}
        role="group"
        aria-label={t("tc.controlsAria")}
        onKeyDown={(e) => {
          if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            setStart((s) => addDays(s, -7));
          } else if (e.key === "ArrowRight") {
            e.preventDefault();
            setStart((s) => addDays(s, 7));
          } else if (e.key === "PageUp") {
            e.preventDefault();
            setStart((s) => addDays(s, -range));
          } else if (e.key === "PageDown") {
            e.preventDefault();
            setStart((s) => addDays(s, range));
          } else if (e.key === "Home") {
            e.preventDefault();
            setStart(startOfDay(new Date()));
          }
        }}
      >
        <div className="seg">
          <button
            className="btn btn--sm btn--quiet"
            title={t("tc.backWeek")}
            aria-label={t("tc.backWeek")}
            onClick={() => setStart(addDays(start, -7))}
          >
            ‹
          </button>
          <button
            className="btn btn--sm btn--quiet"
            title={t("tc.startOnTodayTitle")}
            onClick={() => setStart(startOfDay(new Date()))}
          >
            {t("ov.today")}
          </button>
          <button
            className="btn btn--sm btn--quiet"
            title={t("tc.forwardWeek")}
            aria-label={t("tc.forwardWeek")}
            onClick={() => setStart(addDays(start, 7))}
          >
            ›
          </button>
        </div>
        <label className="tape__daterange">
          <span>{t("tc.from")}</span>
          <input
            type="date"
            value={ymd(days[0])}
            onChange={(e) => e.target.value && setStart(parseDay(e.target.value))}
          />
        </label>
        <label className="tape__daterange">
          <span>{t("tc.to")}</span>
          <input
            type="date"
            value={ymd(days[days.length - 1])}
            min={ymd(addDays(days[0], MIN_RANGE - 1))}
            max={ymd(addDays(days[0], MAX_RANGE - 1))}
            onChange={(e) => {
              if (!e.target.value) return;
              const span =
                Math.round((parseDay(e.target.value).getTime() - days[0].getTime()) / DAY_MS) + 1;
              setRange(Math.min(MAX_RANGE, Math.max(MIN_RANGE, span)));
            }}
          />
        </label>
        <div className="chipbar" role="tablist">
          {RANGES.map((r) => (
            <button
              key={r}
              className={`chip${range === r ? " is-active" : ""}`}
              onClick={() => setRange(r)}
            >
              {t("tc.rangeDays", { r })}
            </button>
          ))}
        </div>
        <div className="chipbar" role="tablist">
          {WIDTH_MODES.map((m) => (
            <button
              key={m.label}
              className={`chip${widthMode === m.value ? " is-active" : ""}`}
              onClick={() => setWidthMode(m.value)}
              title={m.value === "auto" ? t("tc.fitTitle") : undefined}
            >
              {m.labelKey ? t(m.labelKey) : m.label}
            </button>
          ))}
        </div>
        <label className="row" style={{ gap: 6, fontSize: 12.5 }}>
          <input
            type="checkbox"
            checked={showCancelled}
            onChange={(e) => setShowCancelled(e.target.checked)}
          />
          <span>{t("status.cancelled")}</span>
        </label>
        <span className="tape__legend">
          {(["confirmed", "checked_in", "checked_out", "pending"] as BookingStatus[]).map((s) => (
            <span key={s} className="tape__legend__item">
              <span className={`tape__swatch tape__bar--${s}`} />
              {tapeStatusLabel(s)}
            </span>
          ))}
        </span>
      </div>

      {err && <Alert>{err}</Alert>}
      {!rooms && !err && <Spinner />}

      {rooms && (
        <div className="panel" style={{ padding: 0 }}>
          <div ref={tapeRef} className="tape" style={{ "--day": `${dayW}px` } as CSSProperties}>
            {/* header */}
            <div className="tape__head">
              <div className="tape__corner">{t("mt.colRoom")}</div>
              <div className="tape__headcols">
                <div className="tape__months" style={{ width: laneW }}>
                  {monthSegs.map((m, i) => (
                    <div
                      key={i}
                      className="tape__monthseg"
                      style={{ width: m.span * dayW }}
                      title={m.label}
                    >
                      {m.label}
                    </div>
                  ))}
                </div>
                <div className="tape__days" style={{ width: laneW }}>
                  {days.map((d, i) => (
                    <div
                      key={i}
                      className={`tape__day${d.getDay() === 0 || d.getDay() === 6 ? " is-weekend" : ""}${
                        ymd(d) === todayStr ? " is-today" : ""
                      }${d.getDate() === 1 ? " is-month-start" : ""}`}
                      style={{ width: dayW }}
                    >
                      <span className="tape__day__dow">{weekdayAbbr(d.getDay(), lang)}</span>
                      <span className="tape__day__num">{d.getDate()}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* unassigned lane */}
            {placed.unassigned.length > 0 && (
              <div className="tape__row tape__row--unassigned">
                <div className="tape__room">
                  <strong>{t("tc.unassigned")}</strong>
                  <span className="tiny">{t("tc.roomNotSet")}</span>
                </div>
                <div className="tape__lane" style={{ width: laneW }}>
                  <Grid shades={shades} dayW={dayW} />
                  {placed.unassigned.map((c, i) => bar(c, `u${c.b.booking_id}-${i}`))}
                </div>
              </div>
            )}

            {/* floors */}
            {floors.map(([floor, rs]) => (
              <div key={floor}>
                <div className="tape__floorrow">
                  <div className="tape__floor">{t("hk.floorLabel", { n: floor })}</div>
                  <div className="tape__floorfill" style={{ width: laneW }} />
                </div>
                {rs.map((room) => (
                  <div key={room.room_id} className="tape__row">
                    <div className="tape__room">
                      <strong>{room.room_number}</strong>
                      <span className="tiny">
                        {types[room.room_type_id] ?? "-"}
                        {room.status !== "available" ? ` · ${roomStatusLabel(room.status)}` : ""}
                      </span>
                    </div>
                    <div className="tape__lane" style={{ width: laneW }}>
                      <Grid shades={shades} dayW={dayW} />
                      {(placed.byRoom.get(room.room_id) ?? []).map((c, i) =>
                        bar(c, `${room.room_id}-${c.b.booking_id}-${i}`),
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}


function Grid({
  shades,
  dayW,
}: {
  shades: { i: number; weekend: boolean; today: boolean }[];
  dayW: number;
}) {
  return (
    <>
      <div className="tape__gridlines" />
      {shades.map((s) => (
        <div
          key={s.i}
          className={`tape__shade${s.today ? " is-today" : s.weekend ? " is-weekend" : ""}`}
          style={{ left: s.i * dayW, width: dayW }}
        />
      ))}
    </>
  );
}
