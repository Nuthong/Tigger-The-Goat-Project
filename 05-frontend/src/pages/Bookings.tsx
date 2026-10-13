import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { bookings as api, auth as authApi, customers, ApiError } from "../lib/api";
import type { Booking, BookingStatus, User } from "../lib/types";
import { useAuth } from "../auth/AuthContext";
import {
  Alert,
  CardsSkeleton,
  ChipBar,
  EmptyState,
  Field,
  Spinner,
  StatusTag,
  TierBadge,
} from "../components/ui";
import { useToast } from "../components/ToastProvider";
import { useConfirm } from "../components/ConfirmDialog";
import { Reveal } from "../components/Reveal";
import { BackLink } from "../components/BackLink";
import { baht, bookingRef, fmtStay, nightsBetween } from "../lib/format";
import { tierFor } from "../lib/loyalty";
import { useT } from "../i18n/I18n";

interface GuestStats {
  trips: number;
  nights: number;
  spend: number;
}

const FILTERS = [
  "all", "pending", "confirmed", "checked_in", "checked_out", "cancelled",
] as const;
type Filter = (typeof FILTERS)[number];
const STATUS_KEY: Record<Filter, string> = {
  all: "status.all",
  pending: "status.pending",
  confirmed: "status.confirmed",
  checked_in: "status.checked_in",
  checked_out: "status.checked_out",
  cancelled: "status.cancelled",
};

/** A live reservation the guest still owes money on. */
function awaitingPayment(b: Booking): boolean {
  return (
    Number(b.balance_due) > 0.004 && (b.status === "confirmed" || b.status === "pending")
  );
}

