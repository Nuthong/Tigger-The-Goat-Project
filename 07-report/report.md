# Final Report — ระบบจองห้องพัก (Room Booking System)

**วิชา:** 310-2209 Database Systems — Mini-DB Group Project (30%)
**กลุ่ม:** 6810301002 · 6810301003 · 6810301004 · 6810301012 · 6810301037 · 6810301039
**Repository:** https://github.com/Nuthong/Tigger-The-Goat
**สถานะเอกสาร:** Draft 2 (ปรับปรุงจากฉบับ Draft 1 วันที่ 9 ก.ย. — ดู §0)

---

## 0. Draft 1 → Draft 2: สรุปการเปลี่ยนแปลง

Draft 1 (ส่งวันที่ 9 ก.ย.) ครอบคลุมสคีมา ER/normalization/physical design ครบ พร้อม backend
+ frontend ต้นแบบที่ใช้งานได้จริงแต่ยังเป็นเวอร์ชันเล็ก (13 ตาราง, การจอง–เช็คอิน–ชำระเงินพื้นฐาน,
หน้าแอดมิน 4 หน้า) Draft 2 คือผลจากการพัฒนาต่อเนื่องอีกหลายรอบ โดย **ไม่แตะ
`03-database/`/`02-design/` เลยตามกติกาที่ล็อกไว้** — งานทั้งหมดอยู่ใน `04-backend/`
และ `05-frontend/` เท่านั้น

| หัวข้อ | Draft 1 | Draft 2 |
|---|---|---|
| ตารางในฐานข้อมูล | 13 ตาราง (5 กลุ่ม) | **19 ตาราง (6 กลุ่ม)** — เพิ่มกลุ่ม Ops & Revenue |
| Views / Functions / Triggers | ไม่ระบุชัดเจน | **7 views · 3 functions · 3 triggers** (locked, verified) |
| API endpoints | 24 endpoint | **~65 endpoint** ใน 10 route module |
| หน้าเว็บฝั่งลูกค้า | 7 หน้า | **11 หน้า** |
| หน้าพอร์ทัลพนักงาน | 4 หน้า (Overview/Bookings/Rooms/Guests) | **17 หน้า** (+Housekeeping, Maintenance, Rate plans + Rate calendar, Invoices, Reports, Reviews, Audit, Users, Tape chart, New booking, Guest detail) |
| Actors / roles | 3 (customer, receptionist, manager) | **6** (+ housekeeping, accounting, admin) — บังคับด้วย DB CHECK |
| ภาษา UI | อังกฤษอย่างเดียว | **EN + ไทย ทั้งเว็บ** (~700 คีย์, สลับไม่ต้องรีโหลด) |
| ข้อมูลตัวอย่าง (seed) | ~12 ลูกค้า / 14 การจอง / 16 ห้อง | **1,000 ลูกค้า / ~2,484 การจอง / 155 ห้อง** (สร้างด้วย `generate_series` เพื่อทดสอบสเกลจริง) |
| Backend tests | 62 เขียนไว้ (ไม่เคยรันจริงในรายงานเดิม) | **160 ผ่านทุกตัว** (`pytest`) |
| Frontend tests | 0 | **55 ผ่านทุกตัว** (`vitest`) |
| Deployment | แผนขึ้นคลาวด์ (Neon/Render/Vercel) — ยังไม่ deploy | **Docker Compose รันจริง** ที่ local (`db`/`api`/`web`); แผนคลาวด์ยังคงอยู่ใน `06-deploy/DEPLOY.md` |

**ฟีเจอร์ใหม่ที่เพิ่มใน Draft 2** (ไม่มีใน Draft 1 เลย):

