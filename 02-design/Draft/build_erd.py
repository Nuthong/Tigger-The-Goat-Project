#!/usr/bin/env python3
# =====================================================================
#  build_erd.py  --  generate ER diagram artifacts from the real schema
#
#  input : ../03-database/schema.sql   (single source of truth)
#  output: ERD.md      Mermaid erDiagram  (open on GitHub / VS Code)
#          ERD.drawio  draw.io XML        (open at app.diagrams.net)
#          ERD.svg      standalone SVG    (zoomable, no tooling needed)
#
#  run   : python 02-design/Draft/build_erd.py
#
#  The ERD can never drift from the database: every table, column, key
#  and relationship below is parsed straight out of schema.sql. draw.io
#  and SVG share one grouped, colour-coded, column-based layout so the
#  diagram reads as a system rather than a pile of boxes.
# =====================================================================
from __future__ import annotations

import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCHEMA = HERE.parents[1] / "03-database" / "schema.sql"  # this file lives in 02-design/Draft/


# ---------------------------------------------------------------------
#  1) parse schema.sql
# ---------------------------------------------------------------------
@dataclass
class Column:
    name: str
    type: str
    pk: bool = False
    fk_table: str | None = None
    fk_column: str | None = None
    unique: bool = False
    not_null: bool = False


@dataclass
class Table:
    name: str
    columns: list[Column] = field(default_factory=list)
    unique_groups: list[list[str]] = field(default_factory=list)  # composite UNIQUE(...)
    partial_unique: list[str] = field(default_factory=list)  # UNIQUE ... WHERE (conditional)


def _split_top_level(body: str) -> list[str]:
    """Split a CREATE TABLE body on commas that sit at paren depth 0."""
    items, depth, buf = [], 0, []
    for ch in body:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            items.append("".join(buf))
            buf = []
        else:
            buf.append(ch)
    if "".join(buf).strip():
        items.append("".join(buf))
    return items


_TYPE_MAP = [
    (re.compile(r"^BIGSERIAL$", re.I), "bigint"),
    (re.compile(r"^SERIAL$", re.I), "int"),
    (re.compile(r"^BIGINT$", re.I), "bigint"),
    (re.compile(r"^INT(EGER)?$", re.I), "int"),
    (re.compile(r"^VARCHAR\(.*\)$", re.I), "varchar"),
    (re.compile(r"^CHAR\(.*\)$", re.I), "char"),
    (re.compile(r"^TEXT$", re.I), "text"),
    (re.compile(r"^NUMERIC\(.*\)$", re.I), "numeric"),
    (re.compile(r"^BOOLEAN$", re.I), "boolean"),
    (re.compile(r"^DATE$", re.I), "date"),
    (re.compile(r"^TIMESTAMPTZ$", re.I), "timestamptz"),
    (re.compile(r"^TIMESTAMP$", re.I), "timestamp"),
    (re.compile(r"^INET$", re.I), "inet"),
    (re.compile(r"^JSONB$", re.I), "jsonb"),
]

# words that can never be a column name (start-of-item keywords)
_NON_COLUMN = re.compile(r"^(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN|EXCLUDE)\b", re.I)


def _norm_type(tok: str) -> str:
    for rx, out in _TYPE_MAP:
        if rx.match(tok):
            return out
    return tok.lower()


