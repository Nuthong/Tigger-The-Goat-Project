import { describe, expect, it } from "vitest";
import { ageBucket, summariseBacklog } from "./backlog";
import type { MaintenanceBacklogRow } from "./types";

function row(over: Partial<MaintenanceBacklogRow>): MaintenanceBacklogRow {
  return {
    ticket_id: 1,
    title: "Leak",
    category: "plumbing",
    priority: "normal",
    status: "open",
    room_number: "101",
    reported_by_name: "A B",
    assigned_to_name: null,
    created_at: "2026-09-01T00:00:00Z",
    age_days: 0,
    ...over,
  };
}

describe("ageBucket", () => {
  it("splits at 0 / 7 / 30 days", () => {
    expect(ageBucket(0)).toBe("today");
    expect(ageBucket(1)).toBe("week");
    expect(ageBucket(7)).toBe("week");
    expect(ageBucket(8)).toBe("month");
    expect(ageBucket(30)).toBe("month");
    expect(ageBucket(31)).toBe("older");
  });

  it("treats a negative or bad age as today", () => {
    expect(ageBucket(-2)).toBe("today");
    expect(ageBucket(Number.NaN)).toBe("today");
  });
});

describe("summariseBacklog", () => {
  it("counts, ages and buckets the open tickets", () => {
    const s = summariseBacklog([
      row({ ticket_id: 1, age_days: 0, priority: "urgent" }),
      row({ ticket_id: 2, age_days: 5, assigned_to_name: "C D" }),
      row({ ticket_id: 3, age_days: 40 }),
    ]);
    expect(s.open).toBe(3);
    expect(s.urgent).toBe(1);
    expect(s.unassigned).toBe(2);
    expect(s.oldestDays).toBe(40);
    expect(s.avgDays).toBe(15);
    expect(s.buckets).toEqual({ today: 1, week: 1, month: 0, older: 1 });
  });

  it("is all zeros for an empty backlog", () => {
    const s = summariseBacklog([]);
    expect(s.open).toBe(0);
    expect(s.avgDays).toBe(0);
    expect(s.oldestDays).toBe(0);
  });
});