- **Rate plans + Rate calendar** — ราคาตามฤดู/วันหยุด/โปรโมชัน เลือกใช้ผ่าน `fn_quote_room`/`fn_quote_stay`
- **Housekeeping board** — งานทำความสะอาด สร้างอัตโนมัติเมื่อเช็คเอาท์ (trigger ใหม่), auto-assign ตามภาระงาน
- **Maintenance tickets** — แจ้งซ่อม → priority → resolve, ผูกกับห้อง
- **Invoicing** — ใบกำกับภาษีคำนวณสด พิมพ์ได้ พร้อมลายน้ำโลโก้โรงแรม + folio สำหรับแขก
- **Reports** — revenue by room type, occupancy, forecast, daily revenue, rate calendar
- **Audit trail** — บันทึกทุกการเปลี่ยนสถานะการจองอัตโนมัติด้วย trigger (`aiu_booking_audit`) ไม่พึ่งแอป
- **Reservation tape (Tape chart)** — มุมมองปฏิทินห้องแบบ timeline
- **User & role administration** — จัดการบัญชีพนักงาน/สิทธิ์ 6 role
- **Advanced multi-field filters** — ทุกตารางในพอร์ทัลแอดมิน (สถานะ, ช่วงวัน, ช่วงราคา,
  ช่วงจำนวนแขก, สถานะการชำระเงิน ฯลฯ) ผ่าน query parameter ฝั่ง API ที่มี pagination ถูกต้อง
- **i18n ภาษาไทยทั้งเว็บ** — ทั้งฝั่งลูกค้าและพอร์ทัลแอดมิน สลับได้แบบ real-time

**บั๊กที่พบและแก้ระหว่างพัฒนา Draft 2**:

1. **Pagination truncation bug class** — ตัวเลขสรุป/ตารางใหญ่ 8 จุด (Overview donut, reservation
   tape, admin bookings, guest stays, invoice ledger, reviews board, audit trail, users list)
   เคยคำนวณจากข้อมูลที่ดึงมาไม่ครบ (จำกัดหน้าแรก) แก้เป็น server-side pagination พร้อมยอดรวมจริง
2. **ที่อยู่โรงแรมไม่ตรงกัน** — footer/ใบเสร็จ vs หน้ารายละเอียดการจอง/ปฏิทิน ใช้ค่าคนละที่มา
   รวมเป็นแหล่งเดียว `lib/hotel.ts`
3. **ชื่อเดือนภาษาไทยผิด** — `fmtDate`/`fmtStay` แสดงชื่อเดือนอังกฤษเมื่อสลับเป็นโหมดไทย แก้ให้
   อ้างอิง locale ไทยถูกต้อง มีเทสต์คุม 8 เคส
4. **ลายน้ำใบกำกับภาษีไม่ขึ้น** — สาเหตุคู่: โลโก้เป็นภาพพื้นดำทึบ (invert สีแก้), และ
   `.printdoc` ไม่มี stacking context ทำให้ `z-index` ของลายน้ำหลุดไปอยู่หลังทั้งหน้า

---

## 1. บทนำ (Introduction)

ที่พักขนาดกลางจำนวนมากยังจดการจองด้วยสมุดหรือสเปรดชีต ทำให้เกิดปัญหา
**จองห้องซ้ำ (double-booking)**, ค้นห้องว่างช้า, สรุปรายได้ยาก และตรวจสอบย้อนหลังไม่ได้
โครงงานนี้ออกแบบและพัฒนา **ฐานข้อมูลเชิงสัมพันธ์บน PostgreSQL** สำหรับระบบจองห้องพัก
พร้อมพิสูจน์ว่าฐานข้อมูลใช้งานได้จริงด้วย REST API และเว็บไคลเอนต์ที่ครบทั้งฝั่งลูกค้าและ
พอร์ทัลพนักงาน (ดู §0 สำหรับขอบเขตที่ขยายเพิ่มใน Draft 2)

**ขอบเขต:** ประเภทห้อง/ห้องพัก, ค้นห้องว่างตามช่วงวัน, สร้าง/แก้/ยกเลิกการจอง (หลายห้อง/การจอง),
เช็คอิน-เช็คเอาท์, เลื่อนวันเข้าพัก, no-show, ชำระเงินหลายงวด, บริการเสริม, รีวิว,
บันทึกประวัติสถานะห้อง, **ราคาตามช่วง (rate plan), งานแม่บ้าน, ใบแจ้งซ่อม, ใบกำกับภาษี,
audit trail, รายงานรายได้/อัตราเข้าพัก/พยากรณ์**
**นอกขอบเขต:** payment gateway จริง, หลายสาขา

**ผู้ใช้งาน (Actors, 6 roles):** ลูกค้า (customer) · พนักงานเคาน์เตอร์ (receptionist) ·
แม่บ้าน (housekeeping) · บัญชี (accounting) · ผู้จัดการ (manager) · แอดมินระบบ (admin)

---

