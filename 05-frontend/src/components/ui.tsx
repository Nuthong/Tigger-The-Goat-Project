import type { CSSProperties, InputHTMLAttributes, ReactNode } from "react";
import type { BookingStatus } from "../lib/types";
import { pageRange } from "../lib/pagination";
import { useT } from "../i18n/I18n";

export function Spinner() {
  return <span className="spinner" role="status" aria-label="loading" />;
}

/** A single shimmering placeholder block. */
export function Skeleton({
  w,
  h = 14,
  radius = 6,
  style,
}: {
  w?: number | string;
  h?: number | string;
  radius?: number;
  style?: CSSProperties;
}) {
  return (
    <span
      className="skeleton"
      aria-hidden
      style={{ width: w ?? "100%", height: h, borderRadius: radius, ...style }}
    />
  );
}

/** A panel-framed table placeholder that matches the real data grid's shape. */
export function TableSkeleton({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="panel skeleton-block" role="status" aria-label="loading">
      <div className="table-wrap">
        <table className="dtable">
          <thead>
            <tr>
              {Array.from({ length: cols }).map((_, i) => (
                <th key={i}>
                  <Skeleton w={i === 0 ? 90 : 60} h={10} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }).map((_, r) => (
              <tr key={r}>
                {Array.from({ length: cols }).map((_, c) => (
                  <td key={c}>
                    <Skeleton w={c === 0 ? "70%" : `${45 + ((r + c) % 4) * 12}%`} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** A grid of shimmering cards - for room boards, tile views, guest stay lists. */
export function CardsSkeleton({ count = 6, height = 120 }: { count?: number; height?: number }) {
  return (
    <div className="skeleton-cards" role="status" aria-label="loading">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton-card">
          <Skeleton h={height} radius={10} />
        </div>
      ))}
    </div>
  );
}

/** Four shimmering KPI cards, for a dashboard header. */
export function KpiSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="kpi" role="status" aria-label="loading">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="kpi__card">
          <Skeleton w={70} h={9} />
          <Skeleton w={110} h={24} style={{ marginTop: 10 }} />
          <Skeleton w={130} h={9} style={{ marginTop: 8 }} />
        </div>
      ))}
    </div>
  );
}

export function Money({ value, per }: { value: string | number; per?: string }) {
  const n = typeof value === "string" ? Number(value) : value;
  return (
    <span className="price">
      ฿{n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      {per ? <small> / {per}</small> : null}
    </span>
  );
}

const STATUS_TONE: Record<BookingStatus, string> = {
  pending: "tag--warn",
  confirmed: "tag--info",
  checked_in: "tag--ok",
  checked_out: "tag",
  cancelled: "tag--danger",
};

export function StatusTag({ status }: { status: BookingStatus }) {
  const { t } = useT();
  return <span className={`tag ${STATUS_TONE[status]}`}>{t(`status.${status}`)}</span>;
}

const TIER_COLOR: Record<string, string> = {
  Classic: "#8a8378",
  Silver: "#8d97a3",
  Gold: "#b0872f",
  Platinum: "#5b6b74",
};
const TIER_KEY: Record<string, string> = {
  Classic: "tier.classic",
  Silver: "tier.silver",
  Gold: "tier.gold",
  Platinum: "tier.platinum",
};

/** A small loyalty-tier pill (Classic / Silver / Gold / Platinum). */
export function TierBadge({ tier }: { tier: string }) {
  const { t } = useT();
  const c = TIER_COLOR[tier] ?? "#8a8378";
  const label = TIER_KEY[tier] ? t(TIER_KEY[tier]) : tier;
  return (
    <span
      className="tierbadge"
      style={{ color: c, borderColor: c, background: `${c}1a` }}
      title={t("tier.member", { tier: label })}
    >
      {label}
    </span>
  );
}

/** A row of mutually-exclusive filter chips (status filters, etc.). */
export function ChipBar<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  label: (v: T) => string;
}) {
  return (
    <div className="chipbar" role="tablist">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="tab"
          aria-selected={value === o}
          className={`chip${value === o ? " is-active" : ""}`}
          onClick={() => onChange(o)}
        >
          {label(o)}
        </button>
      ))}
    </div>
  );
}

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
}

export function Field({ label, hint, ...rest }: FieldProps) {
  return (
    <label className="field">
      <span>{label}</span>
      <input {...rest} />
      {hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

/**
 * A centred "nothing here" panel - a headline, an optional hint line, and an
 * optional row of actions (buttons / links passed as children). Used for
 * no-results and no-data states so they read the same everywhere.
 */
export function EmptyState({
  title,
  hint,
  compact = false,
  children,
}: {
  title: ReactNode;
  hint?: ReactNode;
  compact?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="card card--flat center" style={{ padding: compact ? "24px" : "48px 24px" }}>
      <p className="lede" style={{ margin: 0 }}>
        {title}
      </p>
      {hint ? (
        <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
          {hint}
        </p>
      ) : null}
      {children ? (
        <div className="row" style={{ justifyContent: "center", marginTop: 16, flexWrap: "wrap" }}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** The "no rows" line inside a data table - a full-width muted cell. */
export function TableEmpty({ cols, children }: { cols: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={cols} className="muted" style={{ padding: "28px 14px" }}>
        {children}
      </td>
    </tr>
  );
}

/**
 * Prev / next pager strip for a server-paged table - sits inside `.panel`,
 * below the `.table-wrap`. Renders nothing while everything fits on one page.
 * `onOffset` is handed the new offset to load.
 */
export function Pager({
  offset,
  limit,
  total,
  onOffset,
}: {
  offset: number;
  limit: number;
  total: number;
  onOffset: (next: number) => void;
}) {
  const { from, to, atStart, atEnd, singlePage } = pageRange(offset, limit, total);
  if (singlePage) return null;
  return (
    <div className="panel__head" style={{ borderTop: "1px solid var(--line)", borderBottom: 0 }}>
      <span className="muted">
        {from.toLocaleString()}-{to.toLocaleString()} of {total.toLocaleString()}
      </span>
      <span className="row">
        <button
          className="btn btn--sm btn--quiet"
          disabled={atStart}
          onClick={() => onOffset(Math.max(0, offset - limit))}
        >
          Prev
        </button>
        <button
          className="btn btn--sm btn--quiet"
          disabled={atEnd}
          onClick={() => onOffset(offset + limit)}
        >
          Next
        </button>
      </span>
    </div>
  );
}

export function Alert({
  kind = "error",
  children,
  onRetry,
}: {
  kind?: "error" | "ok";
  children: ReactNode;
  onRetry?: () => void;
}) {
  return (
    <div className={kind === "ok" ? "alert alert--ok" : "alert"} role="alert">
      <span>{children}</span>
      {onRetry && (
        <button type="button" className="alert__retry" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
