# Project Proposal — ระบบจองห้องพัก (Room Booking System)

**วิชา:** 310-2209 Database Systems — Mini-DB Group Project
**กลุ่ม:** 6810301002, 6810301003, 6810301004, 6810301012, 6810301037, 6810301039

> เอกสารนี้เป็น **business requirement ฉบับปรับให้ตรงกับระบบที่พัฒนาจริง** (as-built)
> ทุกข้อในเอกสารอ้างอิงกลับไปยัง implementation ได้: `03-database/schema.sql`,
> `04-backend/app/`, `05-frontend/src/`  · ระบบขยายเกินขอบเขต "mini" ตอนเสนอเดิม
> โดยเพิ่มโมดูล Rate plan, Invoice/VAT, Housekeeping, Maintenance, System audit
> และ Reservation tape chart

---

## 1. ที่มาและแนวคิด (Topic & Idea)

โรงแรม / ที่พักขนาดกลางย่านใจกลางเมืองยังจดการจองด้วยสมุดหรือ Excel ทำให้เกิดปัญหา
**จองห้องซ้ำ (double booking)**, หาห้องว่างช้า, สรุปรายได้ยาก และตรวจสอบย้อนหลังไม่ได้

โครงงานนี้ออกแบบและพัฒนา **ฐานข้อมูลเชิงสัมพันธ์บน PostgreSQL 16** สำหรับระบบจองห้องพัก
ครอบคลุมตั้งแต่ค้นห้องว่างตามช่วงวัน สร้างการจอง เช็คอิน/เช็คเอาท์ ชำระเงินหลายงวด
ออกใบแจ้งหนี้ (VAT) ราคาตามฤดูกาล/โปรโมชั่น งานแม่บ้าน แจ้งซ่อม ไปจนถึงรายงานรายได้
และอัตราการเข้าพัก — พร้อมพิสูจน์ว่าใช้งานได้จริงด้วย REST API (FastAPI) และเว็บไคลเอนต์ (React)

## 2. ขอบเขตของระบบ (Scope)

**อยู่ในขอบเขต — พัฒนาและ verify แล้ว**

| # | ความสามารถ | หลักฐาน |
|---|---|---|
| S-1 | ประเภทห้อง (room type) + ห้องพักรายห้อง + สถานะห้อง 4 แบบ (available / cleaning / maintenance / closed) | `room_type`, `room`; `RoomsAdmin.tsx` |
| S-2 | ค้นห้องว่างตามช่วงวัน check-in / check-out | `fn_available_rooms()`, `GET /rooms/availability`, `GET /room-types/availability`; `Search.tsx` |
| S-3 | สร้าง / ยกเลิกการจอง — หนึ่งการจองมีได้หลายห้อง + บริการเสริม | `booking` / `booking_room` / `booking_service`; `POST /bookings`, `POST /bookings/{id}/cancel` |
| S-4 | Check-in / Check-out (เปลี่ยนสถานะการจอง) | `POST /bookings/{id}/check-in \| check-out` |
| S-5 | ชำระเงินหลายงวด (เงินสด / บัตร / โอน / พร้อมเพย์) + สถานะการชำระ | `payment`; `POST /bookings/{id}/payments`; `PaymentForm` |
| S-6 | **ใบแจ้งหนี้ / ใบกำกับภาษี** — หนึ่งใบต่อการจอง, VAT, แยกบรรทัด, void ได้ | `invoice` / `invoice_line`; `invoices.py`; `Invoices.tsx` |
| S-7 | **แผนราคาตามช่วงเวลา (rate plan)** — seasonal / weekday / weekend / promotion + priority | `rate_plan`, `fn_quote_room()`, `fn_quote_stay()`; `rate_plans.py`; `RatePlans.tsx` |
| S-8 | บริการเสริม (อาหารเช้า รถรับส่ง ซักรีด ฯลฯ) | `service` / `booking_service` |
| S-9 | รีวิว / ให้คะแนน 1–5 หลังเข้าพัก (หนึ่งการจองรีวิวได้ครั้งเดียว) | `review`; `POST /bookings/{id}/review` |
| S-10 | บันทึกลูกค้า + สมุดลูกค้า (จำนวนทริป, lifetime value) | `customer`; `GET /customers`; `GuestsAdmin.tsx` |
| S-11 | **งานแม่บ้าน (housekeeping board)** — สร้างงานอัตโนมัติเมื่อ check-out, มอบหมาย, เลื่อนสถานะ | `housekeeping_task` + trigger; `housekeeping.py`; `Housekeeping.tsx` |
| S-12 | **แจ้งซ่อมบำรุง (maintenance ticket)** — แจ้ง / รับงาน / resolve / close, ผูกห้องหรือพื้นที่ส่วนกลาง | `maintenance_ticket`; `maintenance.py`; `Maintenance.tsx` |
| S-13 | บันทึกประวัติการเปลี่ยนสถานะห้อง | `room_status_log`; `PATCH /rooms/{id}/status` |
| S-14 | **Reservation tape chart** — ผังห้อง × วัน แสดงการจองเป็นแถบตามสถานะ | `TapeChart.tsx`, `GET /admin/tape` route |
| S-15 | **System audit log** — บันทึกการกระทำทางธุรกิจทุกชนิด (booking.create / status_change ฯลฯ) | `audit_log` + trigger; `GET /admin/audit`; `Audit.tsx` |
| S-16 | Authentication (JWT) + **RBAC 6 role** + rate-limit + account lockout | `app_user`, `auth_event`, `deps.py`; `AuthContext.tsx` |
| S-17 | **จัดการ user / role** (เปลี่ยน role, เปิด-ปิดบัญชี, ปลดล็อก) | `GET/PATCH /admin/users`; `Users.tsx` |
| S-18 | รายงาน: รายได้ตามประเภทห้อง, อัตราการเข้าพักรายเดือน, รายได้รายวัน + Dashboard | `v_room_type_revenue`, `v_daily_revenue`; `reports.py`; `Overview.tsx` |