## 2. Conceptual Design — ER Model

ดูแผนภาพเต็มที่ `02-design/ERD.drawio` (draw.io), ฉบับ Lucidchart และ
`02-design/Full-Diagram_Final/FULL-ERD-Diagram.svg` (แผนภาพเต็มทั้ง 19 ตาราง)
สรุปเอนทิตี **19 ตาราง** แบ่งเป็น **6 กลุ่ม** (13 ตารางแรกมาตั้งแต่ Draft 1, กลุ่มสุดท้ายเพิ่มใน Draft 2):

| กลุ่ม | ตาราง |
|---|---|
| Catalog | `room_type`, `room`, `service` |
| People | `customer`, `staff` |
| Auth (application layer) | `app_user`, `auth_event` |
| Booking (transaction) | `booking`, `booking_room`, `booking_service` |
| Payment / Review / Log | `payment`, `review`, `room_status_log` |
| **Ops & Revenue** (Draft 2) | `rate_plan`, `invoice`, `invoice_line`, `housekeeping_task`, `maintenance_ticket`, `audit_log` |

**ความสัมพันธ์หลัก**

- `room_type` 1—N `room` · `customer` 1—N `booking` · `staff` 1—N `booking`
- `booking` M—N `room` แก้ด้วยตารางเชื่อม **`booking_room`** (มี attribute `price_per_night`)
- `booking` M—N `service` แก้ด้วย **`booking_service`** (`quantity`, `unit_price`)
- `booking` 1—N `payment` · `booking` 1—0..1 `review` · `booking` 1—0..1 `invoice`
- `room` 1—N `room_status_log` · `room` 1—N `housekeeping_task` / `maintenance_ticket`
- `room_type` 1—N `rate_plan` · `invoice` 1—N `invoice_line`
- `customer`/`staff` 1—0..1 `app_user` · `app_user` 1—N `auth_event`
- `booking` 1—N `audit_log` entries (เขียนโดย trigger, ไม่ใช่แอป)

---

## 3. Logical Design & Normalization

Relational schema เต็มอยู่ใน `02-design/relational-schema.md` (ขีดเส้นใต้ = PK, ตัวเอียง = FK)

**1NF** — ไม่มีค่าเชิงกลุ่ม/ซ้ำ: "หลายห้องในหนึ่งการจอง", "บริการเสริม" และ "บรรทัดในใบกำกับภาษี"
ถูกแยกออกเป็นแถวใน `booking_room` / `booking_service` / `invoice_line` ไม่ใช่คอลัมน์ list หรือ CSV

**2NF** — ทุกตารางใช้ **surrogate key คอลัมน์เดียว** (`SERIAL`) เป็น PK รวมทั้งตารางเชื่อมทุกตัว
(มี `UNIQUE(booking_id, room_id)` กันคู่ซ้ำ) → ไม่มี partial dependency

**3NF** — ไม่มี transitive dependency:
- ราคาปกติของประเภทห้องอยู่ที่ `room_type.base_price_per_night` เท่านั้น; ราคาตามช่วง/โปรโมชัน
  อยู่ที่ `rate_plan` แยกตาราง ไม่ปนกับ `room_type`
- **ตั้งใจเก็บซ้ำ** เฉพาะ price snapshot (`booking_room.price_per_night`, `booking_service.unit_price`,
  `invoice_line.unit_price`) เพราะเป็นข้อเท็จจริง "ราคา ณ เวลาที่จอง/ออกใบกำกับภาษี" คนละเวลากับ
  ราคาปัจจุบัน — ป้องกันยอดเงินเปลี่ยนตามราคา (BR-6)
- **ไม่เก็บ** ยอดรวม (`total_amount`, `nights`) → คำนวณสดผ่าน VIEW `v_booking_bill` / `v_invoice_summary`
  (กัน update anomaly)
- ชั้น auth แยก `app_user` ออกจาก `customer`/`staff` — ตารางบุคคลไม่ปนเรื่องรหัสผ่าน/สิทธิ์
- `audit_log` แยกเป็นตารางอิสระ ไม่ผูกกับ entity ใดตายตัว (`entity_type` + `entity_id` เป็น
  polymorphic reference ระดับแอป) — เขียนโดย trigger เพื่อไม่ให้ขึ้นกับว่าฝั่งแอปจะเรียกหรือไม่

