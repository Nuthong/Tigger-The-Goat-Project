-- =====================================================================
--  08_verify : ตรวจทุกความสัมพันธ์จากแถวจริงในตาราง (ไม่ใช่จาก temp table)
--  นับจำนวนแถวที่ผิดกฎของแต่ละข้อ - ถ้ามีข้อใดไม่เป็น 0 จะ RAISE EXCEPTION
--  ทำให้ทั้ง transaction ROLLBACK ไม่มีอะไรถูกเขียนลงฐาน
-- =====================================================================
\echo '>> 08 verify'

-- สถิติของ planner ยังเป็นของก่อน bulk load: v_booking_bill คำนวณยอดทีละการจอง (LATERAL)
-- ถ้าไม่ ANALYZE ก่อน planner จะคิดว่าตารางเล็กแล้ว seq scan ต่อการจอง (ช้ามาก)
-- ANALYZE ทำใน transaction ได้ และไม่เปลี่ยนข้อมูล
ANALYZE booking;
ANALYZE booking_room;
ANALYZE booking_service;
ANALYZE payment;
ANALYZE invoice;
ANALYZE invoice_line;
ANALYZE housekeeping_task;

CREATE TEMP TABLE h_check (no int, name text, bad bigint);
CREATE TEMP TABLE h_gb AS                    -- การจองที่สร้างรอบนี้
SELECT b.* FROM booking b, h_param p WHERE b.booking_id > p.booking_base;
ALTER TABLE h_gb ADD PRIMARY KEY (booking_id);
ANALYZE h_gb;

-- เวลาเช็คอิน/เอาท์จริงจาก audit trail
CREATE TEMP TABLE h_evt AS
SELECT entity_id::int AS booking_id,
       max(at) FILTER (WHERE data->>'to' = 'checked_in')  AS in_at,
       max(at) FILTER (WHERE data->>'to' = 'checked_out') AS out_at,
       max(at) FILTER (WHERE data->>'to' = 'cancelled')   AS cancel_at,
       count(*) FILTER (WHERE action = 'booking.create')  AS n_create
FROM audit_log a, h_param p
WHERE a.audit_id > p.audit_base AND a.entity_type = 'booking'
  AND a.action IN ('booking.create', 'booking.status_change')
GROUP BY entity_id;
ALTER TABLE h_evt ADD PRIMARY KEY (booking_id);
ANALYZE h_evt;

-- 1) ห้องเดียวกันไม่มีแขกสองกลุ่มในคืนเดียวกัน (ทั้งฐาน รวมข้อมูลเดิม)
INSERT INTO h_check
SELECT 1, 'no two live stays share a room-night (BR-5)', count(*)
FROM (SELECT b.check_in_date AS ci,
             max(b.check_out_date) OVER (PARTITION BY br.room_id ORDER BY b.check_in_date, b.booking_id
                                         ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prev_co
      FROM booking_room br JOIN booking b USING (booking_id)
      WHERE b.status <> 'cancelled') z
WHERE ci < prev_co;

-- 2) เล่นการจองย้อนตามเวลาจริงแล้ว trigger BR-5 ไม่มีวันเด้ง: การจองที่ถูกยกเลิกทับ
--    ห้อง/คืนเดียวกับการจองอื่นได้ก็ต่อเมื่อช่วงเวลา "มีผล" ของทั้งสองไม่ซ้อนกัน
CREATE TEMP TABLE h_v AS
SELECT br.room_id, b.booking_id, daterange(b.check_in_date, b.check_out_date) AS rng,
       b.booking_date AS t0, COALESCE(e.cancel_at, 'infinity') AS t1, b.status = 'cancelled' AS cancelled
FROM h_gb b JOIN booking_room br USING (booking_id) LEFT JOIN h_evt e USING (booking_id);
CREATE INDEX ON h_v USING gist (rng);
INSERT INTO h_check
SELECT 2, 'cancelled holds never clash in time with another booking of the room', count(*)
FROM h_v c JOIN h_v x ON x.rng && c.rng AND x.room_id = c.room_id AND x.booking_id <> c.booking_id
WHERE c.cancelled AND x.t0 < c.t1 AND c.t0 < x.t1;

