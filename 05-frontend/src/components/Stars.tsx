import { useT } from "../i18n/I18n";

/**
 * Read-only star rating. `value` is 0-5 and may be fractional - the row shows a
 * partial last star via a clip. Purely presentational; the interactive picker on
 * the review form is a plain <select>.
 */
export function Stars({
  value,
  size = 16,
  showValue = false,
}: {
  value: number | string | null;
  size?: number;
  showValue?: boolean;
}) {
  const { t } = useT();
  const v = Math.max(0, Math.min(5, Number(value) || 0));
  const pct = (v / 5) * 100;
  return (
    <span
      className="stars"
      style={{ fontSize: size, lineHeight: 1 }}
      aria-label={t("rating.outOf5", { v: v.toFixed(1) })}
    >
      <span className="stars__track" aria-hidden>
        ★★★★★
        <span className="stars__fill" style={{ width: `${pct}%` }}>
          ★★★★★
        </span>
      </span>
      {showValue && <b className="stars__num">{v.toFixed(1)}</b>}
    </span>
  );
}

/**
 * The i18n key for "Excellent" / "Very good" ... - the label hotels put next to
 * the score. Pure (no hook), so callers do `t(ratingWordKey(value))`.
 */
export function ratingWordKey(value: number | string | null): string {
  const v = Number(value) || 0;
  if (v >= 4.5) return "rating.exceptional";
  if (v >= 4) return "rating.excellent";
  if (v >= 3.5) return "rating.veryGood";
  if (v >= 3) return "rating.good";
  if (v > 0) return "rating.fair";
  return "rating.notRatedYet";
}
