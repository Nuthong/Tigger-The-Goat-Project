export interface Slice {
  label: string;
  value: number;
  color: string;
}

/** Dependency-free SVG donut chart with a legend. */
export function Donut({
  data,
  size = 168,
  thickness = 26,
  centerLabel,
  centerValue,
  formatValue = (n) => n.toLocaleString(),
}: {
  data: Slice[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string;
  formatValue?: (n: number) => string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="donut">
      <svg
        className="donut__svg"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={centerLabel ?? "donut chart"}
      >
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--bg-alt)"
            strokeWidth={thickness}
          />
          {data.map((d) => {
            const len = (d.value / total) * c;
            const el = (
              <circle
                key={d.label}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={d.color}
                strokeWidth={thickness}
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
              />
            );
            offset += len;
            return el;
          })}
        </g>
        {(centerValue || centerLabel) && (
          <>
            <text
              className="donut__center"
              x="50%"
              y="48%"
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={size * 0.16}
              fill="var(--ink)"
            >
              {centerValue}
            </text>
            <text
              x="50%"
              y="62%"
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={size * 0.08}
              fill="var(--ink-faint)"
            >
              {centerLabel}
            </text>
          </>
        )}
      </svg>
      <div className="donut__legend">
        {data.map((d) => (
          <div className="donut__row" key={d.label}>
            <span className="donut__sw" style={{ background: d.color }} />
            <span>{d.label}</span>
            <span className="donut__val">
              {formatValue(d.value)} · {Math.round((d.value / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export const CHART_COLORS = [
  "#9c7a3c",
  "#c2a15a",
  "#6b5d49",
  "#8a9a6b",
  "#4a4239",
  "#b0894f",
];