---

## 4. Physical Implementation (PostgreSQL)

ไฟล์: `03-database/schema.sql` (DDL) · `roles.sql` (DB roles) · `seed.sql` (ข้อมูลตัวอย่าง) · `queries.sql` (15 query)
— ทั้งหมด **ล็อกตั้งแต่ Draft 1** ไม่มีการแก้ไขเพิ่มเติมใน Draft 2

**Constraints ที่บังคับใช้**

| ชนิด | ตัวอย่าง |
|---|---|
| PK | ทุกตาราง (19) |
| FK | 20+ ความสัมพันธ์ · `ON DELETE RESTRICT` กับ master, `CASCADE` กับรายการย่อยของ `booking`/`invoice` |
| UNIQUE | `customer.email`, `staff.email`, `room.room_number`, `(booking_id, room_id)`, `review.booking_id`, `invoice.invoice_no`, `app_user.username/email` |
| CHECK | `check_out_date > check_in_date`, `amount ≥ 0`, `rating BETWEEN 1 AND 5`, ชุดค่า `status`/`role` (6 ค่า)/`method`/`priority`, `app_user` role ↔ identity |
| NOT NULL | ฟิลด์สำคัญทั้งหมด + `password_hash` |

**Objects ระดับสูง**

- **7 Views** — `v_booking_bill` (ยอดค้างชำระ), `v_current_guests`, `v_room_type_revenue`,
  `v_housekeeping_board`, `v_maintenance_open`, `v_daily_revenue`, `v_invoice_summary`
- **3 Functions** — `fn_available_rooms(check_in, check_out)` (ห้องว่าง), `fn_quote_room` /
  `fn_quote_stay` (ราคาต่อคืน/ทั้งทริป เลือก rate plan ที่ priority สูงสุดที่ใช้ได้)
- **3 Triggers**:
  - `bi_booking_room_no_overlap` — `BEFORE INSERT/UPDATE` บน `booking_room` → `RAISE EXCEPTION`
    ถ้าห้องถูกจองซ้อนช่วงวันในการจองที่ยัง active (BR-5) เป็น backstop สุดท้ายแม้แอปมีบั๊ก
  - `au_booking_checkout_housekeeping` — `AFTER UPDATE OF status` บน `booking`: เช็คเอาท์แล้ว
    สร้างงานทำความสะอาดในกระดาน housekeeping ให้อัตโนมัติ
  - `aiu_booking_audit` — `AFTER INSERT/UPDATE OF status` บน `booking`: บันทึกทุกการเปลี่ยน
    สถานะลง `audit_log` ที่ชั้นฐานข้อมูล ไม่พึ่งแอปชั้นบนเขียน

**Business Queries (15 ข้อ ใน `queries.sql`)** — ครอบเทคนิคที่เรียนใน CH04:
INNER/LEFT JOIN หลายตาราง, `GROUP BY … HAVING`, subquery + `NOT EXISTS`, **window function**
(`RANK() OVER`, `SUM() OVER ()`), `CASE`, anti-join (`LEFT JOIN … IS NULL`),
occupancy rate ด้วย `generate_series` + `CROSS JOIN LATERAL`, และ 2 query ด้าน security (audit login ล้มเหลว, สถานะบัญชี)

**ข้อมูลตัวอย่าง (running DB):** 5 room types · **155 ห้อง** · **1,000 ลูกค้า** · 9 พนักงาน ·
6 บริการ · 10 บัญชี app_user (bcrypt ผ่าน `pgcrypto`) · **~2,484 การจอง** ครบทุกสถานะ ·
~2,480 payment · ~1,651 review · 11 rate plan · 4 invoice · 8 housekeeping task ·
6 maintenance ticket · ~2,488 audit-log entry — ปริมาณข้อมูลระดับนี้ (สร้างบางส่วนด้วย
`generate_series`) มีไว้ทดสอบ pagination/ประสิทธิภาพภายใต้สเกลที่ใกล้เคียงของจริง
ไม่ใช่แค่ชุดตัวอย่างเล็ก ๆ อย่าง Draft 1 (~12 ลูกค้า / 14 การจอง)

---

## 5. Security Design

รายละเอียดเต็ม: `SECURITY.md` — สรุปหลัก:

**Database**
- รหัสผ่านเก็บเป็น **bcrypt hash เท่านั้น** (`pgcrypto` ใน seed, `bcrypt` ในแอป) — DB ไม่มี plaintext
- **Least-privilege roles** (`03-database/roles.sql`): แอปต่อด้วย `app_rw` (DML ได้ แต่ `DROP`/`ALTER TABLE` ไม่ได้ — ทดสอบแล้วได้ `ERROR: must be owner`); งานรายงานใช้ `app_readonly`
- **Audit**: `auth_event` (login สำเร็จ/ล้มเหลว/ล็อก/logout/เปลี่ยนรหัส) + `room_status_log` +
  **`audit_log`** (Draft 2 — เขียนโดย trigger `aiu_booking_audit` ทุกครั้งที่ booking เปลี่ยนสถานะ)
- Referential + domain integrity ครบ (ข้อ 4) — role CHECK บังคับ 6 ค่าเป๊ะที่ชั้น DB

**API (FastAPI)**
- JWT access token อายุ 15 นาที (ส่งใน body, ฝั่ง SPA เก็บในหน่วยความจำ) + refresh token หมุน เป็น
  cookie `HttpOnly; Secure; SameSite=Strict` scope `/api/v1/auth`; `app_user.token_version` = ปุ่มเพิกถอน token ทั้งหมด
- RBAC dependency `require_role(...)` ครอบทั้ง 6 role · กัน **IDOR**: endpoint ที่รับ `booking_id`
  เช็คความเป็นเจ้าของ (customer เห็นเฉพาะของตัวเอง, ตอบ 404 ไม่ใช่ 403)
- **Brute-force lockout**: ผิด 5 ครั้ง → ล็อก 15 นาที; ทุก attempt เขียน `auth_event` และ commit แม้ตอบ 401; dummy hash กัน user-enumeration + timing
- rate-limit ต่อ IP บน `/auth/*` · CORS allowlist (ไม่ใช่ `*`) · security headers + CSP · error 500 ไม่รั่ว stack trace · ไม่มี secret ใน log/บันเดิล
- Pydantic `extra="forbid"` กัน mass-assignment (client ตั้ง `role` เองไม่ได้)
- ไม่มีการสร้าง SQL ด้วย f-string ที่ใดเลย — ทุก raw query ใช้ `text()` แบบ static หรือ parameterised query (บังคับด้วย `ruff` rule S608 ในทุก gate)

**Frontend (React)**
- access token ในหน่วยความจำ, refresh เป็น httpOnly cookie → XSS ยกไปไม่ได้
- ไม่มี `dangerouslySetInnerHTML` · ไม่มี secret ในบันเดิล (มีแค่ `VITE_API_BASE`)

---

## 6. Application Architecture

### 6.1 Backend — `04-backend/` (FastAPI + SQLAlchemy 2 async + psycopg 3)

Layered: `app/core` (config, security, rate-limit, middleware, logging) · `app/db` (async engine + session) ·
`app/models` (mirror `schema.sql`, DB-first, ไม่ใช้ migration) · `app/schemas` (Pydantic — แยก `*In`/`*Out`) ·
`app/services` (auth, booking, ops) · `app/api/v1` (**10 route modules**: auth, rooms, bookings,
customers, rate_plans, invoices, housekeeping, maintenance, reports, admin) · `app/exceptions` (clean-JSON handlers)

**~65 operations** — เช่น `POST /auth/login`, `GET /rooms/availability`, `POST /bookings`,
`POST /bookings/{id}/check-in|check-out|no-show|dates`, `GET /rate-plans/quote`,
`GET /housekeeping/tasks`, `POST /maintenance/tickets`, `GET /invoices`,
`GET /reports/revenue-by-room-type|occupancy|forecast|rate-calendar`, `GET /admin/audit|reviews|users`

ทุก endpoint ที่คืนลิสต์ยาวเป็น **server-side pagination พร้อม total จริง** (ไม่ใช่ `limit` ที่ตัดข้อมูลเงียบ ๆ
เหมือนที่เคยเป็นบั๊กใน §0) และตารางแอดมินส่วนใหญ่รองรับ **advanced filters** หลายฟิลด์พร้อมกันผ่าน
query parameter (ช่วงวัน, ช่วงราคา, ช่วงจำนวนแขก, สถานะการชำระเงิน, หมวดหมู่/priority ของงานซ่อม ฯลฯ)