**นอกขอบเขต** (ตัดออกโดยตั้งใจ)

- ช่องทางชำระเงินจริง (payment gateway ตัดเงินจริง) — `payment` บันทึกโดยพนักงาน
- อีเมล / SMS ยืนยันการจอง
- **แก้ไขการจองหลังสร้าง** (เปลี่ยนวัน/ห้อง) — ปัจจุบันมีเฉพาะ cancel + เปลี่ยนสถานะ ยังไม่มี `PATCH /bookings/{id}`
- Overbooking / waitlist (trigger กันจองซ้อนคือสิ่งตรงข้ามโดยตั้งใจ)
- หลายสาขา (multi-property) — สมมติว่ามีที่พักเดียว
- ราคาแบบไดนามิก (yield management) เกินกว่า rate plan แบบกำหนดล่วงหน้า

## 3. ผู้ใช้งาน (Actors) — 6 role ที่บังคับใช้จริง

| Role (`app_user.role` CHECK) | บทบาทหลัก | สิทธิ์ที่ backend ให้ (`deps.py`) |
|---|---|---|
| **customer** (ลูกค้า / สมาชิกเว็บ) | ค้นห้องว่าง, ขอจอง, ดู/ยกเลิกการจองของตนเอง, รีวิว | ดูของตัวเอง |
| **receptionist** (พนักงานเคาน์เตอร์) | สร้าง/ยกเลิกการจอง, check-in/out, รับชำระเงิน, ออก invoice, เปลี่ยนสถานะห้อง | `FRONT_DESK_ROLES` |
| **housekeeping** (แม่บ้าน) | อัปเดตงานทำความสะอาด, มอบหมาย, triage งานแจ้งซ่อม | `HOUSEKEEPING_ROLES` |
| **accounting** (บัญชี) | ดู/ออก/void ใบแจ้งหนี้, รายงานการเงิน (daily revenue) | `ACCOUNTING_ROLES` |
| **manager** (ผู้จัดการ) | ดูรายงาน/Dashboard, จัดการ rate plan, เพิ่มห้อง, ดู audit trail | `MANAGER_ROLES` |
| **admin** (Super Admin) | เข้าถึงทุกอย่าง + จัดการ user/role | `require_role("admin")` |

Frontend มี navigation แยกตาม role และ `ProtectedRoute` (`require="staff" | "manager" | "admin"`)
ตรงกับ RBAC ของ backend

## 4. ข้อมูลหลัก (Core Data / Entities) — 19 ตาราง

### กลุ่ม People
1. **customer** — ลูกค้า: ชื่อ, email (unique), เบอร์โทร, เลขบัตร/พาสปอร์ต
2. **staff** — พนักงาน: ชื่อ, email (unique), role (receptionist/housekeeping/accounting/manager/admin), วันเริ่มงาน, is_active

