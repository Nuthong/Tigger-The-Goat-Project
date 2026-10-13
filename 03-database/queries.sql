-- =====================================================================
--  310-2209 Database Systems -- Mini-DB Group Project
--  ระบบจองห้องพัก / Room Booking System
--  queries.sql : Business Queries (JOIN / GROUP BY / subquery / window / view)
--  ต้องรัน schema.sql + seed.sql ก่อน
--  วิธีรัน : psql -U postgres -d roombooking -f queries.sql
-- =====================================================================


-- =====================================================================
--  Q1) ห้องว่างในช่วงวันที่ต้องการ (INNER JOIN + NOT EXISTS + correlated subquery)
--      โจทย์: ลูกค้าอยากเข้าพัก 1-5 ต.ค. 2026 มีห้องอะไรว่างบ้าง
-- =====================================================================
SELECT r.room_number, rt.name AS room_type, rt.base_price_per_night, rt.max_occupancy
FROM room r
JOIN room_type rt ON rt.room_type_id = r.room_type_id
WHERE r.status = 'available'
  AND NOT EXISTS (
      SELECT 1
      FROM booking_room br
      JOIN booking b ON b.booking_id = br.booking_id
      WHERE br.room_id = r.room_id
        AND b.status IN ('pending','confirmed','checked_in')
        AND b.check_in_date < DATE '2026-10-05'
        AND DATE '2026-10-01' < b.check_out_date
  )
ORDER BY rt.base_price_per_night, r.room_number;

-- แบบสั้นด้วย function ที่สร้างไว้ใน schema.sql :
-- SELECT * FROM fn_available_rooms('2026-10-01','2026-10-05');


-- =====================================================================
--  Q2) ใบแจ้งยอดของทุกการจอง (ใช้ VIEW v_booking_bill)
--      แสดงค่าห้อง + ค่าบริการ + ยอดรวม + จ่ายแล้ว + ค้างจ่าย
-- =====================================================================
SELECT booking_id, customer_name, check_in_date, check_out_date, nights,
       room_total, service_total, grand_total, paid_total, balance_due
FROM v_booking_bill
ORDER BY booking_id;


-- =====================================================================
--  Q3) รายชื่อผู้เข้าพักที่ยัง check-in อยู่ตอนนี้ + ห้องที่พัก
--      (JOIN 5 ตาราง)
-- =====================================================================
SELECT b.booking_id,
       c.first_name || ' ' || c.last_name AS customer_name,
       rm.room_number,
       rt.name AS room_type,
       b.check_in_date,
       b.check_out_date,
       GREATEST(b.check_out_date - CURRENT_DATE, 0) AS nights_left   -- 0 = เลยวันออกแล้วแต่ยังไม่ได้ check-out
FROM booking b
JOIN customer c      ON c.customer_id = b.customer_id
JOIN booking_room br ON br.booking_id = b.booking_id
JOIN room rm         ON rm.room_id = br.room_id
JOIN room_type rt    ON rt.room_type_id = rm.room_type_id
WHERE b.status = 'checked_in'
ORDER BY rm.room_number;


-- =====================================================================
--  Q4) รายได้ตามประเภทห้อง (GROUP BY + SUM + นับ room-nights)
--      ไม่รวมการจองที่ยกเลิก
-- =====================================================================
SELECT rt.name AS room_type,
       COUNT(DISTINCT br.booking_id)                                   AS bookings,
       SUM(bk.check_out_date - bk.check_in_date)                       AS room_nights,
       SUM(br.price_per_night * (bk.check_out_date - bk.check_in_date)) AS revenue
FROM booking_room br
JOIN booking bk   ON bk.booking_id = br.booking_id AND bk.status <> 'cancelled'
JOIN room rm      ON rm.room_id = br.room_id
JOIN room_type rt ON rt.room_type_id = rm.room_type_id
GROUP BY rt.name
ORDER BY revenue DESC;


