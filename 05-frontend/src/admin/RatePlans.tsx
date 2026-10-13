import { useCallback, useEffect, useState, type FormEvent } from "react";
import { catalog, ratePlans, ApiError } from "../lib/api";
import type { Quote, RatePlan, RatePlanKind, RoomType } from "../lib/types";
import { useAuth } from "../auth/AuthContext";
import { Alert, Field, Spinner, TableEmpty, TableSkeleton } from "../components/ui";
import { FilterPanel, type FilterField } from "../components/FilterPanel";
import { inNumRange, isOneOf, textHas, withFilter } from "../lib/filters";
import { useToast } from "../components/ToastProvider";
import { useConfirm, usePrompt } from "../components/ConfirmDialog";
import { RateCalendar } from "./RateCalendar";
import { baht, fmtDate, nightsBetween } from "../lib/format";
import { todayISO } from "../lib/validation";
import { useT } from "../i18n/I18n";

const KINDS: RatePlanKind[] = ["seasonal", "weekend", "weekday", "promotion"];

const KIND_KEY: Record<string, string> = {
  seasonal: "rpKind.seasonal",
  weekend: "rpKind.weekend",
  weekday: "rpKind.weekday",
  promotion: "rpKind.promotion",
};

function isoPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function RatePlans() {
  const { t, lang } = useT();
  const { isManager } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [plans, setPlans] = useState<RatePlan[] | null>(null);
  const [types, setTypes] = useState<RoomType[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<number | "new" | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [adv, setAdv] = useState<Record<string, string>>({});

  const kindLabel = (k: string) => t(KIND_KEY[k] ?? k);

  const load = useCallback(() => {
    setErr("");
    ratePlans
      .list()
      .then(setPlans)
      .catch((e) => setErr(e instanceof ApiError ? e.message : t("common.failedToLoad")));
  }, [t]);

  useEffect(() => load(), [load]);
  useEffect(() => {
    catalog.roomTypes().then(setTypes).catch(() => setTypes([]));
  }, []);

  async function patch(p: RatePlan, body: Record<string, unknown>) {
    setBusy(p.rate_plan_id);
    setErr("");
    try {
      await ratePlans.update(p.rate_plan_id, body);
      load();
    } catch (e) {
      const m = e instanceof ApiError ? e.message : t("mt.updateFailed");
      setErr(m);
      toast.error(m);
    } finally {
      setBusy(null);
    }
  }

  async function remove(p: RatePlan) {
    if (
      !(await confirm({
        title: t("rp.deleteTitle", { name: p.name }),
        body: t("rp.deleteBody"),
        confirmLabel: t("us.delete"),
        tone: "danger",
      }))
    ) {
      return;
    }
    setBusy(p.rate_plan_id);
    try {
      await ratePlans.remove(p.rate_plan_id);
      toast.success(t("rp.deletedToast", { name: p.name }));
      load();
    } catch (e) {
      const m = e instanceof ApiError ? e.message : t("us.deleteFailed");
      setErr(m);
      toast.error(m);
    } finally {
      setBusy(null);
    }
  }

  async function rename(p: RatePlan) {
    const name = await prompt({
      title: t("rp.renameTitle"),
      label: t("rp.planName"),
      defaultValue: p.name,
      required: true,
      maxLength: 80,
      confirmLabel: t("rp.save"),
    });
    if (name && name !== p.name) patch(p, { name });
  }

  // one filter per column
  const advFields: FilterField[] = [
    {
      type: "select",
      key: "room_type_id",
      label: t("rp.colRoomType"),
      options: types.map((rt) => ({ value: String(rt.room_type_id), label: rt.name })),
    },
    { type: "text", key: "name", label: t("rp.colPlan") },
    {
      type: "select",
      key: "kind",
      label: t("rp.kind"),
      options: KINDS.map((k) => ({ value: k, label: kindLabel(k) })),
    },
    {
      type: "number-range",
      label: t("rp.colPricePerNight"),
      from: "min_price",
      to: "max_price",
      min: 0,
      prefix: "฿",
    },
    { type: "date-range", label: t("rp.colValid"), from: "valid_from", to: "valid_to" },
    {
      type: "select",
      key: "days",
      label: t("rp.colDays"),
      options: [
        { value: "weekday", label: t("rp.weekdayDays") },
        { value: "weekend", label: t("rp.weekendDays") },
      ],
    },
    { type: "number-range", label: t("rp.colPriority"), from: "min_priority", to: "max_priority" },
    {
      type: "select",
      key: "is_active",
      label: t("rp.colActive"),
      options: [
        { value: "true", label: t("rp.colActive") },
        { value: "false", label: t("rp.off") },
      ],
    },
  ];

  const visiblePlans = (plans ?? []).filter(
    (p) =>
      isOneOf(p.room_type_id, adv.room_type_id) &&
      textHas(p.name, adv.name) &&
      isOneOf(p.kind, adv.kind) &&
      inNumRange(p.price_per_night, adv.min_price, adv.max_price) &&
      // in force at any point of the window (both ends inclusive)
      (!adv.valid_to || p.valid_from <= adv.valid_to) &&
      (!adv.valid_from || p.valid_to >= adv.valid_from) &&
      (adv.days === "weekday" ? p.applies_weekday : adv.days === "weekend" ? p.applies_weekend : true) &&
      inNumRange(p.priority, adv.min_priority, adv.max_priority) &&
      isOneOf(p.is_active, adv.is_active),
  );

  return (
    <>
      <div className="admin__head">
        <div>
          <p className="eyebrow">{t("rp.eyebrow")}</p>
          <h1>{t("rp.title")}</h1>
        </div>
        {isManager && (
          <button className="btn btn--sm btn--gold" onClick={() => setShowForm((v) => !v)}>
            {showForm ? t("common.close") : t("rp.newPlan")}
          </button>
        )}
      </div>

      {err && <Alert>{err}</Alert>}

      {plans && plans.length > 0 && (
        <div className="row" style={{ marginBottom: 16, gap: 10, flexWrap: "wrap" }}>
          <button
            className={`btn btn--sm ${adv.is_active === "true" ? "btn--gold" : "btn--quiet"}`}
            onClick={() =>
              setAdv((a) => withFilter(a, "is_active", a.is_active === "true" ? "" : "true"))
            }
          >
            {t("rp.activeOnly")}
          </button>
          <FilterPanel
            fields={advFields}
            values={adv}
            onChange={(k, v) => setAdv((a) => withFilter(a, k, v))}
            onClear={() => setAdv({})}
          />
        </div>
      )}

      {isManager && showForm && (
        <NewPlanForm
          types={types}
          busy={busy === "new"}
          onSubmit={async (body) => {
            setBusy("new");
            setErr("");
            try {
              await ratePlans.create(body);
              toast.success(t("rp.createdToast", { name: body.name }));
              setShowForm(false);
              load();
            } catch (e) {
              const m = e instanceof ApiError ? e.message : t("rp.couldNotCreatePlan");
              setErr(m);
              toast.error(m);
            } finally {
              setBusy(null);
            }
          }}
        />
      )}

      <QuoteBox types={types} />

      {!plans && !err && <TableSkeleton rows={6} cols={7} />}

      {plans && (
        <div className="panel">
          <div className="table-wrap">
            <table className="dtable">
              <thead>
                <tr>
                  <th>{t("rp.colRoomType")}</th>
                  <th>{t("rp.colPlan")}</th>
                  <th style={{ textAlign: "right" }}>{t("rp.colPricePerNight")}</th>
                  <th>{t("rp.colValid")}</th>
                  <th>{t("rp.colDays")}</th>
                  <th style={{ textAlign: "right" }}>{t("rp.colPriority")}</th>
                  <th>{t("rp.colActive")}</th>
                  {isManager && <th style={{ textAlign: "right" }}>{t("us.colActions")}</th>}
                </tr>
              </thead>
              <tbody>
                {visiblePlans.map((p) => (
                  <tr key={p.rate_plan_id}>
                    <td>{p.room_type_name}</td>
                    <td>
                      <strong>{p.name}</strong>
                      <br />
                      <span className="tiny">{kindLabel(p.kind)}</span>
                    </td>
                    <td style={{ textAlign: "right" }}>{baht(p.price_per_night, true)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {fmtDate(p.valid_from, lang)}
                      <br />
                      <span className="tiny">→ {fmtDate(p.valid_to, lang)}</span>
                    </td>
                    <td className="tiny">
                      {p.applies_weekday ? t("rp.weekdayDays") : ""}
                      {p.applies_weekday && p.applies_weekend ? " · " : ""}
                      {p.applies_weekend ? t("rp.weekendDays") : ""}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {isManager ? (
                        <input
                          className="minisel"
                          type="number"
                          defaultValue={p.priority}
                          style={{ width: 56, textAlign: "right" }}
                          disabled={busy === p.rate_plan_id}
                          onBlur={(e) => {
                            const v = Number(e.target.value);
                            if (v !== p.priority) patch(p, { priority: v });
                          }}
                        />
                      ) : (
                        p.priority
                      )}
                    </td>
                    <td>
                      {isManager ? (
                        <button
                          className={`tag ${p.is_active ? "tag--ok" : ""}`}
                          disabled={busy === p.rate_plan_id}
                          onClick={() => patch(p, { is_active: !p.is_active })}
                        >
                          {p.is_active ? t("rp.colActive") : t("rp.off")}
                        </button>
                      ) : (
                        <span className={`tag ${p.is_active ? "tag--ok" : ""}`}>
                          {p.is_active ? t("rp.colActive") : t("rp.off")}
                        </span>
                      )}
                    </td>
                    {isManager && (
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <button
                          className="btn btn--sm btn--quiet"
                          disabled={busy === p.rate_plan_id}
                          onClick={() => rename(p)}
                        >
                          {t("rp.rename")}
                        </button>
                        <button
                          className="btn btn--sm btn--danger"
                          style={{ marginLeft: 6 }}
                          disabled={busy === p.rate_plan_id}
                          onClick={() => remove(p)}
                        >
                          {t("us.delete")}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {plans.length === 0 && (
                  <TableEmpty cols={isManager ? 8 : 7}>{t("rp.noneAtAll")}</TableEmpty>
                )}
                {plans.length > 0 && visiblePlans.length === 0 && (
                  <TableEmpty cols={isManager ? 8 : 7}>{t("rp.noneMatch")}</TableEmpty>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {isManager && <RateCalendar />}
    </>
  );
}

function NewPlanForm({
  types,
  busy,
  onSubmit,
}: {
  types: RoomType[];
  busy: boolean;
  onSubmit: (body: {
    room_type_id: number;
    name: string;
    kind: string;
    price_per_night: string;
    valid_from: string;
    valid_to: string;
    applies_weekday: boolean;
    applies_weekend: boolean;
    priority: number;
  }) => void;
}) {
  const { t } = useT();
  const [f, setF] = useState({
    room_type_id: "",
    name: "",
    kind: "seasonal",
    price_per_night: "",
    valid_from: isoPlus(0),
    valid_to: isoPlus(30),
    applies_weekday: true,
    applies_weekend: true,
    priority: "10",
  });
  const set =
    <K extends keyof typeof f>(k: K) =>
    (v: (typeof f)[K]) =>
      setF({ ...f, [k]: v });

  const priceNum = Number(f.price_per_night);
  const prioNum = Number(f.priority);
  const rangeOk = !!f.valid_from && !!f.valid_to && f.valid_to >= f.valid_from;
  const formValid =
    !!f.room_type_id &&
    !!f.name.trim() &&
    priceNum > 0 &&
    Number.isFinite(prioNum) &&
    prioNum >= 0 &&
    prioNum <= 999 &&
    rangeOk &&
    (f.applies_weekday || f.applies_weekend);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!formValid) return;
    onSubmit({
      room_type_id: Number(f.room_type_id),
      name: f.name.trim(),
      kind: f.kind,
      price_per_night: f.price_per_night,
      valid_from: f.valid_from,
      valid_to: f.valid_to,
      applies_weekday: f.applies_weekday,
      applies_weekend: f.applies_weekend,
      priority: Number(f.priority) || 0,
    });
  }

  return (
    <form className="panel" style={{ marginBottom: 20 }} onSubmit={submit}>
      <div className="panel__head">{t("rp.newPlanFormTitle")}</div>
      <div style={{ padding: 20 }} className="stack stack--tight">
        <div className="grid grid-3" style={{ gap: 14 }}>
          <label className="field">
            <span>{t("rp.colRoomType")}</span>
            <select value={f.room_type_id} onChange={(e) => set("room_type_id")(e.target.value)} required>
              <option value="">{t("hk.chooseEllipsis")}</option>
              {types.map((rt) => (
                <option key={rt.room_type_id} value={rt.room_type_id}>
                  {rt.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t("rp.kind")}</span>
            <select value={f.kind} onChange={(e) => set("kind")(e.target.value)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(KIND_KEY[k])}
                </option>
              ))}
            </select>
          </label>
          <Field
            label={t("rp.colPriority")}
            type="number"
            min={0}
            max={999}
            value={f.priority}
            onChange={(e) => set("priority")(e.target.value)}
          />
        </div>
        <Field label={t("rp.planName")} value={f.name} onChange={(e) => set("name")(e.target.value)} required />
        <div className="grid grid-3" style={{ gap: 14 }}>
          <Field
            label={t("rp.pricePerNight")}
            type="number"
            min={1}
            step={0.01}
            value={f.price_per_night}
            onChange={(e) => set("price_per_night")(e.target.value)}
            required
          />
          <Field
            label={t("rp.validFrom")}
            type="date"
            value={f.valid_from}
            min={todayISO()}
            onChange={(e) => set("valid_from")(e.target.value)}
          />
          <Field
            label={t("rp.validTo")}
            type="date"
            value={f.valid_to}
            min={f.valid_from}
            onChange={(e) => set("valid_to")(e.target.value)}
          />
        </div>
        <div className="row" style={{ gap: 18 }}>
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={f.applies_weekday}
              onChange={(e) => set("applies_weekday")(e.target.checked)}
            />
            <span>{t("rp.weekdays")}</span>
          </label>
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={f.applies_weekend}
              onChange={(e) => set("applies_weekend")(e.target.checked)}
            />
            <span>{t("rp.weekends")}</span>
          </label>
        </div>
        {!rangeOk && (
          <p className="tiny" style={{ color: "var(--danger)" }}>
            {t("rp.rangeError")}
          </p>
        )}
        <div>
          <button className="btn btn--sm btn--gold" disabled={busy || !formValid}>
            {busy ? <Spinner /> : t("rp.createPlan")}
          </button>
        </div>
      </div>
    </form>
  );
}

function QuoteBox({ types }: { types: RoomType[] }) {
  const { t, lang } = useT();
  const [typeId, setTypeId] = useState("");
  const [checkIn, setCheckIn] = useState(isoPlus(1));
  const [checkOut, setCheckOut] = useState(isoPlus(4));
  const [quote, setQuote] = useState<Quote | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const nights = nightsBetween(checkIn, checkOut);

  async function run(e: FormEvent) {
    e.preventDefault();
    if (!typeId || nights < 1) return;
    setBusy(true);
    setErr("");
    setQuote(null);
    try {
      setQuote(await ratePlans.quote(Number(typeId), checkIn, checkOut));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("rp.quoteFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel" style={{ marginBottom: 20 }}>
      <div className="panel__head">{t("rp.priceChecker")}</div>
      <form
        style={{ padding: 20, display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 14, alignItems: "end" }}
        onSubmit={run}
      >
        <label className="field">
          <span>{t("rp.colRoomType")}</span>
          <select value={typeId} onChange={(e) => setTypeId(e.target.value)} required>
            <option value="">{t("hk.chooseEllipsis")}</option>
            {types.map((rt) => (
              <option key={rt.room_type_id} value={rt.room_type_id}>
                {rt.name}
              </option>
            ))}
          </select>
        </label>
        <Field label={t("search.checkIn")} type="date" value={checkIn} min={todayISO()} onChange={(e) => setCheckIn(e.target.value)} />
        <Field label={t("search.checkOut")} type="date" value={checkOut} min={checkIn} onChange={(e) => setCheckOut(e.target.value)} />
        <button className="btn btn--sm btn--gold" disabled={busy || !typeId || nights < 1}>
          {busy ? <Spinner /> : t("rp.quote")}
        </button>
      </form>
      {err && <div style={{ padding: "0 20px 16px" }}><Alert>{err}</Alert></div>}
      {quote && (
        <div style={{ padding: "0 20px 20px" }}>
          <p className="muted" style={{ marginBottom: 8 }}>
            {t("rp.quoteSummary", {
              room: quote.room_type_name,
              n: quote.nights,
              ns: quote.nights > 1 ? "s" : "",
              base: baht(quote.base_price_per_night, true),
              avg: baht(quote.average_per_night, true),
            })}{" "}
            · <strong>{t("rp.quoteTotal", { total: baht(quote.total, true) })}</strong>
          </p>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {quote.breakdown.map((b) => (
              <span key={b.night} className="tag">
                {fmtDate(b.night, lang).replace(/ \d{4}$/, "")} · {baht(b.price)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