### กลุ่ม Auth (application layer)
3. **app_user** — บัญชีล็อกอิน: username + email (unique), password_hash (bcrypt), role (6 ค่า), ผูกกับ customer **หรือ** staff (`chk_user_identity`), failed_login_count / locked_until, token_version
4. **auth_event** — audit การเข้าใช้งาน: login_success / login_fail / logout / locked / password_change + IP + user agent
5. **audit_log** — audit การกระทำทางธุรกิจระดับระบบ: actor_label (ชื่อ ณ เวลานั้น), action, entity_type/id, summary, `data` (JSONB before/after)

### กลุ่ม Catalog
6. **room_type** — ประเภทห้อง: ชื่อ (unique), คำอธิบาย, `base_price_per_night`, `max_occupancy`
7. **room** — ห้องพักรายห้อง: เลขห้อง (unique), ชั้น, ประเภท, สถานะ 4 แบบ (available / cleaning / maintenance / closed)
8. **service** — บริการเสริม: ชื่อ (unique), ราคา, is_active
9. **rate_plan** — แผนราคาตามช่วงเวลา: ผูก room_type, kind (seasonal/weekend/weekday/promotion), ราคา/คืน, ช่วงวันที่มีผล, applies_weekday/weekend, priority

### กลุ่ม Booking (transaction)
10. **booking** — การจอง: ลูกค้า, พนักงานที่ทำรายการ, วันที่จอง, check-in, check-out, จำนวนผู้เข้าพัก, สถานะ
11. **booking_room** — ห้องแต่ละห้องในการจอง + `price_per_night` ที่ล็อกไว้ ณ เวลาจอง (associative; `UNIQUE(booking_id, room_id)`)
12. **booking_service** — บริการเสริมที่ผูกกับการจอง + quantity + `unit_price` ที่ล็อกไว้ (associative)
13. **review** — รีวิวหลังเข้าพัก: คะแนน 1–5, ความเห็น, `UNIQUE(booking_id)`

### กลุ่ม Billing
14. **payment** — การชำระเงินของการจอง (จ่ายได้หลายงวด): จำนวนเงิน, method (cash/credit_card/bank_transfer/promptpay), สถานะ (pending/paid/refunded/failed), เวลาที่จ่าย
15. **invoice** — ใบแจ้งหนี้: partial unique index `uq_invoice_active_booking` (หนึ่งการจองมีใบที่ไม่ void ได้ ≤ 1 ใบ), invoice_no (unique), issued_by, สถานะ (draft/issued/paid/void), tax_rate (VAT 7%), subtotal / tax_amount / total (แช่แข็ง ณ วันที่ออก)
16. **invoice_line** — บรรทัดในใบแจ้งหนี้: line_no, line_type (room/service/discount — ส่วนลดใช้ unit_price ติดลบ), จำนวน, ราคา, ยอด

### กลุ่ม Operations
17. **room_status_log** — ประวัติการเปลี่ยนสถานะห้อง: ห้อง, ใครเปลี่ยน (staff), จากสถานะไหนเป็นไหน, เมื่อไหร่
18. **housekeeping_task** — งานแม่บ้าน: ห้อง, booking (ถ้ามี), task_type (checkout_clean/stayover_clean/deep_clean/turndown/inspection), สถานะ (pending/in_progress/done/skipped), วันที่กำหนด, ผู้รับผิดชอบ, เวลาเริ่ม/เสร็จ
19. **maintenance_ticket** — งานแจ้งซ่อม: ห้อง (NULL = พื้นที่ส่วนกลาง), ผู้แจ้ง, ผู้รับงาน, หมวด (plumbing/electrical/hvac/furniture/appliance/other), ความเร่งด่วน (low/normal/high/urgent), สถานะ (open/in_progress/resolved/closed/cancelled), หัวข้อ, รายละเอียด, วิธีแก้

*ส่วน views (7) / functions (3) / triggers (6) / indexes (28) / roles (2) ดู §6*

## 5. กฎทางธุรกิจ (Business Rules)

> รายการกฎทางธุรกิจฉบับอ้างอิงที่ใช้เลขตรงกับความเห็นใน `03-database/schema.sql` (BR-3, BR-5, BR-6, BR-9, BR-11) และระบุกลไกบังคับใช้ของทุกข้อ อยู่ในเอกสาร [`business-requirements.md`](business-requirements.md) หัวข้อ 6 เลขกฎในหัวข้อนี้เป็นเลขเดิมของข้อเสนอโครงงาน

