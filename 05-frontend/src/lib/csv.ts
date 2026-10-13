/** Turn an array of records into a CSV string and hand it to the browser as a
 *  download - used by the management reports so accounting can pull the figures
 *  into a spreadsheet. */

export interface CsvColumn<T> {
  header: string;
  /** cell value; numbers and strings are written as-is, everything else String()-ed */
  value: (row: T) => string | number;
}

function cell(v: string | number): string {
  const s = typeof v === "number" ? String(v) : v;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const head = columns.map((c) => cell(c.header)).join(",");
  const body = rows.map((r) => columns.map((c) => cell(c.value(r))).join(","));
  // BOM so Excel opens UTF-8 correctly; CRLF line endings per RFC 4180
  return "﻿" + [head, ...body].join("\r\n") + "\r\n";
}

export function downloadCsv(filename: string, body: string): void {
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
