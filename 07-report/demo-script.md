# Demo script - Room Booking (Tigger Oriental)

บทสาธิตคู่กับสไลด์ช่วง **Live Demo**.
แต่ละสถานการณ์มี 4 ส่วนเหมือนกัน: คำถามทางธุรกิจ, สิ่งที่ทำบนหน้าเว็บ, ตารางที่ถูกอ่านหรือเขียน และ SQL ที่เปิดใน pgAdmin เพื่อให้เห็นแถวที่เปลี่ยนจริง

## เตรียมก่อนขึ้นพูด

| จอ | เปิดอะไร |
|---|---|
| ซ้าย | เว็บ `http://localhost:8081` (แท็บแขก และแท็บ `/admin`) |
| ขวา | pgAdmin: server `localhost:5433`, user `postgres` / `postgres`, database `roombooking`, เปิด Query Tool ไว้ |

- บัญชีเดโมทุกบัญชีใช้รหัสผ่าน `Passw0rd!2026`
  - พนักงานต้อนรับ: `recep01`
  - ผู้จัดการ: `manager01`
  - แขก: `somchai`
- ข้อมูลในฐานมี 342,309 การจอง ย้อนหลัง 27 ปี
  - หลีกเลี่ยงหน้าที่ต้องโหลดประวัติทั้งหมด เช่น รายชื่อลูกค้าทั้งหมด ใช้เวลา 5-10 วินาที
  - หน้าที่ใช้ในเดโมนี้ตอบเร็วทุกหน้า
- การจองที่เพิ่งสร้างจะเป็นแถวที่ `booking_id` สูงสุดเสมอ SQL ทุกข้อด้านล่างจึงใช้เงื่อนไขนี้ คัดลอกไปวางได้เลยโดยไม่ต้องแก้เลข

```sql
WHERE booking_id = (SELECT max(booking_id) FROM booking)
```

---

## Demo 1 - มีห้องว่างไหม ราคาเท่าไร

- **ถามว่า:** 10-12 ต.ค. มีห้องว่างไหม และห้องสวีทช่วงปีใหม่ราคาเท่าไร
- **บนเว็บ:** เปิด Rooms แล้วเลือกวันเข้าและวันออก ระบบแสดงเฉพาะห้องที่ว่างจริง และคิดราคาทีละคืน
- **อ่าน:** `room`, `room_type`, `booking`, `booking_room`, `rate_plan`
- **เขียน:** ไม่มี เป็นการอ่านอย่างเดียว

```sql
SELECT room_number, room_type, price_per_night
FROM fn_available_rooms(DATE '2026-10-10', DATE '2026-10-12');

-- Oriental Suite (room_type_id 5) 30 ธ.ค. - 2 ม.ค. = 3 คืน
SELECT fn_quote_stay(5, DATE '2026-12-30', DATE '2027-01-02');   -- 15600.00
```

**จุดที่ต้องพูด:** ราคามาจาก `fn_quote_room` ซึ่งเลือกแผนราคาที่ priority สูงสุดของแต่ละคืน (BR-17)

## Demo 2 - จองสองห้องพร้อมอาหารเช้า

- **บนเว็บ:** `/admin/bookings/new` (ล็อกอินเป็น `recep01`)
  1. เลือกวัน
  2. เลือก 2 ห้อง
  3. เพิ่มอาหารเช้า
  4. กดบันทึก
- **เขียน:**
  - `booking` 1 แถว
  - `booking_room` 2 แถว ล็อกราคาต่อคืนไว้ (BR-6)
  - `booking_service`
  - `audit_log` ซึ่ง trigger เขียนเอง

