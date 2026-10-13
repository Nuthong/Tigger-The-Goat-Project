import { useCallback, useEffect, useState } from "react";
import { adminApi, ApiError } from "../lib/api";
import type { AuditRow } from "../lib/types";
import { Alert, Pager, TableEmpty, TableSkeleton } from "../components/ui";
import { FilterPanel, type FilterField } from "../components/FilterPanel";
import { withFilter } from "../lib/filters";
import { useT } from "../i18n/I18n";

const PAGE = 50;

/** Every kind of record the app writes to the audit trail. */
const ENTITY_TYPES = [
  "booking",
  "room",
  "room_type",
  "customer",
  "service",
  "rate_plan",
  "invoice",
  "housekeeping_task",
  "maintenance_ticket",
  "app_user",
] as const;

function fmtWhen(iso: string, lang: "en" | "th"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(lang === "th" ? "th-TH" : "en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function Audit() {
  const { t, lang } = useT();
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [err, setErr] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [adv, setAdv] = useState<Record<string, string>>({});

  // one filter per column
  const advFields: FilterField[] = [
    { type: "date-range", label: t("au.colWhen"), from: "at_from", to: "at_to" },
    { type: "text", key: "actor", label: t("au.colActor") },
    { type: "text", key: "action", label: t("au.action"), placeholder: "booking." },
    {
      type: "select",
      key: "entity_type",
      label: t("au.colEntity"),
      options: ENTITY_TYPES.map((e) => ({ value: e, label: e })),
    },
    { type: "text", key: "entity_id", label: t("au.entityId"), placeholder: "42" },
    { type: "text", key: "summary", label: t("au.colSummary") },
  ];

  // a changed filter starts again from the first page
  useEffect(() => setOffset(0), [adv]);

  const load = useCallback(() => {
    setRows(null);
    setErr("");
    adminApi
      .audit({ limit: PAGE, offset }, adv)
      .then((p) => {
        setTotal(p.total);
        setRows(p.items);
      })
      .catch((e) => setErr(e instanceof ApiError ? e.message : t("common.failedToLoad")));
  }, [offset, adv, t]);

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <>
      <div className="admin__head">
        <div>
          <p className="eyebrow">{t("au.eyebrow")}</p>
          <h1>{t("au.title")}</h1>
        </div>
        <span className="muted">{t("au.entries", { n: total.toLocaleString() })}</span>
      </div>

      <div className="row" style={{ gap: 14, marginBottom: 16 }}>
        <FilterPanel
          fields={advFields}
          values={adv}
          onChange={(k, v) => setAdv((a) => withFilter(a, k, v))}
          onClear={() => setAdv({})}
        />
      </div>

      {err && <Alert onRetry={load}>{err}</Alert>}
      {!rows && !err && <TableSkeleton rows={10} cols={4} />}

      {rows && (
        <div className="panel">
          <div className="table-wrap">
            <table className="dtable">
              <thead>
                <tr>
                  <th>{t("au.colWhen")}</th>
                  <th>{t("au.colActor")}</th>
                  <th>{t("au.action")}</th>
                  <th>{t("au.colEntity")}</th>
                  <th>{t("au.colSummary")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.audit_id}
                    style={{ cursor: r.data ? "pointer" : "default" }}
                    onClick={() => r.data && setExpanded(expanded === r.audit_id ? null : r.audit_id)}
                  >
                    <td style={{ whiteSpace: "nowrap" }}>{fmtWhen(r.at, lang)}</td>
                    <td>{r.actor_label ?? <span className="muted">{t("au.system")}</span>}</td>
                    <td><span className="tag">{r.action}</span></td>
                    <td className="tiny">
                      {r.entity_type}
                      {r.entity_id ? ` #${r.entity_id}` : ""}
                    </td>
                    <td>
                      {r.summary ?? "-"}
                      {expanded === r.audit_id && r.data && (
                        <pre
                          className="tiny"
                          style={{
                            marginTop: 8,
                            padding: 10,
                            background: "var(--bg-alt)",
                            borderRadius: 8,
                            overflow: "auto",
                          }}
                        >
                          {JSON.stringify(r.data, null, 2)}
                        </pre>
                      )}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <TableEmpty cols={5}>{t("au.noneMatch")}</TableEmpty>
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
