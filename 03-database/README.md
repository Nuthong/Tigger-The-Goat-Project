# Database — วิธีสร้างและทดสอบ

**DBMS:** PostgreSQL 16+ (ทดสอบบน 18.6)

## ไฟล์

| ไฟล์ | หน้าที่ |
|---|---|
| `schema.sql` | DDL: **19 ตาราง** + 98 constraint + 61 index + **7 view** + **3 function** + **6 trigger** (ต้องมี extension `pgcrypto`) |
| `roles.sql`  | สร้าง DB role แบบ least-privilege (`app_rw` ให้แอป, `app_readonly` ให้รายงาน) — ดู `../SECURITY.md` รันใน pgAdmin ได้ (ไม่ใช้ตัวแปร psql) |
| `seed.sql`   | ข้อมูลตัวอย่าง (rerun ได้ — ขึ้นต้นด้วย `TRUNCATE ... RESTART IDENTITY`) |
| `queries.sql`| 22 query: business query, 2 query ด้าน security, query ตรวจกฎ (Q13, Q19) และตัวอย่างทดสอบ trigger (Q16, Q22 ครอบด้วย `BEGIN ... ROLLBACK`) |

## สร้าง DB ครั้งแรก

```bash
createdb roombooking
psql -d roombooking -v ON_ERROR_STOP=1 -f schema.sql
psql -d roombooking -v ON_ERROR_STOP=1 -f roles.sql
psql -d roombooking -v ON_ERROR_STOP=1 -f seed.sql
psql -d roombooking -P pager=off -f queries.sql
```

> ต่อ DB บน Windows / pgAdmin: สร้าง database ชื่อ `roombooking` แล้วเปิด Query Tool
> รันไฟล์ตามลำดับ `schema.sql` → `roles.sql` → `seed.sql` → `queries.sql`
> (`roles.sql` รันใน Query Tool ได้เลย ใช้ `current_database()` แทนตัวแปร psql)

## รีเซ็ตข้อมูล (คงโครงสร้าง)

```bash
psql -d roombooking -f seed.sql
```

## รีเซ็ตทั้งหมด

```bash
psql -d roombooking -f schema.sql   # schema.sql มี DROP ... CASCADE อยู่หัวไฟล์
psql -d roombooking -f seed.sql
```

## จุดที่ใช้โชว์ตอนนำเสนอ

- **3NF** — ไม่มีคอลัมน์ยอดรวม/CSV, ราคาใช้ snapshot ที่ตั้งใจ (ดู `../02-design/Draft/relational-schema.md`)
- **Referential integrity** — FK RESTRICT กับ master, CASCADE กับรายการย่อยของ booking
- **Trigger `bi_booking_room_no_overlap` + `bu_booking_no_overlap`** — กันจองห้องซ้อนช่วงวัน (BR-5)
  ทั้งตอนเพิ่มห้องให้การจอง และตอนแก้วันที่หรือสถานะในตาราง `booking` ใช้ `pg_advisory_xact_lock`
  ต่อห้อง การจองห้องเดียวกันพร้อมกันจึงต้องรอกัน (กัน write skew ที่ READ COMMITTED)
  ทดสอบ: uncomment Q16 ใน `queries.sql` แล้วรัน → ต้องได้ `ERROR: ... double booking` (ROLLBACK ท้ายบล็อก)
- **Function `fn_available_rooms(check_in, check_out)`** — ค้นห้องว่างตามช่วงวัน
- **View `v_booking_bill`** — คำนวณใบแจ้งยอดสดตาม BR-9 (ค่าห้อง + บริการ − ที่จ่าย + ที่คืนเงิน, ยกเลิกแล้ว = 0)
  เขียนด้วย LATERAL ต่อหนึ่งการจอง จึงกรองด้วย `booking_id` จากตารางอื่นแล้วใช้ index ได้
- **Window function** — `RANK()` จัดอันดับรายได้รายห้อง (Q7), `SUM() OVER ()` ส่วนแบ่งรายได้บริการ (Q12)
- **Function `fn_quote_room` / `fn_quote_stay`** — ราคาห้องตาม `rate_plan`
  (ฤดูกาล / วันธรรมดา-วันหยุด / โปรโมชั่น) เลือกแผนที่ `priority` สูงสุด ไม่มีแผนตรง → ราคาตั้งต้น
  ทดสอบ: `SELECT fn_quote_room(5, DATE '2026-10-02'), fn_quote_room(5, DATE '2026-10-03'), fn_quote_room(5, DATE '2026-12-31');`
  → `3800` (วันธรรมดา) / `4400` (เสาร์) / `5200` (ไฮซีซั่น ชนะด้วย priority)
- **Trigger `au_booking_checkout_housekeeping`** — พอ booking เป็น `checked_out`
  ระบบสร้างงาน `checkout_clean` ให้ทุกห้องอัตโนมัติ และตั้งสถานะห้องเป็น `cleaning`
