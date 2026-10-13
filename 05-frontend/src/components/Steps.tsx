/** The guest booking flow: Dates → Review → Payment → Confirmed. */
const STEPS = ["Dates", "Review", "Payment", "Confirmed"] as const;

export function Steps({ current }: { current: number }) {
  return (
    <ol className="steps" aria-label="Booking progress">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const state = n < current ? "done" : n === current ? "active" : "todo";
        return (
          <li
            key={label}
            className={`steps__item is-${state}`}
            aria-current={n === current ? "step" : undefined}
          >
            <span className="steps__dot">{n < current ? "✓" : n}</span>
            <span className="steps__label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