def parse_schema(sql: str) -> list[Table]:
    # drop `--` comments first: their commas and words would otherwise be read as
    # extra column definitions (the Thai notes in schema.sql contain both)
    sql = re.sub(r"--[^\n]*", "", sql)
    tables: list[Table] = []
    block = re.compile(r"CREATE TABLE (\w+)\s*\((.*?)^\);", re.S | re.M)
    for m in block.finditer(sql):
        tbl = Table(name=m.group(1))
        for raw in _split_top_level(m.group(2)):
            item = " ".join(raw.split()).strip()
            if not item:
                continue
            head = item
            if re.match(r"^CONSTRAINT\b", head, re.I):
                head = re.sub(r"^CONSTRAINT\s+\w+\s*", "", head, flags=re.I)

            up = head.upper()

            # table-level PRIMARY KEY (col, ...)
            if up.startswith("PRIMARY KEY"):
                cols = re.findall(r"\w+", head[head.find("(") + 1 : head.rfind(")")])
                for c in cols:
                    for col in tbl.columns:
                        if col.name == c:
                            col.pk = True
                continue

            # table-level UNIQUE (col, ...)
            if up.startswith("UNIQUE") and "(" in head:
                cols = re.findall(r"\w+", head[head.find("(") + 1 : head.rfind(")")])
                tbl.unique_groups.append(cols)
                if len(cols) == 1:
                    for col in tbl.columns:
                        if col.name == cols[0]:
                            col.unique = True
                continue

            if _NON_COLUMN.match(head):  # CHECK / FOREIGN KEY / leftover
                continue

            # ---- ordinary column definition -------------------------
            toks = head.split()
            name, ctype = toks[0], toks[1] if len(toks) > 1 else "?"
            col = Column(name=name, type=_norm_type(ctype))
            col.pk = bool(re.search(r"\bPRIMARY KEY\b", up))
            col.not_null = col.pk or bool(re.search(r"\bNOT NULL\b", up))
            col.unique = bool(re.search(r"\bUNIQUE\b", up))
            ref = re.search(r"REFERENCES\s+(\w+)\s*\(\s*(\w+)\s*\)", head, re.I)
            if ref:
                col.fk_table, col.fk_column = ref.group(1), ref.group(2)
            tbl.columns.append(col)
        tables.append(tbl)
    # UNIQUE (col) WHERE ... : unique only among some rows (e.g. one live invoice
    # per booking) - still 1:N as a relationship, so it is only recorded
    for m in re.finditer(
        r"CREATE UNIQUE INDEX \w+ ON (\w+) \((\w+)\) WHERE", sql, re.I
    ):
        for t in tables:
            if t.name == m.group(1):
                t.partial_unique.append(m.group(2))
    return tables


# ---------------------------------------------------------------------
#  2) relationships
# ---------------------------------------------------------------------
@dataclass
class Rel:
    parent: str
    child: str
    fk_column: str
    one_to_one: bool  # child side is 0..1 (FK column is UNIQUE)
    optional: bool = False  # parent side is 0..1 (FK column may be NULL)
    conditional: bool = False  # UNIQUE only among some rows (partial index)


def relationships(tables: list[Table]) -> list[Rel]:
    rels: list[Rel] = []
    for t in tables:
        for c in t.columns:
            if c.fk_table:
                rels.append(
                    Rel(
                        parent=c.fk_table,
                        child=t.name,
                        fk_column=c.name,
                        one_to_one=c.unique,
                        optional=not c.not_null,
                        conditional=c.name in t.partial_unique,
                    )
                )
    rels.sort(key=lambda r: (r.parent, r.child, r.fk_column))
    return rels


# ---------------------------------------------------------------------
#  2b) grouped layout  (shared by draw.io + SVG so both look identical)
# ---------------------------------------------------------------------
#: which subject area each table belongs to
GROUPS: dict[str, str] = {
    "customer": "people", "staff": "people",
    "app_user": "auth", "auth_event": "auth", "audit_log": "auth",
    "room_type": "catalog", "room": "catalog", "service": "catalog", "rate_plan": "catalog",
    "booking": "booking", "booking_room": "booking", "booking_service": "booking",
    "review": "booking",
    "payment": "billing", "invoice": "billing", "invoice_line": "billing",
    "room_status_log": "ops", "housekeeping_task": "ops", "maintenance_ticket": "ops",
}

#: pastel fill + matching stroke, one per group (draw.io default ER palette)
PALETTE: dict[str, tuple[str, str]] = {
    "people":  ("#fff2cc", "#d6b656"),   # amber
    "auth":    ("#f8cecc", "#b85450"),   # red
    "catalog": ("#d5e8d4", "#82b366"),   # green
    "booking": ("#dae8fc", "#6c8ebf"),   # blue
    "billing": ("#e1d5e7", "#9673a6"),   # purple
    "ops":     ("#ffe6cc", "#d79b00"),   # orange
}