```sql
SELECT b.booking_id, b.status, r.room_number, br.price_per_night
FROM booking b
JOIN booking_room br USING (booking_id)
JOIN room r USING (room_id)
WHERE b.booking_id = (SELECT max(booking_id) FROM booking);

SELECT s.name, bs.quantity, bs.unit_price
FROM booking_service bs JOIN service s USING (service_id)
WHERE bs.booking_id = (SELECT max(booking_id) FROM booking);

SELECT at, actor_label, action, summary
FROM audit_log
WHERE entity_type = 'booking'
  AND entity_id = (SELECT max(booking_id) FROM booking)::text
ORDER BY at;
```

**จุดที่ต้องพูด:** รัน `fn_available_rooms` ของ Demo 1 ซ้ำด้วยวันเดียวกัน สองห้องที่เพิ่งจองจะหายไปจากผลลัพธ์ เปรียบเหมือนการตัด stock ห้อง

## Demo 3 - ลองขายห้องเดิมซ้ำ

- **บนเว็บ:** จองห้องเดียวกันซ้ำในช่วงวันที่ทับกับ Demo 2 ระบบจะปฏิเสธพร้อมข้อความ `double booking`
- **เขียน:** ไม่มี เพราะ trigger `bi_booking_room_no_overlap` สั่ง RAISE แล้ว transaction ทั้งหมดถูกยกเลิก

```sql
-- Q13 ใน queries.sql: ตรวจทั้งฐานข้อมูลว่ามีการจองซ้อนหรือไม่ ต้องได้ 0 แถว (ราว 50 ms)
SELECT br1.room_id, b1.booking_id AS booking_a, b2.booking_id AS booking_b
FROM booking_room br1
JOIN booking_room br2 ON br2.room_id = br1.room_id AND br2.booking_id > br1.booking_id
JOIN booking b1 ON b1.booking_id = br1.booking_id AND b1.status IN ('pending','confirmed','checked_in')
JOIN booking b2 ON b2.booking_id = br2.booking_id AND b2.status IN ('pending','confirmed','checked_in')
WHERE b1.check_in_date < b2.check_out_date
  AND b2.check_in_date < b1.check_out_date;
```

## Demo 4 - จ่ายสองงวด

- **บนเว็บ:** ล็อกอินเป็นแขก `somchai` แล้วจองออนไลน์ การจองจะเริ่มที่สถานะ `pending`
  1. ฝั่งพนักงานกด Take payment ครึ่งหนึ่งของยอด
  2. จ่ายส่วนที่เหลือ สถานะเปลี่ยนเป็น `confirmed`
- **เขียน:** `payment` งวดละ 1 แถว, `booking.status`, `audit_log`

```sql
SELECT payment_id, amount, method, status
FROM payment WHERE booking_id = (SELECT max(booking_id) FROM booking);

SELECT nights, room_total, service_total, grand_total, paid_total, balance_due
FROM v_booking_bill WHERE booking_id = (SELECT max(booking_id) FROM booking);
```

**จุดที่ต้องพูด:** ยอดคงค้างไม่ได้เก็บเป็นคอลัมน์ใดเลย view `v_booking_bill` คำนวณจากรายการทุกครั้งที่เรียก (BR-9, 3NF)

## Demo 5 - เช็คเอาท์แล้วเกิดงานทำความสะอาด

- **บนเว็บ:**
  1. กด Check in แล้วเปิดหน้า In-house ให้เห็นชื่อแขก
  2. รับชำระยอดให้ครบ แล้วกด Check out (BR-30: ถ้ายังค้างชำระ ระบบจะตอบ 409 `balance_due`)
  3. เปิดหน้า Housekeeping งานใหม่จะขึ้นเอง
- **เขียน:** `booking.status` ส่วนที่ trigger `au_booking_checkout_housekeeping` เขียนเอง:
  - `housekeeping_task` ห้องละ 1 แถว
  - `room.status = 'cleaning'`

```sql
SELECT * FROM v_current_guests;          -- รันหลังเช็คอิน

SELECT h.task_id, r.room_number, h.task_type, h.status, r.status AS room_status
FROM housekeeping_task h JOIN room r USING (room_id)
WHERE h.booking_id = (SELECT max(booking_id) FROM booking);
```