-- 3) BR-7 / ความจุ: แขก >= จำนวนห้อง และ <= ความจุรวม
INSERT INTO h_check
SELECT 3, 'guests between rooms and total capacity (BR-7)', count(*)
FROM (SELECT b.booking_id, b.num_guests, count(*) AS nr, sum(rt.max_occupancy) AS cap
      FROM h_gb b JOIN booking_room br USING (booking_id) JOIN room r USING (room_id)
      JOIN room_type rt USING (room_type_id) GROUP BY 1, 2) z
WHERE num_guests < nr OR num_guests > cap;

-- 4) ราคาต่อคืน = fn_quote_stay / คืน (BR-6 snapshot ผ่าน rate plan)
--    fn_quote_stay = ผลรวม fn_quote_room ทุกคืน -> ตรวจทุกห้องด้วยราคารายคืนจาก fn_quote_room
--    และเรียก fn_quote_stay ตรง ๆ กับตัวอย่าง 1% เพื่อยืนยันว่าเท่ากัน
CREATE TEMP TABLE h_qr AS
SELECT rt.room_type_id, d::date AS d, fn_quote_room(rt.room_type_id, d::date) AS price
FROM room_type rt CROSS JOIN generate_series(DATE '2000-01-01', DATE '2026-12-31', INTERVAL '1 day') AS d;
CREATE UNIQUE INDEX ON h_qr (room_type_id, d);
ANALYZE h_qr;
INSERT INTO h_check
SELECT 4, 'room price = fn_quote_stay / nights', count(*)
FROM (SELECT br.booking_room_id, br.price_per_night, b.check_out_date - b.check_in_date AS n,
             sum(q.price) AS quoted
      FROM h_gb b
      JOIN booking_room br USING (booking_id)
      JOIN room r USING (room_id)
      JOIN h_qr q ON q.room_type_id = r.room_type_id
                 AND q.d >= b.check_in_date AND q.d < b.check_out_date
      GROUP BY 1, 2, 3) z
WHERE price_per_night <> round(quoted / n, 2);
INSERT INTO h_check
SELECT 4, 'room price = fn_quote_stay / nights (direct call, 1% sample)', count(*)
FROM h_gb b JOIN booking_room br USING (booking_id) JOIN room r USING (room_id)
WHERE b.booking_id % 100 = 0
  AND br.price_per_night <> round(fn_quote_stay(r.room_type_id, b.check_in_date, b.check_out_date)
                                  / (b.check_out_date - b.check_in_date), 2);

-- 5) บริการเสริมไม่เกินเพดาน BR-29
INSERT INTO h_check
SELECT 5, 'add-on quantity within BR-29 cap', count(*)
FROM (SELECT b.booking_id, b.num_guests AS g, b.check_out_date - b.check_in_date AS n,
             (SELECT count(*) FROM booking_room x WHERE x.booking_id = b.booking_id) AS nr
      FROM h_gb b) z
JOIN booking_service bs USING (booking_id)
WHERE bs.quantity > least(99, CASE bs.service_id WHEN 1 THEN z.g * z.n WHEN 2 THEN 2 * z.nr
                                                 WHEN 5 THEN z.nr ELSE z.nr * z.n END);

-- 6) พนักงานทุกคนทำงานอยู่จริงในวันที่ถูกอ้างถึง
INSERT INTO h_check
SELECT 6, 'every staff reference falls inside that person''s employment', sum(n)
FROM (
    SELECT count(*) AS n FROM h_gb b JOIN h_staff s USING (staff_id)
     WHERE (b.booking_date AT TIME ZONE 'Asia/Bangkok')::date NOT BETWEEN s.start_d AND s.stop_d
    UNION ALL
    SELECT count(*) FROM housekeeping_task t JOIN h_staff s ON s.staff_id = t.assigned_to, h_param p
     WHERE t.task_id > p.task_base AND t.scheduled_for NOT BETWEEN s.start_d AND s.stop_d
    UNION ALL
    SELECT count(*) FROM maintenance_ticket t, h_param p, h_staff s
     WHERE t.ticket_id > p.ticket_base AND s.staff_id IN (t.reported_by, t.assigned_to)
       AND (t.created_at AT TIME ZONE 'Asia/Bangkok')::date NOT BETWEEN s.start_d AND s.stop_d
    UNION ALL
    SELECT count(*) FROM room_status_log l JOIN h_staff s ON s.staff_id = l.changed_by, h_param p
     WHERE l.log_id > p.log_base AND (l.changed_at AT TIME ZONE 'Asia/Bangkok')::date NOT BETWEEN s.start_d AND s.stop_d
    UNION ALL
    SELECT count(*) FROM invoice i JOIN h_staff s ON s.staff_id = i.issued_by, h_param p
     WHERE i.invoice_id > p.inv_base AND (i.issued_at AT TIME ZONE 'Asia/Bangkok')::date NOT BETWEEN s.start_d AND s.stop_d
) z;

