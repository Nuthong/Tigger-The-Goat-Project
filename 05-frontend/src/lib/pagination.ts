/**
 * Pure paging arithmetic shared by every server-paged table (via `<Pager>`).
 * Kept separate from the component so the edge cases - empty sets, an exact
 * multiple of the page size, a short final page - are unit-tested without a DOM.
 */
export interface PageRange {
  /** 1-based index of the first row on this page (0 when the set is empty). */
  from: number;
  /** 1-based index of the last row on this page. */
  to: number;
  /** this page's number, 1-based. */
  page: number;
  /** how many pages the set spans (at least 1). */
  pages: number;
  /** on the first page - the "Prev" control should be disabled. */
  atStart: boolean;
  /** on the last page - the "Next" control should be disabled. */
  atEnd: boolean;
  /** the whole set fits on one page - a pager need not be shown at all. */
  singlePage: boolean;
}

export function pageRange(offset: number, limit: number, total: number): PageRange {
  const lim = Math.max(1, Math.floor(limit));
  const count = Math.max(0, Math.floor(total));
  // clamp a stale offset (e.g. after the set shrank) back onto a real page
  const start = Math.min(Math.max(0, Math.floor(offset)), Math.max(0, count - 1));
  const pages = Math.max(1, Math.ceil(count / lim));
  const from = count === 0 ? 0 : start + 1;
  const to = Math.min(start + lim, count);
  return {
    from,
    to,
    page: Math.floor(start / lim) + 1,
    pages,
    atStart: start === 0,
    atEnd: to >= count,
    singlePage: count <= lim,
  };
}