### การจอง & ห้อง
- **BR-1** อีเมลของลูกค้าและของพนักงานต้องไม่ซ้ำในระบบ
- **BR-2** หนึ่งการจอง (booking) เป็นของลูกค้า **หนึ่งคนเท่านั้น**
- **BR-3** หนึ่งการจองมีได้ **หลายห้อง**; ห้องเดียวกันห้ามอยู่ในการจองเดียวกันซ้ำ (`UNIQUE(booking_id, room_id)`)
- **BR-4** `check_out_date` ต้อง **มากกว่า** `check_in_date` เสมอ (`chk_booking_dates`)
- **BR-5** **ห้ามจองห้องซ้ำ**: ห้องหนึ่งห้ามถูกจองซ้อนช่วงวันกันในการจองที่ยัง active (pending / confirmed / checked_in) — บังคับด้วย trigger `bi_booking_room_no_overlap`
- **BR-6** ราคา/คืน และราคาบริการเสริม **บันทึกสำเนา ณ เวลาที่จอง** ลงใน `booking_room.price_per_night` / `booking_service.unit_price` เพื่อไม่ให้ยอดเปลี่ยนตามราคาปัจจุบัน
- **BR-7** สถานะการจอง: `pending → confirmed → checked_in → checked_out` และยกเลิกเป็น `cancelled` ได้จาก pending หรือ confirmed
- **BR-8** สถานะห้องมี 4 ค่า (available / cleaning / maintenance / closed); "จองแล้ว / เข้าพักอยู่" **ไม่เก็บซ้ำ** แต่อนุมานจาก `booking`
- **BR-9** เมื่อ booking เปลี่ยนเป็น `checked_out` → trigger `au_booking_checkout_housekeeping` สร้าง `housekeeping_task` แบบ `checkout_clean` ให้ทุกห้องในการจอง และตั้งสถานะห้องเป็น `cleaning` อัตโนมัติ
- **BR-10** ลบ `room_type` ไม่ได้ถ้ายังมี `room` อ้างอิงอยู่ (ON DELETE RESTRICT); ลบ `room` / `customer` / `staff` ที่มีการจองอ้างอิงไม่ได้เช่นกัน

### ราคา
- **BR-11** ราคาที่เรียกเก็บต่อคืนมาจาก `fn_quote_room()`: เลือก `rate_plan` ที่ยัง active, ครอบวันนั้น และตรงวันธรรมดา/วันหยุด โดยใช้ `priority` สูงสุด; ถ้าไม่มีแผนตรง → `room_type.base_price_per_night`
- **BR-12** `rate_plan` ต้องมี `valid_to ≥ valid_from` และต้องมีผลอย่างน้อยวันธรรมดา **หรือ** วันหยุด (`applies_weekday OR applies_weekend`)

### ยอดเงิน & ใบแจ้งหนี้
- **BR-13** ยอดที่ต้องชำระของการจอง = Σ(ราคา/คืน × จำนวนคืน ของทุกห้อง) + Σ(ราคาบริการเสริม × จำนวน) − Σ(เงินที่จ่ายแล้ว) — คำนวณสดผ่าน view `v_booking_bill` (ไม่เก็บ `total_amount` ซ้ำ)
- **BR-14** จ่ายเงินได้ **หลายงวด** (มัดจำ + ส่วนที่เหลือ); เฉพาะ `payment.status = 'paid'` เท่านั้นที่นับเป็นยอดชำระแล้ว
- **BR-15** หนึ่งการจองมีใบแจ้งหนี้ที่ใช้งานอยู่ได้ **ไม่เกิน 1 ใบ** (partial unique index `uq_invoice_active_booking` เฉพาะใบที่ไม่ void; void แล้วออกใบใหม่ได้); `invoice_no` ต้องไม่ซ้ำ
- **BR-16** ยอด `subtotal / tax_amount / total` บนใบแจ้งหนี้ **แช่แข็ง ณ วันที่ออก** (แก้ย้อนหลังไม่ได้ตามหลักบัญชี); `invoice` แยกจาก `payment` โดยเจตนา — invoice = ยอดที่ **เรียกเก็บ**, payment = เงินที่ **รับมา**

### รีวิว
- **BR-17** คะแนนรีวิวอยู่ในช่วง 1–5 (`CHECK`); หนึ่ง booking รีวิวได้ **ครั้งเดียว** (`UNIQUE(booking_id)`); รีวิวได้เมื่อการจอง `checked_out` แล้วเท่านั้น (บังคับที่ชั้น API)