-- 7) เงิน: เช็คเอาท์แล้วจ่ายครบพอดี, ยกเลิกแล้วเก็บไว้ไม่เกินค่าคืนแรก, ที่เหลือไม่จ่ายเกิน
INSERT INTO h_check
SELECT 7, 'money: settled at checkout, fee <= first night on cancel, never overpaid', count(*)
FROM h_gb b
JOIN v_booking_bill vb USING (booking_id)
LEFT JOIN (SELECT booking_id, sum(amount) AS refunded FROM payment WHERE status = 'refunded'
           GROUP BY booking_id) rf USING (booking_id)
LEFT JOIN (SELECT booking_id, sum(price_per_night) AS first_night FROM booking_room
           GROUP BY booking_id) fn USING (booking_id)
WHERE CASE b.status
          WHEN 'checked_out' THEN vb.paid_total - COALESCE(rf.refunded, 0) <> vb.grand_total
          WHEN 'cancelled'   THEN vb.paid_total - COALESCE(rf.refunded, 0) NOT BETWEEN 0 AND fn.first_night
          ELSE vb.paid_total - COALESCE(rf.refunded, 0) > vb.grand_total
      END;

-- 8) ใบกำกับภาษี: มีครบทุกการจองที่เช็คเอาท์, ยอดตรงบิล, บรรทัดรวมตรง, VAT ถูก, ออกวันเช็คเอาท์
INSERT INTO h_check
SELECT 8, 'one invoice per checked-out stay; totals, lines and VAT agree', count(*)
FROM h_gb b
LEFT JOIN invoice i USING (booking_id)
LEFT JOIN v_booking_bill vb USING (booking_id)
LEFT JOIN (SELECT invoice_id, sum(amount) AS s FROM invoice_line GROUP BY invoice_id) l USING (invoice_id)
WHERE (b.status = 'checked_out') <> (i.invoice_id IS NOT NULL)
   OR (i.invoice_id IS NOT NULL
       AND (i.total <> vb.grand_total OR l.s <> i.total OR i.subtotal + i.tax_amount <> i.total
            OR i.subtotal <> round(i.total / 1.07, 2) OR i.status <> 'paid'
            OR (i.issued_at AT TIME ZONE 'Asia/Bangkok')::date <> b.check_out_date));

-- 9) งานทำความสะอาดหลังเช็คเอาท์: ห้องละ 1 งานทุกการเช็คเอาท์ ในวันเช็คเอาท์ และไม่มีงานเกิน
INSERT INTO h_check
SELECT 9, 'exactly one checkout_clean per checked-out room, on the checkout day', count(*)
FROM (SELECT br.booking_id, br.room_id, b.status, b.check_out_date FROM h_gb b JOIN booking_room br USING (booking_id)) x
FULL JOIN (SELECT t.booking_id, t.room_id, count(*) AS n, min(t.scheduled_for) AS d
           FROM housekeeping_task t, h_param p
           WHERE t.task_id > p.task_base AND t.task_type = 'checkout_clean'
           GROUP BY 1, 2) t USING (booking_id, room_id)
WHERE (x.status = 'checked_out') <> (COALESCE(t.n, 0) = 1)
   OR (t.n IS NOT NULL AND t.d <> x.check_out_date);