export function Bookings() {
  const toast = useToast();
  const confirm = useConfirm();
  const { t, lang } = useT();
  const [items, setItems] = useState<Booking[] | null>(null);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<GuestStats | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [err, setErr] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  const loadList = useCallback(() => {
    setItems(null);
    setErr("");
    api
      // a lifetime of stays fits in one page - 200 is far above any real guest
      .list(filter === "all" ? undefined : (filter as BookingStatus), { limit: 200 })
      .then((p) => {
        setItems(p.items);
        setTotal(p.total);
      })
      .catch((e) => setErr(e instanceof ApiError ? e.message : "Failed to load"));
  }, [filter]);

  const loadSummary = useCallback(() => {
    customers
      .mySummary()
      .then((s) => setStats({ trips: s.trips, nights: s.nights, spend: Number(s.lifetime_spend) }))
      .catch(() => setStats(null));
  }, []);

  useEffect(() => loadList(), [loadList]);
  // the loyalty figures, computed server-side and independent of the chip
  useEffect(() => loadSummary(), [loadSummary]);

  async function cancelStay(b: Booking) {
    const paidNow = Number(b.amount_paid) - Number(b.amount_refunded);
    const deadline = b.free_cancellation_deadline
      ? new Date(b.free_cancellation_deadline)
      : null;
    const free = deadline != null && deadline.getTime() > Date.now();
    const oneNight = b.rooms.reduce((s, r) => s + Number(r.price_per_night), 0);
    const ref = bookingRef(b.booking_id);
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
        title: t("account.cancelTitle", { ref }),
        body,
        confirmLabel: t("account.cancelBookingBtn"),
        cancelLabel: t("account.cancelKeepIt"),
        tone: "danger",
      }))
    ) {
      return;
    }
    setBusyId(b.booking_id);
    try {
      await api.transition(b.booking_id, "cancel");
      toast.success(t("account.cancelled", { ref }));
      loadList();
      loadSummary();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("account.couldNotCancel"));
    } finally {
      setBusyId(null);
    }
  }


  const noneAtAll = filter === "all" && items?.length === 0;
  const unpaid = (items ?? []).filter(awaitingPayment);

  return (
    <div className="page container section">
      <BackLink to="/" label={t("common.home")} />
      <Reveal>
        <p className="eyebrow" style={{ marginTop: 14 }}>{t("nav.brand")}</p>
        <div className="rule" />
        <h1 style={{ fontSize: "clamp(32px, 5vw, 52px)" }}>{t("account.title")}</h1>
        <p className="lede" style={{ marginTop: 12 }}>
          {t("account.lede")}
        </p>
      </Reveal>

      <ProfileCard stats={stats} />

      <h2 style={{ marginTop: 40, fontSize: 24 }}>{t("account.yourStays")}</h2>

      {unpaid.length > 0 && (
        <div className="banner banner--warn" style={{ marginTop: 16 }}>
          <span aria-hidden>!</span>
          <span>
            {unpaid.length === 1
              ? t("account.unpaidOne", { ref: bookingRef(unpaid[0].booking_id) })
              : t("account.unpaidMany", { n: unpaid.length })}{" "}
            <Link to={`/book/pay/${unpaid[0].booking_id}`} className="link-arrow">
              {t("account.completePayment")}
            </Link>
          </span>
        </div>
      )}

      {!noneAtAll && (
        <div style={{ marginTop: 16 }}>
          <ChipBar
            options={FILTERS}
            value={filter}
            onChange={setFilter}
            label={(f) => t(STATUS_KEY[f])}
          />
        </div>
      )}

      <div style={{ marginTop: 24 }}>
        {err && <Alert onRetry={loadList}>{err}</Alert>}
        {!items && !err && <CardsSkeleton count={4} height={92} />}

        {items && items.length === 0 && (
          <EmptyState
            title={
              noneAtAll
                ? t("account.noStaysYet")
                : t("account.nothingInStatus", { status: t(STATUS_KEY[filter]) })
            }
          >
            {noneAtAll && (
              <Link to="/book" className="btn btn--gold btn--sm">
                {t("account.findRoom")}
              </Link>
            )}
          </EmptyState>
        )}

        {items && total > items.length && (
          <p className="tiny muted" style={{ marginBottom: 10 }}>
            {t("account.showingRecent", { shown: items.length, total })}
          </p>
        )}

        {items && items.length > 0 && (
          <div className="stack stack--tight">
            {items.map((b) => {
              const due = awaitingPayment(b);
              return (
                <Link
                  key={b.booking_id}
                  to={due ? `/book/pay/${b.booking_id}` : `/bookings/${b.booking_id}`}
                  className="card card--flat staycard"
                >
                  <div className="staycard__main">
                    <p className="tiny">{bookingRef(b.booking_id)}</p>
                    <h3 style={{ marginTop: 4 }}>{fmtStay(b.check_in_date, b.check_out_date, lang)}</h3>
                    <p className="muted" style={{ marginTop: 6, fontSize: 14 }}>
                      {t("search.nights", {
                        n: nightsBetween(b.check_in_date, b.check_out_date),
                        ns: nightsBetween(b.check_in_date, b.check_out_date) > 1 ? "s" : "",
                      })}{" "}
                      ·{" "}
                      {t("search.guests", { g: b.num_guests, gs: b.num_guests > 1 ? "s" : "" })} ·{" "}
                      {b.rooms.map((r) => r.room_type).join(", ") || "-"}
                    </p>
                    {b.status === "cancelled" && Number(b.amount_refunded) > 0.004 && (
                      <p className="tiny" style={{ marginTop: 4 }}>
                        {t("account.refunded", { amount: baht(b.amount_refunded) })}
                      </p>
                    )}
                  </div>
                  <div className="staycard__side">
                    {due ? (
                      <>
                        <span className="tag tag--warn">
                          {t("account.paymentDue", { amount: baht(b.balance_due) })}
                        </span>
                        <span className="link-arrow">{t("account.payNow")}</span>
                      </>
                    ) : (
                      <>
                        <StatusTag status={b.status} />
                        <span className="link-arrow">{t("account.open")}</span>
                      </>
                    )}
                    {(b.status === "pending" || b.status === "confirmed") && (
                      <button
                        type="button"
                        className="btn btn--sm btn--quiet"
                        disabled={busyId === b.booking_id}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          void cancelStay(b);
                        }}
                      >
                        {t("account.cancelBtn")}
                      </button>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

type Mode = "view" | "edit" | "password";

function ProfileCard({ stats }: { stats: GuestStats | null }) {
  const { user, refreshMe, logout } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const { t } = useT();
  const [mode, setMode] = useState<Mode>("view");

  if (!user) return null;

  const fullName =
    [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || user.username;
  const tier = stats ? tierFor(stats.nights) : null;

  return (
    <div className="card card--flat" style={{ padding: 24, marginTop: 26 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2 style={{ fontSize: 22 }}>{t("account.yourProfile")}</h2>
          {tier && <TierBadge tier={tier.name} />}
        </span>
        {mode === "view" && (
          <span style={{ display: "flex", gap: 8 }}>
            <button className="btn btn--sm btn--quiet" onClick={() => setMode("edit")}>
              {t("account.editDetails")}
            </button>
            <button className="btn btn--sm btn--quiet" onClick={() => setMode("password")}>
              {t("account.changePassword")}
            </button>
          </span>
        )}
      </div>

      {mode === "view" && tier && stats && stats.trips > 0 && (
        <p className="muted" style={{ marginTop: 10, fontSize: 14 }}>
          {t("account.staysNightsSpend", {
            trips: stats.trips,
            ts: stats.trips === 1 ? "" : "s",
            nights: stats.nights,
            ns: stats.nights === 1 ? "" : "s",
            spend: baht(stats.spend),
          })}
          {tier.toNext != null && tier.toNext > 0 && stats.nights > 0 && (
            <span className="tiny">
              {" "}
              ·{" "}
              {t("account.toNextTier", {
                n: tier.toNext,
                ns: tier.toNext === 1 ? "" : "s",
                tier: tier.next ?? "",
              })}
            </span>
          )}
        </p>
      )}

      {mode === "view" && (
        <dl className="proflist" style={{ marginTop: 16 }}>
          <div>
            <dt className="tiny muted">{t("account.name")}</dt>
            <dd>{fullName}</dd>
          </div>
          <div>
            <dt className="tiny muted">{t("account.username")}</dt>
            <dd>{user.username}</dd>
          </div>
          <div>
            <dt className="tiny muted">{t("account.emailSignIn")}</dt>
            <dd>{user.email}</dd>
          </div>
          <div>
            <dt className="tiny muted">{t("account.phone")}</dt>
            <dd>{user.phone || <span className="muted">-</span>}</dd>
          </div>
        </dl>
      )}

      {mode === "edit" && (
        <EditDetails
          user={user}
          onCancel={() => setMode("view")}
          onSaved={async () => {
            await refreshMe();
            toast.success(t("account.profileUpdated"));
            setMode("view");
          }}
        />
      )}

      {mode === "password" && (
        <ChangePassword
          onCancel={() => setMode("view")}
          onDone={async () => {
            toast.success(t("account.passwordChanged"));
            await logout();
            nav("/login", { replace: true });
          }}
        />
      )}
    </div>
  );
}

function EditDetails({
  user,
  onCancel,
  onSaved,
}: {
  user: User;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { t } = useT();
  const [f, setF] = useState({
    first_name: user.first_name ?? "",
    last_name: user.last_name ?? "",
    phone: user.phone ?? "",
  });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });

  const valid = !!f.first_name.trim() && !!f.last_name.trim();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) {
      setErr(t("account.nameEmpty"));
      return;
    }
    setErr("");
    setBusy(true);
    try {
      await authApi.updateProfile({
        first_name: f.first_name.trim(),
        last_name: f.last_name.trim(),
        phone: f.phone.trim() || null,
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("account.couldNotSave"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack stack--tight" style={{ marginTop: 18 }} onSubmit={submit}>
      {err && <Alert>{err}</Alert>}
      <Field
        label={t("account.username")}
        value={user.username}
        hint={t("account.usernameHint")}
        readOnly
        disabled
      />
      <div className="grid grid-2" style={{ gap: 16 }}>
        <Field
          label={t("account.firstName")}
          value={f.first_name}
          onChange={set("first_name")}
          required
        />
        <Field
          label={t("account.lastName")}
          value={f.last_name}
          onChange={set("last_name")}
          required
        />
      </div>
      <Field
        label={t("account.phone")}
        hint={t("account.phoneHint")}
        value={f.phone}
        onChange={set("phone")}
        maxLength={20}
      />
      <p className="tiny muted">{t("account.emailNote", { email: user.email })}</p>
      <div style={{ display: "flex", gap: 10 }}>
        <button className="btn btn--gold btn--sm" disabled={busy || !valid}>
          {busy ? <Spinner /> : t("account.saveChanges")}
        </button>
        <button type="button" className="btn btn--sm btn--quiet" onClick={onCancel} disabled={busy}>
          {t("account.cancelBtn")}
        </button>
      </div>
    </form>
  );
}

function ChangePassword({ onCancel, onDone }: { onCancel: () => void; onDone: () => void }) {
  const { t } = useT();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const okLen = next.length >= 10;
  const match = next === confirm;
  const valid = !!cur && okLen && match;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) {
      setErr(!okLen ? t("account.pwTooShort") : t("auth.pwMismatchFull"));
      return;
    }
    setErr("");
    setBusy(true);
    try {
      await authApi.changePassword(cur, next);
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("account.couldNotChangePw"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack stack--tight" style={{ marginTop: 18 }} onSubmit={submit}>
      {err && <Alert>{err}</Alert>}
      <Field
        label={t("account.currentPassword")}
        type="password"
        value={cur}
        onChange={(e) => setCur(e.target.value)}
        required
      />
      <div className="grid grid-2" style={{ gap: 16 }}>
        <Field
          label={t("account.newPassword")}
          type="password"
          hint={t("auth.passwordHint")}
          value={next}
          onChange={(e) => setNext(e.target.value)}
          minLength={10}
          required
        />
        <Field
          label={t("account.confirmNewPassword")}
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          minLength={10}
          required
          hint={confirm && !match ? t("auth.pwMismatch") : undefined}
        />
      </div>
      <p className="tiny muted">{t("account.signOutNotice")}</p>
      <div style={{ display: "flex", gap: 10 }}>
        <button className="btn btn--gold btn--sm" disabled={busy || !valid}>
          {busy ? <Spinner /> : t("account.changePassword")}
        </button>
        <button type="button" className="btn btn--sm btn--quiet" onClick={onCancel} disabled={busy}>
          {t("account.cancelBtn")}
        </button>
      </div>
    </form>
  );
}
