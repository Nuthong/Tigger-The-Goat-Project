/**
 * Maintenance backlog aging - groups the open tickets from `v_maintenance_open`
 * by how long they have waited, the way an engineering lead reads a backlog.
 */
import type { MaintenanceBacklogRow } from "./types";

export type AgeBucket = "today" | "week" | "month" | "older";

export const AGE_BUCKETS: readonly AgeBucket[] = ["today", "week", "month", "older"] as const;

/** 0 days -> today · 1-7 -> this week · 8-30 -> this month · 31+ -> older. */
export function ageBucket(days: number): AgeBucket {
  if (!Number.isFinite(days) || days <= 0) return "today";
  if (days <= 7) return "week";
  if (days <= 30) return "month";
  return "older";
}

export interface BacklogSummary {
  open: number;
  urgent: number;
  unassigned: number;
  oldestDays: number;
  avgDays: number;
  buckets: Record<AgeBucket, number>;
}

export function summariseBacklog(rows: MaintenanceBacklogRow[]): BacklogSummary {
  const buckets: Record<AgeBucket, number> = { today: 0, week: 0, month: 0, older: 0 };
  let total = 0;
  let oldest = 0;
  for (const r of rows) {
    buckets[ageBucket(r.age_days)] += 1;
    total += Math.max(0, r.age_days);
    oldest = Math.max(oldest, r.age_days);
  }
  return {
    open: rows.length,
    urgent: rows.filter((r) => r.priority === "urgent").length,
    unassigned: rows.filter((r) => !r.assigned_to_name).length,
    oldestDays: oldest,
    avgDays: rows.length ? Math.round((total / rows.length) * 10) / 10 : 0,
    buckets,
  };
}