#: left-to-right column order
GROUP_ORDER = ["people", "auth", "catalog", "booking", "billing", "ops"]

HEADER_H = 28
ROW_H = 24
KEY_W = 44
BOX_W = 236
V_GAP = 46
H_GAP = 132          # column gap — wide enough for a vertical wire bus
MARGIN = 150         # generous top/left margin: the SVG routes wires in the
                     # bands above & below the boxes (never across an entity)


@dataclass
class Box:
    table: Table
    group: str
    x: float
    y: float
    w: float
    h: float

    def row_y(self, col_name: str) -> float:
        """centre-y of a column's row, table-local."""
        for i, c in enumerate(self.table.columns):
            if c.name == col_name:
                return self.y + HEADER_H + i * ROW_H + ROW_H / 2
        return self.y + self.h / 2

    def pk_name(self) -> str | None:
        return next((c.name for c in self.table.columns if c.pk), None)


def layout(tables: list[Table]) -> dict[str, Box]:
    """One column per subject area, tables stacked top-down inside it."""
    boxes: dict[str, Box] = {}
    x = MARGIN
    for g in GROUP_ORDER:
        members = [t for t in tables if GROUPS.get(t.name) == g]
        y = MARGIN
        for t in members:
            h = HEADER_H + ROW_H * len(t.columns)
            boxes[t.name] = Box(t, g, x, y, BOX_W, h)
            y += h + V_GAP
        if members:
            x += BOX_W + H_GAP
    # anything not grouped -> its own trailing column
    for t in tables:
        if t.name not in boxes:
            h = HEADER_H + ROW_H * len(t.columns)
            boxes[t.name] = Box(t, "catalog", x, MARGIN, BOX_W, h)
            x += BOX_W + H_GAP
    return boxes


def canvas_size(boxes: dict[str, Box]) -> tuple[float, float]:
    w = max((b.x + b.w for b in boxes.values()), default=0) + MARGIN
    h = max((b.y + b.h for b in boxes.values()), default=0) + MARGIN + 24
    return w, h


# ---------------------------------------------------------------------
#  3a) Mermaid
# ---------------------------------------------------------------------
def gen_mermaid(tables: list[Table], rels: list[Rel]) -> str:
    lines = ["erDiagram"]
    for r in rels:
        parent_end = "|o" if r.optional else "||"
        child_end = "o|" if r.one_to_one else "o{"
        label = f'"{r.fk_column} (one live)"' if r.conditional else r.fk_column
        lines.append(
            f"    {r.parent.upper()} {parent_end}--{child_end} {r.child.upper()} : {label}"
        )
    lines.append("")
    for t in tables:
        lines.append(f"    {t.name.upper()} {{")
        for c in t.columns:
            if c.pk and c.fk_table:
                key = "PK,FK"
            elif c.pk:
                key = "PK"
            elif c.fk_table:
                key = "FK"
            elif c.unique:
                key = "UK"
            else:
                key = ""
            notes: list[str] = []
            if c.fk_table:
                notes.append(f"-> {c.fk_table}")
            if c.not_null and not c.pk:
                notes.append("NOT NULL")
            if c.unique and not c.pk and not c.fk_table:
                notes.append("UNIQUE")
            comment = f' "{", ".join(notes)}"' if notes else ""
            key_part = f" {key}" if key else ""
            lines.append(f"        {c.type} {c.name}{key_part}{comment}")
        lines.append("    }")
    return "\n".join(lines)