**การจอง:** ลูกค้าจองออนไลน์ให้ตัวเองได้ (booking ถูกผูกกับ staff "Online Reservations" เพื่อให้
`booking.staff_id` NOT NULL) · พนักงานเคาน์เตอร์จองแทนลูกค้าได้โดยระบุ `customer_id` ·
`/rooms/availability` + `/room-types` เป็น public (ค้นห้องก่อนสมัคร)

### 6.2 Frontend — `05-frontend/` (React 18 + Vite + TypeScript strict)

สองส่วนในระบบดีไซน์เดียว (`design/ui-ux.md`), ทั้งคู่รองรับ **EN/ไทย แบบสมบูรณ์**:

- **หน้าลูกค้า** (11 หน้า: Landing, Login, Register, Search, RoomType, Rooms, ConfirmReservation,
  Payment, Bookings, BookingDetail, NotFound) — สไตล์ **Mandarin Oriental**: serif display,
  off-white อุ่น, gold accent เดียว, ภาพถ่ายเต็มจอ · **ค้นห้องแสดงเป็นประเภทห้อง** ไม่ใช่รายเลขห้อง
- **พอร์ทัลพนักงาน** (`/admin/*`, **17 หน้า**) — แยกขาดจากหน้าลูกค้า: Overview, BookingsAdmin,
  NewBooking, RoomsAdmin, TapeChart, GuestsAdmin, GuestDetail, Housekeeping, Maintenance,
  RatePlans, RateCalendar, Invoices, Reports, Reviews, Audit, Users, AdminLayout — sidebar เข้ม,
  KPI, ตารางจัดการพร้อมปุ่ม action ในแถว, grid สถานะห้อง, เอกสารพิมพ์ได้ (ใบกำกับภาษี/folio)

`lib/api.ts` = fetch client + in-memory access token + silent refresh · `lib/i18n.ts` +
`i18n/I18n.tsx` = ระบบแปลภาษา ~700 คีย์ (persist + sync `<html lang>`, ไม่ต้องรีโหลด) ·
`AuthContext` resume จาก refresh cookie · `ProtectedRoute` (auth / staff / manager) ·
ชิ้นส่วนใช้ร่วม: `<Pager>` / `<EmptyState>` / `<TableEmpty>` / `<FilterPanel>` ·
**ทดสอบจริง**: `tsc --noEmit && eslint && vitest && vite build` ผ่าน + รันสแตกเต็มบน
`localhost:8081` (login/search/portal ทำงานกับ API จริงผ่าน nginx proxy)

---

## 7. Testing

`04-backend/tests/` — **pytest-asyncio + httpx**, สร้าง DB ทิ้ง `roombooking_test` จาก `schema.sql`+`seed.sql` ทุกครั้ง

| # | โมดูล | ไฟล์ |
|---|---|---|
| 1 | Auth & accounts | `test_auth.py` |
| 2 | Room catalog | `test_rooms.py` |
| 3 | Availability search | `test_availability.py` |
| 4 | Booking creation & retrieval | `test_bookings.py` |
| 5 | Booking lifecycle (+ reschedule, no-show) | `test_lifecycle.py` |
| 6 | Payments | `test_payments.py` |
| 7 | Reviews | `test_reviews.py` |
| 8 | Reporting (+ forecast, rate calendar) | `test_reports.py` |
| 9 | Room administration | `test_room_admin.py` |
| 10 | Ops API — rate plans, invoices, housekeeping, maintenance, admin | `test_ops_api.py` |
| 11 | Schema-level ops (views/functions/triggers) | `test_schema_ops.py` |
| — | Infra (health, security headers, request id) | `test_health.py`, `test_request_id.py` |

**ผล:** **160 ผ่านทุกตัว** (จาก 62 ที่ Draft 1 เขียนไว้แต่ยังไม่เคยรันในสภาพแวดล้อมนั้น) ·
`ruff` clean · `mypy --strict` clean · `ruff format` clean บนไฟล์ที่แก้ · `pip-audit` clean

Frontend: **55 ผ่านทุกตัว** (`vitest`, จาก 0 ใน Draft 1) — ครอบ pure helper (`pagination`, `csv`,
`ics`, `i18n`, `format`, `validation`) · `tsc --noEmit` / `eslint` (0 error) / `vite build` clean