-- 10) งานระหว่างพัก (stayover / turndown / ตรวจ VIP) อยู่ในช่วงเข้าพักของการจองนั้นจริง
INSERT INTO h_check
SELECT 10, 'in-stay tasks fall inside their own booking''s stay and room', count(*)
FROM housekeeping_task t
JOIN h_param p ON t.task_id > p.task_base
LEFT JOIN booking b USING (booking_id)
LEFT JOIN booking_room br ON br.booking_id = t.booking_id AND br.room_id = t.room_id
WHERE t.task_type IN ('stayover_clean', 'turndown', 'inspection') AND t.booking_id IS NOT NULL
  AND (br.room_id IS NULL OR b.status NOT IN ('checked_in', 'checked_out', 'confirmed')
       OR t.scheduled_for < b.check_in_date OR t.scheduled_for >= b.check_out_date
       OR (t.task_type = 'stayover_clean' AND t.scheduled_for = b.check_in_date));

-- 11) แม่บ้านทำทีละงาน: ช่วงเวลาทำงานของคนเดียวกันไม่ทับกัน, เริ่มหลังงานถูกสร้าง
INSERT INTO h_check
SELECT 11, 'a housekeeper works one task at a time, never before it exists', count(*)
FROM (SELECT t.started_at, t.created_at, t.completed_at,
             lag(COALESCE(t.completed_at, 'infinity')) OVER (PARTITION BY t.assigned_to
                                         ORDER BY t.started_at, t.task_id) AS prev_done
      FROM housekeeping_task t, h_param p
      WHERE t.task_id > p.task_base AND t.started_at IS NOT NULL) z
WHERE started_at < prev_done OR started_at < created_at OR completed_at <= started_at;

-- 12) แขกเข้าห้องหลังห้องพร้อม: ทำความสะอาด/ตรวจห้องวันเข้าพักเสร็จก่อนเวลาเช็คอิน
CREATE TEMP TABLE h_rdy AS
SELECT t.room_id, t.scheduled_for AS d,
       bool_or(t.completed_at IS NULL) AS open_task, max(t.completed_at) AS last_done
FROM housekeeping_task t, h_param p
WHERE t.task_id > p.task_base AND t.task_type IN ('checkout_clean', 'inspection')
  AND t.status <> 'skipped'
GROUP BY 1, 2;
CREATE UNIQUE INDEX ON h_rdy (room_id, d);
ANALYZE h_rdy;
INSERT INTO h_check
SELECT 12, 'guests check in only after the room is cleaned / inspected', count(*)
FROM h_gb b
JOIN h_evt e USING (booking_id)
JOIN booking_room br USING (booking_id)
JOIN h_rdy r ON r.room_id = br.room_id AND r.d = b.check_in_date
WHERE e.in_at IS NOT NULL AND (r.open_task OR r.last_done > e.in_at);

-- 13) ห้องที่ปิดซ่อมไม่มีแขกพักระหว่างปิด / ปิดโรงแรมช่วงโควิดไม่มีแขก
CREATE TEMP TABLE h_closed AS
SELECT t.room_id,
       daterange((t.created_at AT TIME ZONE 'Asia/Bangkok')::date,
                 COALESCE((t.resolved_at AT TIME ZONE 'Asia/Bangkok')::date, DATE '2027-01-01')) AS rng
FROM maintenance_ticket t, h_param p
WHERE t.ticket_id > p.ticket_base AND t.description LIKE '%ปิดห้องงดขาย%'
UNION ALL
SELECT room_id, daterange('2020-04-01', '2020-07-01') FROM room;
CREATE INDEX ON h_closed USING gist (rng);
INSERT INTO h_check
SELECT 13, 'nobody sleeps in a room while it is out of order or the hotel is closed', count(*)
FROM booking b
JOIN booking_room br USING (booking_id)
JOIN h_closed c ON c.room_id = br.room_id AND c.rng && daterange(b.check_in_date, b.check_out_date)
WHERE b.status <> 'cancelled';

-- 14) room_status_log ต่อกันเป็นสายเดียว: สถานะเดิมของแถวถัดไป = สถานะใหม่ของแถวก่อน
INSERT INTO h_check
SELECT 14, 'room_status_log is one unbroken chain per room', count(*)
FROM (SELECT old_status,
             lag(new_status, 1, 'available') OVER (PARTITION BY room_id ORDER BY changed_at, log_id) AS prev_new
      FROM room_status_log l, h_param p WHERE l.log_id > p.log_base) z
WHERE old_status <> prev_new;

