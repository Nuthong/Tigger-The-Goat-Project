import { useCallback, useEffect, useState } from "react";
import { adminApi, ApiError } from "../lib/api";
import type { AuthEventRow, AuthEventStats, AuthEventType } from "../lib/types";
import { Alert, ChipBar, KpiSkeleton, Pager, TableEmpty, TableSkeleton } from "../components/ui";
import { FilterPanel, type FilterField } from "../components/FilterPanel";
import { withFilter } from "../lib/filters";
import { useT } from "../i18n/I18n";

const PAGE = 50;
const FILTERS = ["all", "login_success", "login_fail", "locked", "logout", "password_change"] as const;
type Filter = (typeof FILTERS)[number];

const TONE: Record<AuthEventType, string> = {
  login_success: "tag--ok",
  login_fail: "tag--warn",
  locked: "tag--danger",
  logout: "",
  password_change: "tag--info",
};

function fmtWhen(iso: string, lang: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(lang === "th" ? "th-TH" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** A short browser label from a user-agent string, for the table column. */
function browserOf(ua: string | null): string {
  if (!ua) return "-";
  if (/curl|python|httpx|wget/i.test(ua)) return ua.split(" ")[0];
  const os = /Windows/i.test(ua)
    ? "Windows"
    : /Mac/i.test(ua)
      ? "macOS"
      : /Android/i.test(ua)
        ? "Android"
        : /iPhone|iPad|iOS/i.test(ua)
          ? "iOS"
          : /Linux/i.test(ua)
            ? "Linux"
            : "";
  const br = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  return os ? `${br} · ${os}` : br;
}

/** The sign-in log (`auth_event`) - who signed in, who failed, which accounts
 *  locked, from where. Admin only. */
export function SecurityLog() {
  const { t, lang } = useT();
  const [rows, setRows] = useState<AuthEventRow[] | null>(null);
  const [stats, setStats] = useState<AuthEventStats | null>(null);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<Filter>("all");
  const [offset, setOffset] = useState(0);
  const [adv, setAdv] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");

  const eventLabel = (e: string) => t(`sec.ev.${e}`);
  // one filter per column (the event kind has the chip bar); `q` is the
  // API's username match
  const advFields: FilterField[] = [
    { type: "date-range", label: t("au.colWhen"), from: "at_from", to: "at_to" },
    { type: "text", key: "q", label: t("sec.colUser"), placeholder: "recep01" },
    { type: "text", key: "ip", label: t("sec.colIp"), placeholder: "172.18." },
    {
      type: "select",
      key: "browser",
      label: t("sec.colBrowser"),
      options: [
        // user-agent substrings: Edge also says "Chrome/", so "Chrome" means
        // any Chromium browser; Safari is left out - every Chromium UA says "Safari/"
        { value: "Edg/", label: "Edge" },
        { value: "Chrome/", label: "Chrome / Chromium" },
        { value: "Firefox/", label: "Firefox" },
        { value: "Windows", label: "Windows" },
        { value: "Mac OS", label: "macOS" },
        { value: "Android", label: "Android" },
        { value: "iPhone", label: "iOS" },
        { value: "python", label: "python / httpx" },
        { value: "curl", label: "curl" },
      ],
    },
  ];

  useEffect(() => setOffset(0), [filter, adv]);

  useEffect(() => {
    adminApi
      .authEventStats(30)
      .then(setStats)
      .catch(() => setStats(null));
  }, []);

  const load = useCallback(() => {
    setRows(null);
    setErr("");
    adminApi
      .authEvents({ event_type: filter === "all" ? undefined : filter, limit: PAGE, offset }, adv)
      .then((p) => {
        setRows(p.items);
        setTotal(p.total);
      })
      .catch((e) => setErr(e instanceof ApiError ? e.message : t("common.failedToLoad")));
  }, [filter, offset, adv, t]);

  useEffect(() => load(), [load]);

  return (
    <>
      <div className="admin__head">
        <div>
          <p className="eyebrow">{t("au.eyebrow")}</p>
          <h1>{t("sec.title")}</h1>
        </div>
        <span className="muted">{t("au.entries", { n: total.toLocaleString() })}</span>
      </div>

      {!stats && <KpiSkeleton />}
      {stats && (
        <div className="kpi">
          <div className="kpi__card">
            <div className="kpi__label">{t("sec.kpiSuccess")}</div>
            <div className="kpi__value">{stats.login_success.toLocaleString()}</div>
            <div className="kpi__sub">
              {t("sec.kpiSuccessSub", { n: stats.distinct_users, d: stats.days })}
            </div>
          </div>
          <div className="kpi__card">
            <div className="kpi__label">{t("sec.kpiFail")}</div>
            <div className="kpi__value">{stats.login_fail.toLocaleString()}</div>
            <div className="kpi__sub">{t("sec.kpiDays", { d: stats.days })}</div>
          </div>
          <div className="kpi__card">
            <div className="kpi__label">{t("sec.kpiLocked")}</div>
            <div className="kpi__value">{stats.locked.toLocaleString()}</div>
            <div className="kpi__sub">{t("sec.kpiLockedSub")}</div>
          </div>
          <div className="kpi__card">
            <div className="kpi__label">{t("sec.kpiPassword")}</div>
            <div className="kpi__value">{stats.password_change.toLocaleString()}</div>
            <div className="kpi__sub">{t("sec.kpiDays", { d: stats.days })}</div>
          </div>
        </div>
      )}

      <div className="row" style={{ gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <ChipBar
          options={FILTERS}
          value={filter}
          onChange={setFilter}
          label={(f) => (f === "all" ? t("status.all") : eventLabel(f))}
        />
        <FilterPanel
          fields={advFields}
          values={adv}
          onChange={(k, v) => setAdv((a) => withFilter(a, k, v))}
          onClear={() => setAdv({})}
        />
      </div>

      {err && <Alert onRetry={load}>{err}</Alert>}
      {!rows && !err && <TableSkeleton rows={10} cols={5} />}

      {rows && (
        <div className="panel">
          <div className="table-wrap">
            <table className="dtable">
              <thead>
                <tr>
                  <th>{t("au.colWhen")}</th>
                  <th>{t("sec.colUser")}</th>
                  <th>{t("sec.colEvent")}</th>
                  <th>{t("sec.colIp")}</th>
                  <th>{t("sec.colBrowser")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.event_id}>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtWhen(r.created_at, lang)}</td>
                    <td>
                      <strong>{r.username ?? "-"}</strong>
                      <br />
                      <span className="tiny">
                        {r.role
                          ? t(`role.${r.role}`)
                          : r.user_id == null
                            ? t("sec.unknownAccount")
                            : "-"}
                      </span>
                    </td>
                    <td>
                      <span className={`tag ${TONE[r.event_type] ?? ""}`}>
                        {eventLabel(r.event_type)}
                      </span>
                    </td>
                    <td className="tiny" style={{ fontFamily: "ui-monospace, monospace" }}>
                      {r.ip_address ?? "-"}
                    </td>
                    <td className="tiny" title={r.user_agent ?? undefined}>
                      {browserOf(r.user_agent)}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <TableEmpty cols={5}>{t("sec.none")}</TableEmpty>}
              </tbody>
            </table>
          </div>
          <Pager offset={offset} limit={PAGE} total={total} onOffset={setOffset} />
        </div>
      )}
    </>
  );
}
