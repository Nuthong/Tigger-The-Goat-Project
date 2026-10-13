import { useCallback, useEffect, useState, type FormEvent } from "react";
import { services as api, ApiError } from "../lib/api";
import type { ServiceCatalogRow } from "../lib/types";
import { Alert, Field, KpiSkeleton, Spinner, TableEmpty, TableSkeleton } from "../components/ui";
import { Modal } from "../components/Modal";
import { FilterPanel, type FilterField } from "../components/FilterPanel";
import { inNumRange, isOneOf, textHas, withFilter } from "../lib/filters";
import { useToast } from "../components/ToastProvider";
import { useConfirm } from "../components/ConfirmDialog";
import { baht } from "../lib/format";
import { toPositiveAmount } from "../lib/validation";
import { useT } from "../i18n/I18n";

/** A price field accepts 0 (a complimentary add-on) and up to 2 decimals. */
function parsePrice(v: string): string | null {
  const trimmed = v.trim();
  if (trimmed === "0" || trimmed === "0.00") return "0.00";
  const n = toPositiveAmount(trimmed);
  return n == null ? null : n.toFixed(2);
}

/** The add-on catalog (`service`) - what guests and the desk can put on a
 *  booking. Retiring hides a service from new bookings; past folios keep it. */
export function Services() {
  const { t } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [rows, setRows] = useState<ServiceCatalogRow[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<ServiceCatalogRow | null>(null);
  const [adv, setAdv] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    setErr("");
    api
      .catalog()
      .then(setRows)
      .catch((e) => setErr(e instanceof ApiError ? e.message : t("common.failedToLoad")));
  }, [t]);

  useEffect(() => load(), [load]);

  async function toggle(s: ServiceCatalogRow) {
    if (
      s.is_active &&
      !(await confirm({
        title: t("sv.retireTitle", { name: s.name }),
        body: t("sv.retireBody"),
        confirmLabel: t("sv.retire"),
        tone: "danger",
      }))
    ) {
      return;
    }
    setBusy(s.service_id);
    try {
      await api.update(s.service_id, { is_active: !s.is_active });
      toast.success(s.is_active ? t("sv.retiredToast", { name: s.name }) : t("sv.restoredToast", { name: s.name }));
      load();
    } catch (e) {
      const m = e instanceof ApiError ? e.message : t("sv.saveFailed");
      setErr(m);
      toast.error(m);
    } finally {
      setBusy(null);
    }
  }

  // one filter per column of the catalog
  const advFields: FilterField[] = [
    { type: "text", key: "name", label: t("sv.colService") },
    {
      type: "select",
      key: "basis",
      label: t("sv.limit"),
      options: (["per_guest_night", "per_room_night", "per_trip", "per_room_stay"] as const).map(
        (b) => ({ value: b, label: t(`addons.basis.${b}`) }),
      ),
    },
    {
      type: "number-range",
      label: t("sv.colPrice"),
      from: "min_price",
      to: "max_price",
      min: 0,
      prefix: "฿",
    },
    { type: "number-range", label: t("sv.colSold"), from: "min_sold", to: "max_sold", min: 0 },
    {
      type: "number-range",
      label: t("sv.colRevenue"),
      from: "min_revenue",
      to: "max_revenue",
      min: 0,
      prefix: "฿",
    },
    {
      type: "select",
      key: "is_active",
      label: t("ov.colStatus"),
      options: [
        { value: "true", label: t("sv.active") },
        { value: "false", label: t("sv.retired") },
      ],
    },
  ];
  const shown = (rows ?? []).filter(
    (s) =>
      (textHas(s.name, adv.name) || textHas(s.description, adv.name)) &&
      isOneOf(s.basis, adv.basis) &&
      inNumRange(s.price, adv.min_price, adv.max_price) &&
      inNumRange(s.units_sold, adv.min_sold, adv.max_sold) &&
      inNumRange(s.revenue, adv.min_revenue, adv.max_revenue) &&
      isOneOf(s.is_active, adv.is_active),
  );

  const active = (rows ?? []).filter((s) => s.is_active);
  const revenue = (rows ?? []).reduce((sum, s) => sum + Number(s.revenue), 0);
  const units = (rows ?? []).reduce((sum, s) => sum + s.units_sold, 0);
  const best = [...(rows ?? [])].sort((a, b) => Number(b.revenue) - Number(a.revenue))[0];

  return (
    <>
      <div className="admin__head">
        <div>
          <p className="eyebrow">{t("sv.eyebrow")}</p>
          <h1>{t("sv.title")}</h1>
        </div>
        <button className="btn btn--sm btn--gold" onClick={() => setShowAdd((v) => !v)}>
          {showAdd ? t("common.close") : t("sv.add")}
        </button>
      </div>

      {showAdd && (
        <ServiceForm
          onDone={(name) => {
            toast.success(t("sv.addedToast", { name }));
            setShowAdd(false);
            load();
          }}
          onError={(m) => {
            setErr(m);
            toast.error(m);
          }}
        />
      )}

      {err && <Alert onRetry={load}>{err}</Alert>}

      {!rows && !err && (
        <>
          <KpiSkeleton />
          <TableSkeleton rows={6} cols={6} />
        </>
      )}

      {rows && (
        <>
          <div className="kpi">
            <div className="kpi__card">
              <div className="kpi__label">{t("sv.kpiActive")}</div>
              <div className="kpi__value">{active.length}</div>
              <div className="kpi__sub">{t("sv.kpiActiveSub", { n: rows.length - active.length })}</div>
            </div>
            <div className="kpi__card">
              <div className="kpi__label">{t("sv.kpiRevenue")}</div>
              <div className="kpi__value">{baht(revenue)}</div>
              <div className="kpi__sub">{t("sv.kpiRevenueSub")}</div>
            </div>
            <div className="kpi__card">
              <div className="kpi__label">{t("sv.kpiUnits")}</div>
              <div className="kpi__value">{units.toLocaleString()}</div>
              <div className="kpi__sub">{t("sv.kpiUnitsSub")}</div>
            </div>
            <div className="kpi__card">
              <div className="kpi__label">{t("sv.kpiBest")}</div>
              <div className="kpi__value" style={{ fontSize: 20 }}>
                {best && Number(best.revenue) > 0 ? best.name : "-"}
              </div>
              <div className="kpi__sub">
                {best && Number(best.revenue) > 0 ? baht(best.revenue) : t("sv.noSalesYet")}
              </div>
            </div>
          </div>

          <div className="row" style={{ gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
            <FilterPanel
              fields={advFields}
              values={adv}
              onChange={(k, v) => setAdv((a) => withFilter(a, k, v))}
              onClear={() => setAdv({})}
            />
          </div>

          <div className="panel">
            <div className="panel__head">
              {t("sv.catalog")}
              <span className="tiny">{t("sv.priceLockNote")}</span>
            </div>
            <div className="table-wrap">
              <table className="dtable">
                <thead>
                  <tr>
                    <th>{t("sv.colService")}</th>
                    <th style={{ textAlign: "right" }}>{t("sv.colPrice")}</th>
                    <th style={{ textAlign: "right" }}>{t("sv.colSold")}</th>
                    <th style={{ textAlign: "right" }}>{t("sv.colRevenue")}</th>
                    <th>{t("ov.colStatus")}</th>
                    <th style={{ textAlign: "right" }}>{t("us.colActions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((s) => (
                    <tr key={s.service_id} style={{ opacity: s.is_active ? 1 : 0.62 }}>
                      <td>
                        <strong>{s.name}</strong>
                        {s.description && (
                          <>
                            <br />
                            <span className="tiny">{s.description}</span>
                          </>
                        )}
                        <br />
                        <span className="tiny muted">
                          {t("sv.limit")}: {t(`addons.basis.${s.basis}`)}
                        </span>
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{baht(s.price, true)}</td>
                      <td style={{ textAlign: "right" }}>
                        {s.units_sold.toLocaleString()}
                        <br />
                        <span className="tiny">{t("sv.bookingsCount", { n: s.times_sold.toLocaleString() })}</span>
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{baht(s.revenue)}</td>
                      <td>
                        <span className={`tag ${s.is_active ? "tag--ok" : ""}`}>
                          {s.is_active ? t("sv.active") : t("sv.retired")}
                        </span>
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <button
                          className="btn btn--sm btn--quiet"
                          disabled={busy === s.service_id}
                          onClick={() => setEditing(s)}
                        >
                          {t("sv.edit")}
                        </button>
                        <button
                          className={`btn btn--sm ${s.is_active ? "btn--danger" : "btn--gold"}`}
                          style={{ marginLeft: 6 }}
                          disabled={busy === s.service_id}
                          onClick={() => toggle(s)}
                        >
                          {s.is_active ? t("sv.retire") : t("sv.restore")}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {shown.length === 0 && (
                    <TableEmpty cols={6}>
                      {rows.length === 0 ? t("sv.none") : t("filter.noRowsMatch")}
                    </TableEmpty>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {editing && (
        <Modal onClose={() => setEditing(null)} maxWidth={440} labelledBy="svdlg-title">
          <h3 id="svdlg-title">{t("sv.editTitle", { name: editing.name })}</h3>
          <ServiceForm
            initial={editing}
            onDone={(name) => {
              toast.success(t("sv.savedToast", { name }));
              setEditing(null);
              load();
            }}
            onError={(m) => toast.error(m)}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}
    </>
  );
}

function ServiceForm({
  initial,
  onDone,
  onError,
  onCancel,
}: {
  initial?: ServiceCatalogRow;
  onDone: (name: string) => void;
  onError: (m: string) => void;
  onCancel?: () => void;
}) {
  const { t } = useT();
  const [name, setName] = useState(initial?.name ?? "");
  const [price, setPrice] = useState(initial ? Number(initial.price).toFixed(2) : "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [busy, setBusy] = useState(false);
  const parsed = parsePrice(price);
  const valid = name.trim().length > 0 && name.trim().length <= 80 && parsed != null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || parsed == null) return;
    setBusy(true);
    try {
      const body = {
        name: name.trim(),
        price: parsed,
        description: description.trim() || null,
      };
      if (initial) await api.update(initial.service_id, body);
      else await api.create(body);
      onDone(body.name);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : t("sv.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  const fields = (
    <>
      <Field
        label={t("sv.nameLabel")}
        value={name}
        maxLength={80}
        required
        onChange={(e) => setName(e.target.value)}
      />
      <Field
        label={t("sv.priceLabel")}
        type="number"
        inputMode="decimal"
        min={0}
        step={0.01}
        value={price}
        required
        onChange={(e) => setPrice(e.target.value)}
        hint={price && parsed == null ? t("sv.priceInvalid") : undefined}
      />
      <Field
        label={t("sv.descLabel")}
        value={description}
        maxLength={255}
        onChange={(e) => setDescription(e.target.value)}
        hint={t("sv.descHint")}
      />
    </>
  );

  if (initial) {
    return (
      <form className="stack stack--tight" style={{ marginTop: 16 }} onSubmit={submit}>
        {fields}
        <p className="tiny">{t("sv.priceLockNote")}</p>
        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn btn--sm btn--quiet" onClick={onCancel}>
            {t("account.cancelBtn")}
          </button>
          <button className="btn btn--sm btn--gold" disabled={busy || !valid}>
            {busy ? <Spinner /> : t("sv.save")}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form className="panel" style={{ marginBottom: 20 }} onSubmit={submit}>
      <div className="panel__head">{t("sv.newPanel")}</div>
      <div
        style={{
          padding: 20,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 14,
          alignItems: "end",
        }}
      >
        {fields}
        <div>
          <button className="btn btn--sm btn--gold" disabled={busy || !valid}>
            {busy ? <Spinner /> : t("sv.add")}
          </button>
        </div>
      </div>
    </form>
  );
}