-- =====================================================================
--  Q5) อัตราการเข้าพักรายเดือน (occupancy rate)
--      = room-nights ที่ขายได้ในเดือนนั้น / (จำนวนห้องทั้งหมด * จำนวนวันในเดือน)
--      ใช้ generate_series ช่วยแตกวันเข้าพักออกเป็นรายวัน
-- =====================================================================
WITH nightly AS (
    SELECT gs::date AS stay_date, br.room_id
    FROM booking_room br
    JOIN booking b ON b.booking_id = br.booking_id AND b.status <> 'cancelled'
    CROSS JOIN LATERAL generate_series(b.check_in_date,
                                       b.check_out_date - 1,
                                       INTERVAL '1 day') AS gs
),
total_rooms AS (SELECT COUNT(*) AS n FROM room)
SELECT to_char(date_trunc('month', n.stay_date), 'YYYY-MM')          AS month,
       COUNT(*)                                                      AS room_nights_sold,
       (SELECT n FROM total_rooms) *
           EXTRACT(DAY FROM (date_trunc('month', n.stay_date)
                             + INTERVAL '1 month - 1 day'))          AS room_nights_capacity,
       ROUND(100.0 * COUNT(*) /
             ((SELECT n FROM total_rooms) *
              EXTRACT(DAY FROM (date_trunc('month', n.stay_date)
                                + INTERVAL '1 month - 1 day'))), 1)  AS occupancy_pct
FROM nightly n
GROUP BY date_trunc('month', n.stay_date)
ORDER BY month;


-- =====================================================================
--  Q6) ลูกค้าที่ใช้จ่ายสูงสุด (aggregate บน VIEW + ORDER BY + LIMIT)
--      การจองที่ยกเลิกไม่ใช่ยอดใช้จ่าย จึงตัดออก
-- =====================================================================
SELECT c.customer_id,
       c.first_name || ' ' || c.last_name AS customer_name,
       COUNT(*)               AS total_bookings,
       SUM(vb.grand_total)    AS lifetime_value
FROM v_booking_bill vb
JOIN booking  b ON b.booking_id  = vb.booking_id
JOIN customer c ON c.customer_id = vb.customer_id
WHERE b.status <> 'cancelled'
GROUP BY c.customer_id, customer_name
ORDER BY lifetime_value DESC
LIMIT 5;


-- =====================================================================
--  Q7) จัดอันดับรายได้ของแต่ละห้อง ด้วย WINDOW FUNCTION (RANK)
-- =====================================================================
SELECT rm.room_number,
       rt.name AS room_type,
       COALESCE(SUM(br.price_per_night * (b.check_out_date - b.check_in_date)), 0) AS revenue,
       RANK() OVER (ORDER BY COALESCE(SUM(br.price_per_night *
                    (b.check_out_date - b.check_in_date)), 0) DESC)               AS revenue_rank
FROM room rm
JOIN room_type rt     ON rt.room_type_id = rm.room_type_id
LEFT JOIN booking_room br ON br.room_id = rm.room_id
LEFT JOIN booking b       ON b.booking_id = br.booking_id AND b.status <> 'cancelled'
GROUP BY rm.room_number, rt.name
ORDER BY revenue_rank, rm.room_number;


-- =====================================================================
--  Q8) การจองที่ยังค้างชำระ (HAVING + join กับ payment ผ่าน VIEW)
-- =====================================================================
SELECT vb.booking_id, vb.customer_name, vb.grand_total, vb.paid_total, vb.balance_due,
       b.status
FROM v_booking_bill vb
JOIN booking b ON b.booking_id = vb.booking_id
WHERE b.status <> 'cancelled'
  AND vb.balance_due > 0
ORDER BY vb.balance_due DESC;


-- =====================================================================
--  Q9) คะแนนรีวิวเฉลี่ยตามประเภทห้อง (subquery DISTINCT + AVG)
--      รีวิวผูกกับการจอง ไม่ใช่ห้อง การจองที่มี 2 ห้องประเภทเดียวกันจะ join ได้ 2 แถว
--      จึงตัดซ้ำเป็น (review, room_type) ก่อน แล้วค่อยนับและหาค่าเฉลี่ย
-- =====================================================================
SELECT rt.name AS room_type,
       COUNT(*)                         AS review_count,
       ROUND(AVG(x.rating), 2)          AS avg_rating,
       MIN(x.rating)                    AS worst,
       MAX(x.rating)                    AS best
FROM (
    SELECT DISTINCT rv.review_id, rv.rating, rm.room_type_id
    FROM review rv
    JOIN booking_room br ON br.booking_id = rv.booking_id
    JOIN room rm         ON rm.room_id = br.room_id
) x
JOIN room_type rt ON rt.room_type_id = x.room_type_id
GROUP BY rt.name
ORDER BY avg_rating DESC;