def gen_erd_md(tables: list[Table], rels: list[Rel]) -> str:
    o2o = sum(1 for r in rels if r.one_to_one)
    return f"""<!-- generated by build_erd.py from ../03-database/schema.sql -- DO NOT EDIT BY HAND -->
# ERD — ระบบจองห้องพัก (Room Booking System)

แผนภาพนี้ **generate อัตโนมัติ** จาก [`../03-database/schema.sql`](../03-database/schema.sql)
ด้วย [`build_erd.py`](build_erd.py) — ทุกตาราง / คอลัมน์ / คีย์ / ความสัมพันธ์
ตรงกับ DDL จริงเสมอ (รันสคริปต์ใหม่เมื่อ schema เปลี่ยน)

- **{len(tables)} ตาราง**, **{len(rels)} ความสัมพันธ์ (FK)** — {o2o} เส้นเป็น 1:0..1 (FK มี UNIQUE), ที่เหลือ 1:N
- notation: crow's foot — `||--o{{` = one‑to‑many, `||--o|` = one‑to‑(zero‑or‑one);
  ปลายฝั่งแม่เป็น `|o` เมื่อ FK เป็น NULL ได้ (ลูกไม่จำเป็นต้องมีแม่ เช่น งานซ่อมพื้นที่ส่วนกลาง)
- `(one live)` = UNIQUE เฉพาะแถวที่ยังใช้งาน (partial index) เช่น ใบแจ้งหนี้ที่ไม่ void มีได้ใบเดียวต่อการจอง
- คอลัมน์กำกับ `PK` / `FK` / `UK`; หมายเหตุในเครื่องหมายคำพูดบอก target ของ FK และ `NOT NULL`
- draw.io / SVG จัดเป็น **คอลัมน์ตามกลุ่ม** (สี): people · auth · catalog · booking · billing · ops

ฉบับอื่น: [`ERD.drawio`](ERD.drawio) (draw.io) · [`ERD.svg`](ERD.svg) (ภาพเวกเตอร์ ซูมได้) ·
สรุปเชิงข้อความ + normalization 1NF→3NF ใน [`relational-schema.md`](relational-schema.md)

```mermaid
{gen_mermaid(tables, rels)}
```
"""