- **Trigger `aiu_booking_audit`** — เขียน `audit_log` ทุกครั้งที่สร้าง/เปลี่ยนสถานะการจอง
  ผู้ทำมาจาก `SET LOCAL app.actor = '<username>'` ที่แอปตั้งให้ต่อ transaction
- **View ฝ่ายปฏิบัติการ** — `v_housekeeping_board` (กระดานแม่บ้าน), `v_maintenance_open`
  (งานซ่อมค้าง เรียงตามความเร่งด่วน), `v_daily_revenue` (รายได้รายวันสำหรับบัญชี),
  `v_invoice_summary` (ใบแจ้งหนี้ + ยอดค้าง)
- **Trigger sync บทบาท** — `staff.role` กับ `app_user.role` ตรงกันเสมอ (กัน update anomaly)
- **Security** — รหัสผ่านใน `app_user` เก็บเป็น bcrypt (pgcrypto), audit ผ่าน `auth_event`, DB role least-privilege ใน `roles.sql` (ดู `../SECURITY.md`), หนึ่งบัญชีต่อคน (UNIQUE)

## บัญชีทดสอบ (seed) — รหัสผ่านทุกบัญชี = `Passw0rd!2026`

| username | role | ผูกกับ |
|---|---|---|
| `admin01` | admin (Super Admin) | staff #9 |
| `manager01` | manager (Hotel Manager) | staff #1 (กมล) |
| `recep01` / `recep02` | receptionist (Front Desk) | staff #2 / #3 |
| `house01` / `house02` | housekeeping | staff #6 / #7 |
| `acct01` | accounting | staff #8 |
| `somchai` / `anna` / `malee` | customer | customer #1 / #2 / #3 |

> hash ถูกสร้างสด ๆ ตอนรัน `seed.sql` ด้วย `crypt('Passw0rd!2026', gen_salt('bf',12))` — DB ไม่มี plaintext
> ตรวจรหัสแบบ SQL: `SELECT password_hash = crypt('Passw0rd!2026', password_hash) FROM app_user WHERE username='somchai';`

## ข้อมูลตัวอย่างมีอะไรบ้าง

| ตาราง | จำนวน | หมายเหตุ |
|---|---:|---|
| room_type | 5 | Cityview Room / Parkview Room / Premier Skyline Room / Skyline Residence / Oriental Suite |
| room | 155 | 9 ชั้น · ห้อง 404 = maintenance |
| customer | 1,000 | #1-12 มีรายละเอียดครบ, 2 คนยังไม่เคยจอง (ทดสอบ anti-join Q11) |
| staff | 9 | #1 manager, #2-4 receptionist, #5 "Online Reservations", #6-7 housekeeping, #8 accounting, #9 admin |
| service | 6 | breakfast, transfer, laundry, extra bed, late checkout, mini bar |
| app_user | 10 | 1 admin + 1 manager + 2 receptionist + 2 housekeeping + 1 accounting + 3 customer |
| auth_event | 6 | ตัวอย่าง login สำเร็จ/ล้มเหลว/locked/logout |
| booking | 2,484 | #1-14 สถานการณ์ตัวอย่าง + ประวัติ 2,470 รายการ (checked_out 2,474, checked_in 3, confirmed 3, pending 2, cancelled 2) |
| booking_room | 2,487 | ประวัติเลือกห้องแบบไม่ซ้อนช่วงวัน (Q13 ต้องได้ 0 แถว) |
| booking_service | 11 | |
| payment | 2,480 | paid / pending / refunded และการจ่ายมัดจำบางส่วน |
| review | 1,651 | เฉพาะการจองที่ checked_out |
| room_status_log | 4 | |
| rate_plan | 11 | weekend ทั้ง 5 ประเภท + ไฮซีซั่นปีใหม่ 3 + โปรฯ โลว์ซีซั่น 2 + 1 แผนที่ปิดใช้งาน |
| invoice | 4 | ออกให้ B1-B4 (VAT 7%, ราคารวม VAT) |
| invoice_line | 12 | แยกบรรทัด room / service / discount (ผลรวมบรรทัด = `total`) |
| housekeeping_task | 8 | done 3, in_progress 1, pending 3, skipped 1 |
| maintenance_ticket | 6 | open 3, in_progress 1, resolved 1, closed 1 |
| audit_log | 2,488 | สร้างอัตโนมัติจาก trigger ตอน INSERT booking + 4 แถวตัวอย่าง |

> วันที่ในข้อมูลตัวอย่างอิง "วันนี้" = **2026-09-07** ตั้งใจให้เป็นภาพ ณ วันเดียว (snapshot)
> เพื่อให้ผลของทุก query และ test คงที่ ถ้าต้องการข้อมูลถึงปัจจุบันให้รัน history-loader
> (`06-deploy/history`) ซึ่งเติมประวัติ 2000-01-01 ถึง 2026-12-31
>
> ฐานข้อมูลที่มีข้อมูลอยู่แล้ว (เช่นหลังรัน history-loader) อัปเดตโครงสร้างด้วย
> `06-deploy/migrations/2026-09-24_test-report-fixes.sql` ได้โดยไม่ต้องโหลดใหม่