## Demo 6 - ยกเลิกกระชั้นชิดต้องเสียค่าคืนแรก

เทียบได้กับค่าปรับคืนหนังสือช้าในระบบห้องสมุด

- **บนเว็บ:**
  1. จองห้องสำหรับพรุ่งนี้และจ่ายเต็ม
  2. กด Cancel ซึ่งเลยเส้นตาย 48 ชั่วโมงแล้ว (BR-13)
- **เขียน:**
  - `payment` แถวใหม่สถานะ `refunded` เท่ากับยอดที่จ่ายลบค่าคืนแรก
  - `booking.status = 'cancelled'`
  - ห้องกลับมาว่าง

```sql
SELECT amount, status, reference_no
FROM payment WHERE booking_id = (SELECT max(booking_id) FROM booking);
-- paid ยอดเต็ม และ refunded ยอดเต็มลบคืนแรก (reference REFUND-<id>)
```

**จุดที่ต้องพูดเพิ่ม:** การจองออนไลน์ที่ไม่จ่ายภายใน 30 นาทีจะถูกปล่อยห้องคืนเอง (BR-12)

## Demo 7 - ออกใบกำกับภาษี

- **บนเว็บ:**
  1. เปิดหน้า Booking แล้วกด Issue invoice
  2. เปิดหน้าพิมพ์ `/print/invoice/<id>`
- **เขียน:** `invoice` 1 แถวต่อการจอง (BR-18) และ `invoice_line` 1 แถวต่อรายการ

```sql
SELECT i.invoice_no, l.line_no, l.line_type, l.description, l.amount, i.tax_amount, i.total
FROM invoice i JOIN invoice_line l USING (invoice_id)
WHERE i.booking_id = (SELECT max(booking_id) FROM booking)
ORDER BY l.line_no;

SELECT invoice_no, total, paid_total, balance_due
FROM v_invoice_summary ORDER BY issued_at DESC LIMIT 5;
```

**ระวังตอนเดโม:** ราคาห้องและบริการเป็นราคารวม VAT แล้ว (BR-18)
- `invoice_line` เก็บยอดรวม VAT ผลรวมของทุกบรรทัดจึงเท่ากับ `total` ไม่ใช่ `subtotal` ซึ่งเป็นยอดก่อน VAT
- ตรวจแล้วตรงกันครบทั้ง 317,871 ใบในฐานข้อมูล
- อย่าเปิด Q19 ใน `queries.sql` โชว์ Q19 เทียบผลรวมบรรทัดกับ `subtotal` จึงได้ `diff` ไม่เป็นศูนย์ทุกใบ ทั้งที่ข้อมูลถูกต้อง ปัญหาอยู่ที่คำอธิบายในตัว query เอง
- ถ้าจะโชว์ว่ายอดตรงกัน ใช้ query นี้แทน:

```sql
SELECT i.invoice_no, SUM(l.amount) AS lines_total, i.total,
       i.subtotal + i.tax_amount = i.total AS vat_split_ok
FROM invoice i JOIN invoice_line l USING (invoice_id)
WHERE i.booking_id = (SELECT max(booking_id) FROM booking)
GROUP BY i.invoice_id;
```

## Demo 8 - คำถามของผู้บริหาร

- **บนเว็บ:** ล็อกอินเป็น `manager01`
  1. เปิดหน้า Overview และ Reports
  2. ดาวน์โหลด CSV
- **อ่าน:** ใช้ view อย่างเดียว ไม่มีการเขียน

```sql
SELECT room_type, booking_count, revenue FROM v_room_type_revenue;   -- ราว 3 วินาทีบนข้อมูล 27 ปี

SELECT stay_date, room_nights, room_revenue
FROM v_daily_revenue WHERE stay_date >= CURRENT_DATE - 30;
```

ถ้าจะโชว์ window function ให้เปิด Q7 (`RANK() OVER`) จาก `03-database/queries.sql`