-- =====================================================================
--  Q10) ผลงานพนักงาน: จำนวนการจองที่ดูแล + ยอดขายที่ทำได้ (CASE + GROUP BY)
-- =====================================================================
SELECT s.first_name || ' ' || s.last_name AS staff_name,
       s.role,
       COUNT(b.booking_id)                                              AS bookings_handled,
       SUM(CASE WHEN b.status = 'cancelled' THEN 1 ELSE 0 END)          AS cancelled,
       SUM(CASE WHEN b.status <> 'cancelled'
                THEN vb.grand_total ELSE 0 END)                         AS sales_value
FROM staff s
LEFT JOIN booking b        ON b.staff_id = s.staff_id
LEFT JOIN v_booking_bill vb ON vb.booking_id = b.booking_id
GROUP BY s.staff_id, staff_name, s.role
ORDER BY sales_value DESC;


-- =====================================================================
--  Q11) ลูกค้าที่ไม่เคยจองเลย (LEFT JOIN ... IS NULL) — anti-join
-- =====================================================================
SELECT c.customer_id, c.first_name || ' ' || c.last_name AS customer_name, c.email
FROM customer c
LEFT JOIN booking b ON b.customer_id = c.customer_id
WHERE b.booking_id IS NULL
ORDER BY c.customer_id;


-- =====================================================================
--  Q12) บริการเสริมยอดนิยม (join ตารางเชื่อม + SUM(quantity) + ส่วนแบ่งรายได้)
-- =====================================================================
SELECT sv.name AS service,
       SUM(bs.quantity)                    AS units_sold,
       SUM(bs.quantity * bs.unit_price)    AS revenue,
       ROUND(100.0 * SUM(bs.quantity * bs.unit_price)
             / SUM(SUM(bs.quantity * bs.unit_price)) OVER (), 1) AS revenue_share_pct
FROM booking_service bs
JOIN service sv ON sv.service_id = bs.service_id
JOIN booking b  ON b.booking_id = bs.booking_id AND b.status <> 'cancelled'
GROUP BY sv.name
ORDER BY revenue DESC;


-- =====================================================================
--  Q13) ตรวจสอบกฎ "ห้ามจองซ้อน" — ควรได้ 0 แถวเสมอถ้าข้อมูลถูกต้อง
--      (self-join ตารางเชื่อม + เงื่อนไขช่วงวันซ้อน)
--      ตรวจทุกการจองที่ไม่ได้ยกเลิก รวมประวัติที่ checked_out แล้วด้วย
--      เพราะแขกสองคนพักห้องเดียวกันในคืนเดียวกันไม่ได้ไม่ว่าเมื่อไร
--      (ข้อยกเว้น: แขกเช็คเอาท์ก่อนกำหนดแล้วขายห้องต่อ วันออกเดิมยังค้างอยู่จึงอาจถูกนับ)
-- =====================================================================
SELECT br1.room_id,
       b1.booking_id AS booking_a, b1.check_in_date AS in_a, b1.check_out_date AS out_a,
       b2.booking_id AS booking_b, b2.check_in_date AS in_b, b2.check_out_date AS out_b
FROM booking_room br1
JOIN booking_room br2 ON br2.room_id = br1.room_id AND br2.booking_id > br1.booking_id
JOIN booking b1 ON b1.booking_id = br1.booking_id AND b1.status <> 'cancelled'
JOIN booking b2 ON b2.booking_id = br2.booking_id AND b2.status <> 'cancelled'
WHERE b1.check_in_date < b2.check_out_date
  AND b2.check_in_date < b1.check_out_date
ORDER BY br1.room_id;


-- =====================================================================
--  Q14) [SECURITY] รายงาน audit: ล็อกอินล้มเหลวใน 7 วันก่อนเหตุการณ์ล่าสุด
--       แยกตาม username + IP และแสดงเฉพาะคู่ที่ผิดซ้ำ (กรอง event_type, GROUP BY, HAVING)
--       นับถอยหลังจากเหตุการณ์ล่าสุดในตาราง ไม่ใช่ now() ผลจึงไม่ว่างเมื่อรันหลังวันที่ seed
-- =====================================================================
SELECT ae.username_tried,
       host(ae.ip_address)          AS ip,
       COUNT(*)                     AS fail_count,
       MAX(ae.created_at)           AS last_attempt
FROM auth_event ae
WHERE ae.event_type = 'login_fail'
  AND ae.created_at >= (SELECT MAX(created_at) FROM auth_event) - INTERVAL '7 days'
