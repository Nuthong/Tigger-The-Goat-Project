import { describe, expect, it } from "vitest";
import { pageRange } from "./pagination";

describe("pageRange", () => {
  it("hides itself and reports an empty range when the set is empty", () => {
    const r = pageRange(0, 25, 0);
    expect(r).toMatchObject({ from: 0, to: 0, page: 1, pages: 1, singlePage: true });
    expect(r.atStart && r.atEnd).toBe(true);
  });

  it("is a single page when the set fits inside the limit", () => {
    expect(pageRange(0, 25, 25).singlePage).toBe(true);
    expect(pageRange(0, 25, 26).singlePage).toBe(false);
  });

  it("labels the first page 1-N and disables only Prev", () => {
    const r = pageRange(0, 25, 60);
    expect([r.from, r.to]).toEqual([1, 25]);
    expect(r).toMatchObject({ page: 1, pages: 3, atStart: true, atEnd: false });
  });

  it("labels a middle page and disables neither end", () => {
    const r = pageRange(25, 25, 60);
    expect([r.from, r.to]).toEqual([26, 50]);
    expect(r).toMatchObject({ page: 2, atStart: false, atEnd: false });
  });

  it("shortens the final page and disables only Next", () => {
    const r = pageRange(50, 25, 60);
    expect([r.from, r.to]).toEqual([51, 60]);
    expect(r).toMatchObject({ page: 3, pages: 3, atStart: false, atEnd: true });
  });

  it("treats an exact multiple as a full last page", () => {
    const r = pageRange(50, 25, 75);
    expect([r.from, r.to]).toEqual([51, 75]);
    expect(r).toMatchObject({ pages: 3, atEnd: true });
  });

  it("clamps a stale offset that overshot the set back onto the last row", () => {
    const r = pageRange(9999, 25, 60);
    expect(r.to).toBe(60);
    expect(r.atEnd).toBe(true);
    expect(r.from).toBeLessThanOrEqual(60);
  });

  it("guards against a zero or negative limit", () => {
    expect(pageRange(0, 0, 10).singlePage).toBe(false);
    expect(pageRange(0, -5, 10).to).toBe(1);
  });
});