-- 15) รีวิวเฉพาะการจองที่เช็คเอาท์แล้ว หลังเวลาเช็คเอาท์ และไม่เกินตอนนี้
INSERT INTO h_check
SELECT 15, 'reviews only after a finished stay', count(*)
FROM review r JOIN h_gb b USING (booking_id) JOIN h_evt e USING (booking_id) CROSS JOIN h_param p
WHERE b.status <> 'checked_out' OR r.created_at <= e.out_at OR r.created_at > p.t_now;

-- 16) ลูกค้า: สมัครก่อนหรือพร้อมการจองแรก, มีเลขบัตรเมื่อเคยเช็คอิน (ลูกค้าใหม่ทั้งหมด)
INSERT INTO h_check
SELECT 16, 'customer exists before first booking; ID recorded once checked in', count(*)
FROM customer c
JOIN (SELECT customer_id, min(booking_date) AS first_b,
             bool_or(status IN ('checked_in', 'checked_out')) AS stayed
      FROM h_gb GROUP BY customer_id) g USING (customer_id)
CROSS JOIN h_param p
WHERE c.created_at > g.first_b
   OR (c.customer_id > p.cust_base AND (c.id_card_no IS NOT NULL) <> g.stayed);

-- 17) ช่วงเวลา: 2000-01-01 .. 2026-12-31 และไม่มีเหตุการณ์ในอนาคต
INSERT INTO h_check
SELECT 17, 'dates inside 2000-01-01 .. 2026-12-31, no event stamped in the future', sum(n)
FROM (
    SELECT count(*) AS n FROM h_gb b, h_param p
     WHERE b.check_in_date < DATE '2000-01-01' OR b.check_out_date > DATE '2026-12-31'
        OR b.booking_date < TIMESTAMPTZ '2000-01-01 00:00+07' OR b.booking_date > p.t_now
    UNION ALL
    SELECT count(*) FROM payment x, h_param p WHERE x.payment_id > p.pay_base AND x.paid_at > p.t_now
    UNION ALL
    SELECT count(*) FROM housekeeping_task x, h_param p
     WHERE x.task_id > p.task_base AND (x.created_at > p.t_now OR x.completed_at > p.t_now)
    UNION ALL
    SELECT count(*) FROM audit_log x, h_param p
     WHERE x.audit_id > p.audit_base AND (x.at > p.t_now OR x.at < TIMESTAMPTZ '2000-01-01 00:00+07')
    UNION ALL
    SELECT count(*) FROM customer x, h_param p
     WHERE x.customer_id > p.cust_base AND x.created_at < TIMESTAMPTZ '2000-01-01 00:00+07'
) z;

-- 18) audit ครบวงจร: สร้าง 1 ครั้ง, เช็คอิน/เอาท์/ยกเลิกตรงกับสถานะ, เรียงเวลาถูก
INSERT INTO h_check
SELECT 18, 'audit trail matches every booking''s life cycle in order', count(*)
FROM h_gb b LEFT JOIN h_evt e USING (booking_id)
WHERE e.n_create IS DISTINCT FROM 1
   OR (b.status IN ('checked_in', 'checked_out')) <> (e.in_at IS NOT NULL)
   OR (b.status = 'checked_out') <> (e.out_at IS NOT NULL)
   OR (b.status = 'cancelled') <> (e.cancel_at IS NOT NULL)
   OR e.in_at < b.booking_date OR e.out_at <= e.in_at OR e.cancel_at < b.booking_date
   OR (e.in_at AT TIME ZONE 'Asia/Bangkok')::date <> b.check_in_date
   OR (e.out_at AT TIME ZONE 'Asia/Bangkok')::date <> b.check_out_date;

-- 19) สถานะห้องตอนนี้ตรงกับงานที่ค้าง (ยังทำความสะอาด = cleaning, ยังซ่อม = maintenance)
INSERT INTO h_check
SELECT 19, 'room status agrees with open cleaning / repair work', count(*)
FROM room r
LEFT JOIN (SELECT DISTINCT ON (room_id) room_id, new_status
             FROM room_status_log ORDER BY room_id, changed_at DESC, log_id DESC) l USING (room_id)
WHERE r.status <> COALESCE(l.new_status, 'available');