GROUP BY ae.username_tried, ae.ip_address
HAVING COUNT(*) >= 2
ORDER BY fail_count DESC, last_attempt DESC;


-- =====================================================================
--  Q15) [SECURITY] รายชื่อบัญชีผู้ใช้ + ตัวตนที่ผูก + สถานะล็อก
--       (LEFT JOIN app_user -> customer / staff, CASE, coalesce ชื่อ)
-- =====================================================================
SELECT u.user_id,
       u.username,
       u.role,
       COALESCE(c.first_name || ' ' || c.last_name,
                s.first_name || ' ' || s.last_name) AS person_name,
       u.is_active,
       CASE WHEN u.locked_until IS NOT NULL AND u.locked_until > now()
            THEN 'LOCKED' ELSE 'ok' END            AS lock_state,
       u.failed_login_count,
       u.last_login_at
FROM app_user u
LEFT JOIN customer c ON c.customer_id = u.customer_id
LEFT JOIN staff    s ON s.staff_id    = u.staff_id
ORDER BY u.role, u.username;


-- =====================================================================
--  Q16) (ทดสอบ TRIGGER) ลอง INSERT การจองซ้อนห้อง — ควรถูกปฏิเสธ
--       เอา comment ออกเพื่อลองรัน ทั้งหมดอยู่ใน transaction ที่ ROLLBACK จึงไม่ทิ้งข้อมูลไว้
--       ใช้ RETURNING ส่ง booking_id ที่เพิ่งสร้างต่อ ไม่เดาเลข (เลขจริงขึ้นกับจำนวนข้อมูล)
-- =====================================================================
-- BEGIN;
-- WITH nb AS (
--     INSERT INTO booking (customer_id, staff_id, check_in_date, check_out_date, num_guests, status)
--     VALUES (5, 2, '2026-09-07', '2026-09-09', 2, 'confirmed')
--     RETURNING booking_id
-- )
-- INSERT INTO booking_room (booking_id, room_id, price_per_night)
-- SELECT booking_id, 7, 1800.00 FROM nb;
-- -- ห้อง 203 (room_id 7) ทับกับ B6 (2026-09-05..09-09) -> ERROR: ... (double booking)
-- ROLLBACK;


-- =====================================================================
--  ส่วนขยาย : ตารางฝ่ายปฏิบัติการ (rate plan / invoice / housekeeping /
--             maintenance / audit)  -- Q17..Q22
-- =====================================================================

-- ---------------------------------------------------------------------
-- Q17) ราคาห้องรายคืนตาม rate_plan เทียบกับราคาตั้งต้น
--      โชว์ว่า "วันหยุด" และ "ไฮซีซั่น" ทับราคาตั้งต้นได้จริง
-- ---------------------------------------------------------------------
SELECT rt.name                                   AS room_type,
       d::date                                   AS night,
       to_char(d, 'Dy')                          AS dow,
       rt.base_price_per_night                   AS base_price,
       fn_quote_room(rt.room_type_id, d::date)   AS charged,
       fn_quote_room(rt.room_type_id, d::date)
           - rt.base_price_per_night             AS diff
FROM room_type rt
CROSS JOIN generate_series(DATE '2026-12-30', DATE '2027-01-03', INTERVAL '1 day') d
WHERE rt.room_type_id = 5
ORDER BY night;

-- ---------------------------------------------------------------------
-- Q18) แผนราคาที่ใช้งานอยู่ของแต่ละประเภทห้อง (เรียงตามลำดับความสำคัญ)
-- ---------------------------------------------------------------------
SELECT rt.name AS room_type, rp.name AS plan, rp.kind,
       rp.price_per_night, rp.valid_from, rp.valid_to,
       CASE WHEN rp.applies_weekday AND rp.applies_weekend THEN 'ทุกวัน'
            WHEN rp.applies_weekend THEN 'เสาร์-อาทิตย์'
            ELSE 'จันทร์-ศุกร์' END AS applies_on,
       rp.priority
FROM rate_plan rp
JOIN room_type rt ON rt.room_type_id = rp.room_type_id
WHERE rp.is_active
ORDER BY rt.room_type_id, rp.priority DESC;

