import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

interface Row {
  name: string;
  qty: number;
}

describe("toCsv", () => {
  const cols = [
    { header: "Name", value: (r: Row) => r.name },
    { header: "Qty", value: (r: Row) => r.qty },
  ];

  it("writes a BOM, a header row and CRLF line endings", () => {
    const out = toCsv([{ name: "Room 101", qty: 2 }], cols);
    expect(out.startsWith("﻿")).toBe(true);
    expect(out).toBe("﻿Name,Qty\r\nRoom 101,2\r\n");
  });

  it("quotes cells that contain a comma, quote or newline", () => {
    const out = toCsv([{ name: 'Smith, "Al"', qty: 1 }], cols);
    expect(out).toContain('"Smith, ""Al"""');
  });

  it("handles an empty row set (header only)", () => {
    expect(toCsv([], cols)).toBe("﻿Name,Qty\r\n");
  });
});