ครอบ: happy path, กันจองซ้อน (409 + trigger), IDOR scoping, lockout, RBAC 403 ครบ 6 role,
bill correctness (รวม refund-aware balance), state guards, validation 422,
**pagination ให้ total ตรงกับข้อมูลจริงในทุก list endpoint** (บั๊กคลาสที่แก้ใน §0)

---

## 8. Deployment

`06-deploy/` — `docker-compose.yml` (db + api + web) + `load-db.sh` + `DEPLOY.md`

**สถานะจริงตอนนี้ (Draft 2): รันอยู่บน Docker Compose ที่ local**

| ส่วน | Container | Port | หมายเหตุ |
|---|---|---|---|
| PostgreSQL | `db` | 5433 → 5432 | postgres:16-alpine · schema → roles → seed |
| API | `api` | 8000 | FastAPI/uvicorn · `/docs` |
| Web | `web` | 8081 | nginx + React build · proxy `/api` → `api:8000` |

Local demo: `cd 06-deploy && docker compose up --build -d && ./load-db.sh` → `http://localhost:8081`

**แผนคลาวด์** (ยังไม่ได้ deploy จริง แต่เอกสารพร้อมใน `DEPLOY.md`):

| ส่วน | ที่ | หมายเหตุ |
|---|---|---|
| PostgreSQL | Neon | บังคับ SSL, รัน schema→roles→seed |
| API | Render (Docker) | env: `DATABASE_URL` (app_rw), `JWT_SECRET`, `CORS_ORIGINS`, `ENVIRONMENT=production` |
| Web | Vercel หรือ nginx image | `VITE_API_BASE` ชี้ API origin |

---

## 9. สิ่งที่ได้เรียนรู้ / ต่อยอด

- การแยก **conceptual → logical → physical** ทำให้ตัดสินใจเรื่อง snapshot vs 3NF ได้อย่างมีเหตุผล
  ตั้งแต่ 13 ตารางแรก และยังใช้หลักเดียวกันได้เมื่อขยายเป็น 19 ตารางใน Draft 2 (เช่น `invoice_line`
  ใช้ price-snapshot pattern เดียวกับ `booking_room`)
- **constraint + trigger ในฐานข้อมูล** คือแนวป้องกันสุดท้าย — แอปมีบั๊กได้ แต่ double-booking เข้า DB
  ไม่ได้ และตอนนี้แม้แอปลืมเขียน audit log ก็ยังมี trigger เขียนแทนให้
  (`aiu_booking_audit`)
- **least-privilege DB role** ราคาถูกมากแต่ลดความเสียหายได้เยอะ
- โครงสร้างข้อมูลที่ "ล็อก" ไว้ตั้งแต่ต้น (Draft 1) ทำให้ทีมขยายฟีเจอร์จำนวนมากใน Draft 2 ได้อย่าง
  ปลอดภัย — ทุกฟีเจอร์ใหม่ต่อยอดจากตารางเดิมหรือเพิ่มตารางใหม่ที่ normalize ถูกต้องตั้งแต่แรก
  ไม่ต้อง migrate ข้อมูลเก่า
- ต่อยอด: Row-Level Security ให้ลูกค้าเห็นเฉพาะแถวตัวเอง, deploy จริงขึ้นคลาวด์ตามแผนใน `DEPLOY.md`,
  แคช `fn_available_rooms` ด้วย materialized view เมื่อข้อมูลโตกว่านี้, component render test
  (`@testing-library/react`) ให้ frontend

---

## ภาคผนวก — โครงสร้างโปรเจกต์

```
Mini-DB-Project/
├── README.md · SECURITY.md
├── 01-proposal/      proposal.md
├── 02-design/        Draft/ (ERD.drawio · relational-schema.md) · Full-Diagram_Final/
├── 03-database/      schema.sql · roles.sql · seed.sql · queries.sql · README.md   (LOCKED)
├── 04-backend/       FastAPI (app/ · tests/, 198 passing) · Dockerfile · Makefile
├── 05-frontend/      React (src/, 81 tests passing) · design/ui-ux.md · Dockerfile
├── 06-deploy/        docker-compose.yml · load-db.sh · DEPLOY.md · HOWTO.md · history/
└── 07-report/        report.md · slides.html · ไฟล์นำเสนอ
```