# ---------------------------------------------------------------------
#  helpers
# ---------------------------------------------------------------------
def _xml_escape(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _key_of(c: Column) -> str:
    if c.pk and c.fk_table:
        return "PK,FK"
    if c.pk:
        return "PK"
    if c.fk_table:
        return "FK"
    if c.unique:
        return "UK"
    return ""


# ---------------------------------------------------------------------
#  3b) draw.io  --  real ER "table" shapes, coloured header, PK column,
#      orthogonal crow's-foot connectors that land on the FK row
# ---------------------------------------------------------------------
def gen_drawio(tables: list[Table], rels: list[Rel]) -> str:
    boxes = layout(tables)
    page_w, page_h = canvas_size(boxes)

    cells: list[str] = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>']
    name_cell: dict[tuple[str, str], str] = {}  # (table, column) -> id of its name cell

    for b in boxes.values():
        fill, stroke = PALETTE[b.group]
        tid = f"t_{b.table.name}"
        cells.append(
            f'<mxCell id="{tid}" value="{b.table.name}" '
            f'style="shape=table;startSize={HEADER_H};container=1;collapsible=0;'
            f'childLayout=tableLayout;fontStyle=1;fontSize=13;align=center;'
            f'fillColor={fill};strokeColor={stroke};rounded=0;'
            f'html=1;fontColor=#1a1a1a;" vertex="1" parent="1">'
            f'<mxGeometry x="{b.x:.0f}" y="{b.y:.0f}" width="{b.w}" height="{b.h}" '
            f'as="geometry"/></mxCell>'
        )
        ry = HEADER_H
        for i, c in enumerate(b.table.columns):
            rid = f"{tid}_r{i}"
            cells.append(
                f'<mxCell id="{rid}" value="" '
                f'style="shape=tableRow;horizontal=0;startSize=0;swimlaneHead=0;'
                f'swimlaneBody=0;strokeColor={stroke};top=0;left=0;bottom=0;right=0;'
                f'fillColor=#ffffff;collapsible=0;dropTarget=0;'
                f'points=[[0,0.5],[1,0.5]];portConstraint=eastwest;" '
                f'vertex="1" parent="{tid}">'
                f'<mxGeometry y="{ry}" width="{b.w}" height="{ROW_H}" as="geometry"/></mxCell>'
            )
            ry += ROW_H

            key = _key_of(c)
            cells.append(
                f'<mxCell id="{rid}_k" value="{key}" '
                f'style="shape=partialRectangle;overflow=hidden;connectable=0;'
                f'fillColor=none;top=0;left=0;bottom=0;right=1;pointerEvents=1;'
                f'fontStyle=1;fontSize=9;align=center;strokeColor={stroke};'
                f'fontColor=#555555;" vertex="1" parent="{rid}">'
                f'<mxGeometry width="{KEY_W}" height="{ROW_H}" as="geometry"/></mxCell>'
            )

            nn = "" if (c.not_null or c.pk) else "  ○"
            label = f"{c.name} : {c.type}{nn}"
            fs = "fontStyle=4;" if c.pk else ("fontStyle=2;" if c.fk_table else "")
            cells.append(
                f'<mxCell id="{rid}_n" value="{_xml_escape(label)}" '
                f'style="shape=partialRectangle;overflow=hidden;connectable=0;'
                f'fillColor=none;top=0;left=0;bottom=0;right=0;pointerEvents=1;'
                f'align=left;spacingLeft=6;fontSize=11;{fs}strokeColor={stroke};" '
                f'vertex="1" parent="{rid}">'
                f'<mxGeometry x="{KEY_W}" width="{b.w - KEY_W}" height="{ROW_H}" '
                f'as="geometry"/></mxCell>'
            )
            name_cell[(b.table.name, c.name)] = f"{rid}_n"

    for k, r in enumerate(rels):
        pk = boxes[r.parent].pk_name()
        src = name_cell.get((r.parent, pk)) if pk else f"t_{r.parent}"
        tgt = name_cell.get((r.child, r.fk_column), f"t_{r.child}")
        end = "ERzeroToOne" if r.one_to_one else "ERzeroToMany"
        # no exit/entry constraint -> draw.io's ER router picks the sides and
        # routes orthogonally around the boxes when the file is opened
        style = (
            "edgeStyle=entityRelationEdgeStyle;html=1;rounded=0;"
            "endFill=0;startFill=0;startArrow=ERone;endArrow=" + end + ";"
            "strokeColor=#6b6b6b;fontSize=10;fontColor=#6b6b6b;"
        )
        cells.append(
            f'<mxCell id="e_{k}" value="{_xml_escape(r.fk_column)}" style="{style}" '
            f'edge="1" parent="1" source="{src}" target="{tgt}">'
            f'<mxGeometry relative="1" as="geometry"/></mxCell>'
        )

    body = "\n        ".join(cells)
    return f"""<mxfile host="build_erd.py" type="device">
  <diagram id="erd-roombooking" name="ERD">
    <mxGraphModel dx="1600" dy="1000" grid="1" gridSize="10" guides="1" tooltips="1"
                  connect="1" arrows="1" fold="1" page="1" pageScale="1"
                  pageWidth="{page_w:.0f}" pageHeight="{page_h:.0f}" math="0" shadow="0">
      <root>
        {body}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
"""


# ---------------------------------------------------------------------
#  3c) SVG  --  same grouped layout, self-contained, no tooling
# ---------------------------------------------------------------------
def gen_svg(tables: list[Table], rels: list[Rel]) -> str:
    boxes = layout(tables)
    width, height = canvas_size(boxes)

    out: list[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.0f} {height:.0f}" '
        f'font-family="Inter, Helvetica, Arial, sans-serif" font-size="11">',
        '<defs>'
        '<marker id="one" markerWidth="16" markerHeight="14" refX="14" refY="7" orient="auto">'
        '<path d="M7,1 L7,13 M11,1 L11,13" stroke="#6f6146" stroke-width="1.3" fill="none"/></marker>'
        '<marker id="many" markerWidth="18" markerHeight="16" refX="15" refY="8" orient="auto">'
        '<path d="M3,8 L15,2 M3,8 L15,8 M3,8 L15,14" stroke="#6f6146" stroke-width="1.2" fill="none"/>'
        '</marker>'
        '<marker id="zone" markerWidth="22" markerHeight="16" refX="19" refY="8" orient="auto">'
        '<circle cx="6" cy="8" r="3.2" stroke="#6f6146" stroke-width="1.2" fill="#fff"/>'
        '<path d="M13,1 L13,15" stroke="#6f6146" stroke-width="1.3" fill="none"/></marker>'
        '</defs>',
        f'<rect x="0" y="0" width="{width:.0f}" height="{height:.0f}" fill="#ffffff"/>',
    ]

    # group column labels (kept near the very top so the band below them is
    # free for wire routing)
    seen: set[str] = set()
    for b in boxes.values():
        if b.group in seen:
            continue
        seen.add(b.group)
        _, stroke = PALETTE[b.group]
        out.append(
            f'<text x="{b.x:.0f}" y="28" fill="{stroke}" font-size="11" '
            f'font-weight="700" letter-spacing="1.5">{b.group.upper()}</text>'
        )

    # ---- table boxes ----
    for b in boxes.values():
        fill, stroke = PALETTE[b.group]
        x, y, w, h = b.x, b.y, b.w, b.h
        out.append(
            f'<rect x="{x:.0f}" y="{y:.0f}" width="{w}" height="{h}" rx="4" '
            f'fill="#ffffff" stroke="{stroke}" stroke-width="1.2"/>'
        )
        out.append(
            f'<path d="M{x:.0f} {y + 4:.0f} q0 -4 4 -4 h{w - 8} q4 0 4 4 v{HEADER_H - 4} '
            f'h-{w:.0f} z" fill="{fill}" stroke="{stroke}" stroke-width="1.2"/>'
        )
        out.append(
            f'<text x="{x + w / 2:.0f}" y="{y + HEADER_H / 2 + 4:.0f}" text-anchor="middle" '
            f'font-weight="700" font-size="12" fill="#1a1a1a">{_xml_escape(b.table.name)}</text>'
        )
        out.append(
            f'<line x1="{x + KEY_W:.0f}" y1="{y + HEADER_H:.0f}" x2="{x + KEY_W:.0f}" '
            f'y2="{y + h:.0f}" stroke="{stroke}" stroke-width="0.8" opacity="0.5"/>'
        )
        cy = y + HEADER_H
        for c in b.table.columns:
            out.append(
                f'<line x1="{x:.0f}" y1="{cy:.0f}" x2="{x + w:.0f}" y2="{cy:.0f}" '
                f'stroke="{stroke}" stroke-width="0.6" opacity="0.35"/>'
            )
            ty = cy + ROW_H / 2 + 3.5
            key = _key_of(c)
            if key:
                out.append(
                    f'<text x="{x + KEY_W / 2:.0f}" y="{ty:.0f}" text-anchor="middle" '
                    f'font-size="8" font-weight="700" fill="#666">{key}</text>'
                )
            deco = ' text-decoration="underline"' if c.pk else ""
            fst = "italic" if (c.fk_table and not c.pk) else "normal"
            fw = "700" if c.pk else "400"
            nn = "" if (c.not_null or c.pk) else "  ○"
            out.append(
                f'<text x="{x + KEY_W + 7:.0f}" y="{ty:.0f}" font-style="{fst}" '
                f'font-weight="{fw}"{deco} fill="#222">{_xml_escape(c.name)}</text>'
                f'<text x="{x + w - 7:.0f}" y="{ty:.0f}" text-anchor="end" fill="#999" '
                f'font-size="9.5">{_xml_escape(c.type + nn)}</text>'
            )
            cy += ROW_H

    # ---- relationships: orthogonal "wiring" (bus routing) --------------
    # Every segment lives in a clear channel:
    #   * vertical runs  -> the gap column between two entity columns
    #   * long horizontal runs -> a trunk band ABOVE or BELOW all the boxes
    # so a wire NEVER crosses, overlaps or hides behind an entity. Wires may
    # only cross each other.
    col_l: dict[int, float] = {}
    col_r: dict[int, float] = {}
    for b in boxes.values():
        gi = GROUP_ORDER.index(b.group)
        col_l[gi] = b.x
        col_r[gi] = b.x + b.w

    def cidx(name: str) -> int:
        return GROUP_ORDER.index(GROUPS[name])

    def gap_track(gi: int, k: int) -> float:
        """a distinct vertical x inside the gap right of column gi."""
        lo, hi = col_r[gi], col_l[gi + 1]
        step = 9.0
        ntr = max(1, int((hi - lo - 20) / step))
        return lo + 12 + (k % ntr) * step

    cbot = max(b.y + b.h for b in boxes.values())
    # every long horizontal run shares one trunk band above all the boxes,
    # each wire on its own track (no giant loops under the diagram)
    long_rels = [i for i, rr in enumerate(rels)
                 if abs(cidx(rr.parent) - cidx(rr.child)) > 1]
    trunk_of = {k: 40.0 + n * 7.0 for n, k in enumerate(long_rels)}

    for k, r in enumerate(rels):
        pb, cb = boxes[r.parent], boxes[r.child]
        sy = pb.row_y(pb.pk_name() or "")
        ty = cb.row_y(r.fk_column)
        pi, ci = cidx(r.parent), cidx(r.child)

        if abs(pi - ci) <= 1:
            if pi == ci:  # same column -> bus in the gap on one side
                use_r = (pi + 1) in col_l
                gx = gap_track(pi if use_r else pi - 1, k)
                sx = pb.x + pb.w if use_r else pb.x
                tx = cb.x + cb.w if use_r else cb.x
            else:
                right = ci > pi
                gx = gap_track(min(pi, ci), k)
                sx = pb.x + pb.w if right else pb.x
                tx = cb.x if right else cb.x + cb.w
            pts = [(sx, sy), (gx, sy), (gx, ty), (tx, ty)]
        else:
            tr = trunk_of[k]
            if ci > pi:
                sx, tx = pb.x + pb.w, cb.x
                g1, g2 = gap_track(pi, k), gap_track(ci - 1, k)
            else:
                sx, tx = pb.x, cb.x + cb.w
                g1, g2 = gap_track(pi - 1, k), gap_track(ci, k)
            pts = [(sx, sy), (g1, sy), (g1, tr), (g2, tr), (g2, ty), (tx, ty)]

        d = "M " + " L ".join(f"{x:.0f} {y:.0f}" for x, y in pts)
        end_marker = "zone" if r.one_to_one else "many"
        out.append(
            f'<path d="{d}" fill="none" stroke="#7c6f52" stroke-width="1" '
            f'stroke-linejoin="round" opacity="0.78" '
            f'marker-start="url(#one)" marker-end="url(#{end_marker})"/>'
        )

    out.append(
        f'<text x="{MARGIN}" y="{height - 12:.0f}" fill="#aaa" font-size="9">'
        f'generated from 03-database/schema.sql by build_erd.py — '
        f'{len(tables)} tables · {len(rels)} relationships · '
        f'○ = nullable · underline = PK · italic = FK</text>'
    )
    out.append("</svg>")
    return "\n".join(out)


# ---------------------------------------------------------------------
#  main
# ---------------------------------------------------------------------
def main() -> int:
    if not SCHEMA.exists():
        print(f"schema not found: {SCHEMA}", file=sys.stderr)
        return 1
    sql = SCHEMA.read_text(encoding="utf-8")
    tables = parse_schema(sql)
    rels = relationships(tables)

    (HERE / "ERD.md").write_text(gen_erd_md(tables, rels), encoding="utf-8")
    (HERE / "ERD.drawio").write_text(gen_drawio(tables, rels), encoding="utf-8")
    (HERE / "ERD.svg").write_text(gen_svg(tables, rels), encoding="utf-8")

    print(f"parsed  {len(tables)} tables, {len(rels)} relationships")
    for t in tables:
        fks = sum(1 for c in t.columns if c.fk_table)
        grp = GROUPS.get(t.name, "?")
        print(f"  {t.name:<20} {len(t.columns):>2} cols  {fks} fk   [{grp}]")
    print("wrote   ERD.md  ERD.drawio  ERD.svg")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
