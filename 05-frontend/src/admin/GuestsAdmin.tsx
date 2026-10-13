import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { customers, ApiError } from "../lib/api";
import type { CustomerRow } from "../lib/types";
import { Alert, Pager, TableEmpty, TableSkeleton, TierBadge } from "../components/ui";
import { FilterPanel, type FilterField } from "../components/FilterPanel";
import { withFilter } from "../lib/filters";
import { baht, fmtDate } from "../lib/format";
import { TIER_NAMES, tierFor, tierNightRange } from "../lib/loyalty";
import { useT } from "../i18n/I18n";

const PAGE = 50;

export function GuestsAdmin() {
  const { t, lang } = useT();
  const [rows, setRows] = useState<CustomerRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [err, setErr] = useState("");
  const [adv, setAdv] = useState<Record<string, string>>({});

  // one filter per column of the register
  const advFields: FilterField[] = [
    { type: "text", key: "name", label: t("ga.colGuest") },
    { type: "text", key: "email", label: t("ga.colEmail") },
    { type: "text", key: "phone", label: t("ga.colPhone") },
    {
      type: "select",
      key: "tier",
      label: t("ga.colTier"),
      options: TIER_NAMES.map((n) => ({ value: n, label: n })),
    },
    { type: "number-range", label: t("ga.colTrips"), from: "min_trips", to: "max_trips", min: 0 },
    { type: "number-range", label: t("ga.colNights"), from: "min_nights", to: "max_nights", min: 0 },
    {
      type: "number-range",
      label: t("ga.colLifetimeValue"),
      from: "min_ltv",
      to: "max_ltv",
      min: 0,
      prefix: "฿",
    },
    { type: "date-range", label: t("ga.colSince"), from: "joined_from", to: "joined_to" },
  ];

  // reset to the first page whenever the query changes
  useEffect(() => setOffset(0), [q, adv]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setRows(null);
      setErr("");
      // the tier is a band of nights stayed - intersect it with any nights range
      const query = { ...adv };
      delete query.tier;
      const band = adv.tier ? tierNightRange(adv.tier) : null;
      if (band) {
        const lo = Math.max(band[0], Number(query.min_nights || 0));
        query.min_nights = String(lo);
        if (band[1] !== null) {
          const hi = query.max_nights ? Math.min(band[1], Number(query.max_nights)) : band[1];
          query.max_nights = String(hi);
        }
      }
      customers
        .list({ q, limit: PAGE, offset }, query)
        .then((p) => {
          setTotal(p.total);
          setRows(p.items);
        })
        .catch((e) => setErr(e instanceof ApiError ? e.message : t("common.failedToLoad")));
    }, 250);
    return () => clearTimeout(timer);
  }, [q, offset, adv, t]);

  return (
    <>
      <div className="admin__head">
        <div>
          <p className="eyebrow">{t("ga.eyebrow")}</p>
          <h1>{t("ga.title")}</h1>
        </div>
        <span className="muted">
          {total.toLocaleString()} {t("ga.totalWord")}
        </span>
      </div>

      <div className="row" style={{ gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div className="field" style={{ maxWidth: 320, margin: 0 }}>
          <input
            placeholder={t("ga.searchPlaceholder")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <FilterPanel
          fields={advFields}
          values={adv}
          onChange={(k, v) => setAdv((a) => withFilter(a, k, v))}
          onClear={() => setAdv({})}
        />
      </div>

      {err && <Alert>{err}</Alert>}
      {!rows && !err && <TableSkeleton rows={8} cols={6} />}

      {rows && (
        <div className="panel">
          <div className="table-wrap">
            <table className="dtable">
              <thead>
                <tr>
                  <th>{t("ga.colGuest")}</th>
                  <th>{t("ga.colEmail")}</th>
                  <th>{t("ga.colPhone")}</th>
                  <th>{t("ga.colTier")}</th>
                  <th style={{ textAlign: "right" }}>{t("ga.colTrips")}</th>
                  <th style={{ textAlign: "right" }}>{t("ga.colNights")}</th>
                  <th style={{ textAlign: "right" }}>{t("ga.colLifetimeValue")}</th>
                  <th>{t("ga.colSince")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.customer_id}>
                    <td>
                      <Link to={`/admin/guests/${c.customer_id}`}>
                        {c.first_name} {c.last_name}
                      </Link>
                    </td>
                    <td className="muted">{c.email}</td>
                    <td className="muted">{c.phone ?? "-"}</td>
                    <td>
                      <TierBadge tier={tierFor(c.nights).name} />
                    </td>
                    <td style={{ textAlign: "right" }}>{c.trips}</td>
                    <td style={{ textAlign: "right" }}>{c.nights}</td>
                    <td style={{ textAlign: "right" }}>
                      {baht(c.lifetime_value, true)}
                    </td>
                    <td className="muted">{fmtDate(c.created_at.slice(0, 10), lang)}</td>
                  </tr>
                ))}
                {rows.length === 0 && <TableEmpty cols={8}>{t("ga.noneMatch")}</TableEmpty>}
              </tbody>
            </table>
          </div>
          <Pager offset={offset} limit={PAGE} total={total} onOffset={setOffset} />
        </div>
      )}
    </>
  );
}