### ความปลอดภัย & audit
- **BR-18** ระบบเก็บรหัสผ่านเป็น **bcrypt hash เท่านั้น** ห้ามเก็บ/ส่ง plaintext; `app_user.username` และ `email` ต้องไม่ซ้ำ; `chk_user_identity` บังคับให้ role customer ผูก `customer_id`, role อื่นผูก `staff_id`
- **BR-19** ทุกครั้งที่ล็อกอิน (สำเร็จ/ล้มเหลว), logout, ถูกล็อก, เปลี่ยนรหัส → บันทึกลง `auth_event`; ล็อกอินผิดติดกัน **5 ครั้ง** ล็อกบัญชี 15 นาที (`failed_login_count` / `locked_until`); เพิ่ม `token_version` = เพิกถอน JWT ที่ออกไปแล้วทั้งหมด
- **BR-20** ทุกการสร้างการจอง และการเปลี่ยนสถานะการจอง → trigger `aiu_booking_audit` เขียน `audit_log` โดยระบุผู้กระทำจาก `SET LOCAL app.actor = '<username>'` ที่แอปตั้งให้ต่อ request

## 6. Data Integrity & Constraints

| ประเภท | การบังคับใช้ |
|---|---|
| Primary Key | ทุกตารางมี PK (surrogate key แบบ `SERIAL` / `BIGSERIAL`) |
| Foreign Key | 25 ความสัมพันธ์ — `ON DELETE RESTRICT` กับข้อมูลอ้างอิงหลัก, `CASCADE` กับรายการย่อยของ booking/invoice, `SET NULL` กับ actor/room ที่ optional |
| Unique | `customer.email`, `staff.email`, `room.room_number`, `(booking_id, room_id)`, `(booking_id, service_id)`, `review.booking_id`, `invoice.booking_id`, `invoice.invoice_no`, `(invoice_id, line_no)`, `app_user.username`, `app_user.email`, `room_type.name`, `service.name` |
| Check | check-out > check-in, จำนวนเงิน/ราคา ≥ 0, rating 1–5, ชุดค่า status/role/method/kind/category/priority/task_type, `chk_user_identity`, `chk_rate_plan_range/days`, `chk_hk_done_time`, `chk_mt_resolved` |
| Not Null | อีเมล, ชื่อห้อง/ประเภทห้อง, วัน check-in/out, `payment.amount`, `password_hash`, ฟิลด์คีย์ทั้งหมด |
| Views (7) | `v_booking_bill`, `v_current_guests`, `v_room_type_revenue`, `v_housekeeping_board`, `v_maintenance_open`, `v_daily_revenue`, `v_invoice_summary` |
| Functions (3) | `fn_available_rooms(date,date)`, `fn_quote_room(int,date)`, `fn_quote_stay(int,date,date)` |
| Triggers (6) | `bi_booking_room_no_overlap` (BR-5), `bu_booking_no_overlap` (BR-5), `au_booking_checkout_housekeeping` (BR-9), `aiu_booking_audit` (BR-20), `aiu_app_user_role_sync` + `au_staff_role_sync` (ให้ `staff.role` ตรงกับ `app_user.role`) |
| Indexes (28) | บน FK และคอลัมน์ที่ query บ่อย (booking dates/status, availability, audit time/entity ฯลฯ) |
| Security | password = bcrypt (`pgcrypto`), แอปต่อ DB ด้วย role least-privilege `app_rw` (อ่านอย่างเดียว = `app_readonly`), audit ผ่าน `auth_event` + `audit_log` — ดู `../SECURITY.md` และ `../03-database/roles.sql` |

## 7. ผลลัพธ์ที่จะส่ง (Deliverables)

1. เอกสาร Proposal / Business requirement ฉบับนี้ — `01-proposal/proposal.md`
2. **ER Diagram** — `02-design/Draft/ERD.md` (Mermaid), `ERD.drawio` (draw.io), `ERD.svg` — generate จาก `schema.sql` ด้วย `02-design/Draft/build_erd.py` (จัดคอลัมน์ตามกลุ่ม, crow's foot)
3. Relational Schema + เอกสาร Normalization 1NF→3NF — `02-design/Draft/relational-schema.md`
4. `schema.sql` (DDL: 19 tables + views + functions + triggers + indexes) + `roles.sql` (least-privilege) + `seed.sql` + `queries.sql` — `03-database/`
5. System Architecture diagram — `02-design/Draft/architecture.svg` (ภาษา/library ต่อ layer)
6. Final Report + Presentation — `07-report/`
7. **Web app** (FastAPI + SQLAlchemy 2 async + psycopg 3) + **SPA** (React 18 + Vite + TS) + Deploy (Docker Compose: db · api · web) — `04-backend/`, `05-frontend/`, `06-deploy/`
8. Security plan — `SECURITY.md`