-- ---------------------------------------------------------------------
-- Q19) ใบแจ้งหนี้แบบแยกบรรทัด + ตรวจว่ายอดรวมตรงกับผลรวมบรรทัด
--      ราคาห้องและบริการรวม VAT แล้ว (BR-18): บรรทัดรวมกันได้ total
--      ส่วน subtotal = total / (1 + tax_rate) และ subtotal + tax_amount = total
--      (ควรได้ diff = 0 และ vat_ok = true ทุกใบ)
-- ---------------------------------------------------------------------
SELECT i.invoice_no,
       v.customer_name,
       SUM(l.amount)              AS lines_total,
       i.total,
       i.total - SUM(l.amount)    AS diff,
       i.subtotal,
       i.tax_amount,
       i.subtotal + i.tax_amount = i.total AS vat_ok
FROM invoice i
JOIN invoice_line   l ON l.invoice_id = i.invoice_id
JOIN v_invoice_summary v ON v.invoice_id = i.invoice_id
GROUP BY i.invoice_id, i.invoice_no, v.customer_name, i.subtotal, i.tax_amount, i.total
ORDER BY i.invoice_no;

-- ---------------------------------------------------------------------
-- Q20) ภาระงานแม่บ้านรายคน แยกตามสถานะงาน (งานค้าง / กำลังทำ / เสร็จแล้ว)
--      LEFT JOIN เพื่อให้เห็นแม่บ้านที่ยังไม่มีงานเลยด้วย (นับได้ 0)
--      staff.role ตรงกับ app_user.role เสมอ เพราะ trigger sync ใน schema.sql (6.4)
-- ---------------------------------------------------------------------
SELECT s.first_name || ' ' || s.last_name AS housekeeper,
       COUNT(h.task_id) FILTER (WHERE h.status = 'pending')     AS pending,
       COUNT(h.task_id) FILTER (WHERE h.status = 'in_progress') AS in_progress,
       COUNT(h.task_id) FILTER (WHERE h.status = 'done')        AS done
FROM staff s
LEFT JOIN housekeeping_task h ON h.assigned_to = s.staff_id
WHERE s.role = 'housekeeping'
GROUP BY s.staff_id, s.first_name, s.last_name
ORDER BY pending DESC, housekeeper;

-- ---------------------------------------------------------------------
-- Q21) ห้องที่มีงานซ่อมค้าง พร้อมจำนวนคืนที่เคยขายได้
--      ใช้ตัดสินใจว่าห้องไหนควรรีบซ่อมก่อน (เสียรายได้มากที่สุด)
-- ---------------------------------------------------------------------
SELECT rm.room_number,
       rt.name                          AS room_type,
       t.priority,
       t.title,
       (CURRENT_DATE - t.created_at::date) AS open_days,
       COALESCE(SUM(b.check_out_date - b.check_in_date), 0) AS nights_sold
FROM maintenance_ticket t
JOIN room rm      ON rm.room_id = t.room_id
JOIN room_type rt ON rt.room_type_id = rm.room_type_id
LEFT JOIN booking_room br ON br.room_id = rm.room_id
LEFT JOIN booking b       ON b.booking_id = br.booking_id AND b.status <> 'cancelled'
WHERE t.status IN ('open', 'in_progress')
GROUP BY rm.room_number, rt.name, t.priority, t.title, t.created_at
ORDER BY CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2
                         WHEN 'normal' THEN 3 ELSE 4 END,
         open_days DESC;

-- ---------------------------------------------------------------------
-- Q22) (ทดสอบ TRIGGER + AUDIT) check-out แล้วเกิดอะไรขึ้นบ้าง
--      เอา comment ออกเพื่อลองรัน:
-- =====================================================================
-- ดูผลทั้งหมดภายใน transaction แล้ว ROLLBACK ข้อมูลจริงจึงไม่เปลี่ยน
-- BEGIN;
--   SET LOCAL app.actor = 'recep01';
--   UPDATE booking SET status = 'checked_out' WHERE booking_id = 6;
--   -- 1) มีงานทำความสะอาดถูกสร้างให้ทุกห้องของการจองนี้
--   SELECT * FROM v_housekeeping_board WHERE booking_id = 6;
--   -- 2) ห้องถูกตั้งเป็น 'cleaning' -> หลุดจากผลค้นหาห้องว่างทันที
--   SELECT room_number, status FROM room WHERE room_id = 7;
--   -- 3) audit_log บันทึกว่าใครเป็นคนเปลี่ยนสถานะ
--   SELECT actor_label, action, summary FROM audit_log ORDER BY audit_id DESC LIMIT 1;
-- ROLLBACK;