-- 20) FK ทุกเส้นของแถวที่นำเข้า (bulk load ข้าม trigger ของ FK ไว้ จึงตรวจเองทั้งหมด)
INSERT INTO h_check
SELECT 20, 'foreign keys of every imported row resolve', sum(n)
FROM (
    SELECT count(*) AS n FROM booking x WHERE NOT EXISTS (SELECT 1 FROM customer y WHERE y.customer_id = x.customer_id)
                                           OR NOT EXISTS (SELECT 1 FROM staff y WHERE y.staff_id = x.staff_id)
    UNION ALL SELECT count(*) FROM booking_room x WHERE NOT EXISTS (SELECT 1 FROM booking y WHERE y.booking_id = x.booking_id)
                                                    OR NOT EXISTS (SELECT 1 FROM room y WHERE y.room_id = x.room_id)
    UNION ALL SELECT count(*) FROM booking_service x WHERE NOT EXISTS (SELECT 1 FROM booking y WHERE y.booking_id = x.booking_id)
                                                       OR NOT EXISTS (SELECT 1 FROM service y WHERE y.service_id = x.service_id)
    UNION ALL SELECT count(*) FROM payment x WHERE NOT EXISTS (SELECT 1 FROM booking y WHERE y.booking_id = x.booking_id)
    UNION ALL SELECT count(*) FROM review x WHERE NOT EXISTS (SELECT 1 FROM booking y WHERE y.booking_id = x.booking_id)
    UNION ALL SELECT count(*) FROM invoice x WHERE NOT EXISTS (SELECT 1 FROM booking y WHERE y.booking_id = x.booking_id)
                                               OR (x.issued_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM staff y WHERE y.staff_id = x.issued_by))
    UNION ALL SELECT count(*) FROM invoice_line x WHERE NOT EXISTS (SELECT 1 FROM invoice y WHERE y.invoice_id = x.invoice_id)
    UNION ALL SELECT count(*) FROM housekeeping_task x WHERE NOT EXISTS (SELECT 1 FROM room y WHERE y.room_id = x.room_id)
                                    OR (x.booking_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM booking y WHERE y.booking_id = x.booking_id))
                                    OR (x.assigned_to IS NOT NULL AND NOT EXISTS (SELECT 1 FROM staff y WHERE y.staff_id = x.assigned_to))
    UNION ALL SELECT count(*) FROM maintenance_ticket x
               WHERE (x.room_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM room y WHERE y.room_id = x.room_id))
                  OR NOT EXISTS (SELECT 1 FROM staff y WHERE y.staff_id = x.reported_by)
                  OR (x.assigned_to IS NOT NULL AND NOT EXISTS (SELECT 1 FROM staff y WHERE y.staff_id = x.assigned_to))
    UNION ALL SELECT count(*) FROM room_status_log x WHERE NOT EXISTS (SELECT 1 FROM room y WHERE y.room_id = x.room_id)
                                                       OR NOT EXISTS (SELECT 1 FROM staff y WHERE y.staff_id = x.changed_by)
    UNION ALL SELECT count(*) FROM audit_log x
               WHERE x.actor_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM app_user y WHERE y.user_id = x.actor_user_id)
) z;

SELECT no AS "#", name AS "check", bad AS "violations" FROM h_check ORDER BY no;

DO $$
DECLARE failed text;
BEGIN
    SELECT string_agg(format('#%s %s: %s', no, name, bad), E'\n' ORDER BY no)
      INTO failed FROM h_check WHERE bad <> 0;
    IF failed IS NOT NULL THEN
        RAISE EXCEPTION E'history import rejected - consistency checks failed:\n%', failed;
    END IF;
    RAISE NOTICE '   all % consistency checks passed', (SELECT count(*) FROM h_check);
END $$;

-- เครื่องหมายว่านำเข้าแล้ว (กันรันซ้ำโดยไม่ได้รีเซ็ต)
INSERT INTO audit_log (actor_label, action, entity_type, entity_id, summary, data)
SELECT 'history-import', 'history.import', 'database', NULL,
       format('นำเข้าประวัติ 2000-01-01 .. 2026-12-31: %s การจอง', (SELECT count(*) FROM h_gb)),
       jsonb_build_object('scale', current_setting('hist.scale'), 'seed', current_setting('hist.seed'),
                          'first_booking_id', (SELECT min(booking_id) FROM h_gb),
                          'last_booking_id',  (SELECT max(booking_id) FROM h_gb));
