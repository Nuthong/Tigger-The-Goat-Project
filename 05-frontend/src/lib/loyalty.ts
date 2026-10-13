/** A light loyalty ladder driven by nights actually stayed with us. */
export interface Tier {
  name: string;
  /** minimum nights to reach this tier */
  min: number;
  /** nights needed for the next tier, or null at the top */
  toNext: number | null;
  next: string | null;
}

const LADDER: { name: string; min: number }[] = [
  { name: "Classic", min: 0 },
  { name: "Silver", min: 5 },
  { name: "Gold", min: 15 },
  { name: "Platinum", min: 30 },
];

/** Every tier name, lowest first. */
export const TIER_NAMES = LADDER.map((t) => t.name);

/** The nights a tier spans: [min, max], max null at the top of the ladder. */
export function tierNightRange(name: string): [number, number | null] | null {
  const i = LADDER.findIndex((t) => t.name === name);
  if (i < 0) return null;
  const up = LADDER[i + 1];
  return [LADDER[i].min, up ? up.min - 1 : null];
}

export function tierFor(nights: number): Tier {
  let idx = 0;
  for (let i = 0; i < LADDER.length; i++) {
    if (nights >= LADDER[i].min) idx = i;
  }
  const here = LADDER[idx];
  const up = LADDER[idx + 1] ?? null;
  return {
    name: here.name,
    min: here.min,
    toNext: up ? up.min - nights : null,
    next: up ? up.name : null,
  };
}
