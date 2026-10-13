-- =====================================================================
--  01_setup : ตรวจสภาพฐาน, ล้างประวัติจำลองเดิมของ seed, พนักงานตามยุค,
--             rate plan รายปี, ตารางราคา/ความต้องการรายวัน (temp ทั้งหมด)
-- =====================================================================
\echo '>> 01 setup'

-- ---- guard -----------------------------------------------------------
DO $$
BEGIN
    IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
        RAISE EXCEPTION 'run as a superuser (e.g. -U postgres): the bulk load uses session_replication_role';
    END IF;
    IF EXISTS (SELECT 1 FROM audit_log WHERE action = 'history.import') THEN
        RAISE EXCEPTION 'history is already imported - reset first: docker compose run --rm db-loader';
    END IF;
    IF (SELECT count(*) FROM room) <> 155 OR (SELECT count(*) FROM room_type) <> 5
       OR (SELECT count(*) FROM service) < 6
       OR NOT EXISTS (SELECT 1 FROM staff WHERE email = 'online@tiggeroriental.com') THEN
        RAISE EXCEPTION 'expected the seed.sql data set (155 rooms, 5 room types, 6 services, online desk staff)';
    END IF;
END $$;

-- ห้ามแอปเขียนระหว่างนำเข้า (อ่านได้ตามปกติ)
LOCK TABLE customer, staff, booking, booking_room, booking_service, payment, review,
           invoice, invoice_line, housekeeping_task, maintenance_ticket, room_status_log,
           rate_plan, audit_log, room IN EXCLUSIVE MODE;

-- ---- ล้าง "seed history" เดิม ----------------------------------------
-- seed.sql สร้างประวัติ 2,470 การจองแบบสุ่มห้องเอง: ห้องซ้อนคืนกันได้, รับจองโดยพนักงาน
-- ที่ยังไม่ถูกจ้าง, ไม่มีงานแม่บ้าน/ใบกำกับภาษี -> แทนที่ทั้งชุดด้วยประวัติที่สัมพันธ์กัน
-- (ทำก่อนเปิด replica mode เพื่อให้ FK ON DELETE CASCADE ทำงาน)
DELETE FROM audit_log a
 USING booking b
 WHERE b.note = 'seed history'
   AND a.entity_type = 'booking' AND a.entity_id = b.booking_id::text;
DELETE FROM booking WHERE note = 'seed history';

-- ข้าม trigger ระหว่าง bulk load: trigger กันจองซ้อน (BR-5) จะไล่ทุกแถวของห้องนั้นต่อ
-- 1 แถวที่ insert (O(n^2)) และ trigger audit จะประทับเวลา now() ให้การจองปี 2000
-- -> 07_verify.sql ตรวจกฎเดียวกันแบบ set-based (เข้มกว่า) พร้อม FK ทุกเส้นก่อน COMMIT
SET LOCAL session_replication_role = replica;

-- ---- helper (อยู่ใน pg_temp - หายไปเองเมื่อจบ session) -------------
-- สุ่มแบบกำหนดได้: ค่าเดิมทุกครั้งสำหรับ (k, salt, seed) เดิม ไม่ขึ้นกับลำดับการประมวลผล
CREATE FUNCTION pg_temp.rnd(k bigint, salt int) RETURNS float8
LANGUAGE sql STABLE AS $$
    SELECT (hashint8extended(k, salt::bigint * 1000003
                                + current_setting('hist.seed')::bigint)
            & 2147483647)::float8 / 2147483648.0
$$;
-- วันที่ + นาทีนับจากเที่ยงคืน ตามเวลากรุงเทพฯ
CREATE FUNCTION pg_temp.bkk(d date, mins int) RETURNS timestamptz
LANGUAGE sql IMMUTABLE AS $$
    SELECT (d + make_interval(mins => mins))::timestamp AT TIME ZONE 'Asia/Bangkok'
$$;
-- ปัดราคาให้ลงหลักสิบ
CREATE FUNCTION pg_temp.r10(x numeric) RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$ SELECT round(x / 10) * 10 $$;

CREATE TEMP TABLE h_param AS
SELECT DATE '2000-01-01'                          AS d0,
       DATE '2026-12-31'                          AS d1,
       now()                                      AS t_now,
       (now() AT TIME ZONE 'Asia/Bangkok')::date  AS today,
       (SELECT max(customer_id) FROM customer)    AS cust_base,
       (SELECT max(booking_id)  FROM booking)     AS booking_base,
       (SELECT staff_id FROM staff WHERE email = 'online@tiggeroriental.com') AS online_id,
       -- id สูงสุดก่อนนำเข้า: แถวที่ id มากกว่านี้คือประวัติที่สคริปต์นี้สร้าง (ใช้ตอนตรวจ)
       (SELECT COALESCE(max(booking_room_id), 0)    FROM booking_room)       AS br_base,
       (SELECT COALESCE(max(booking_service_id), 0) FROM booking_service)    AS bs_base,
       (SELECT COALESCE(max(payment_id), 0)         FROM payment)            AS pay_base,
       (SELECT COALESCE(max(invoice_id), 0)         FROM invoice)            AS inv_base,
       (SELECT COALESCE(max(review_id), 0)          FROM review)             AS review_base,
       (SELECT COALESCE(max(task_id), 0)            FROM housekeeping_task)  AS task_base,
       (SELECT COALESCE(max(ticket_id), 0)          FROM maintenance_ticket) AS ticket_base,
       (SELECT COALESCE(max(log_id), 0)             FROM room_status_log)    AS log_base,
       (SELECT COALESCE(max(audit_id), 0)           FROM audit_log)          AS audit_base;

-- ---- ห้อง -------------------------------------------------------------
CREATE TEMP TABLE h_room AS
SELECT r.room_id, r.room_number, r.floor, r.room_type_id, rt.name AS type_name,
       rt.max_occupancy AS cap
FROM room r JOIN room_type rt USING (room_type_id);

-- ---- พนักงานตามยุค ---------------------------------------------------
-- staff ไม่มีคอลัมน์วันลาออก: อดีตพนักงาน = is_active FALSE และช่วงงานจริงเก็บใน h_staff
-- เพื่อให้ทุกแถวที่อ้างถึงพนักงาน (รับจอง, เช็คอิน/เอาท์, ออกใบกำกับ, ทำความสะอาด,
-- แจ้งซ่อม) เกิดในช่วงที่คนนั้นทำงานอยู่จริง
CREATE TEMP TABLE h_staff_src (
    first_name text, last_name text, email_local text, role text, kind text,
    hired date, left_on date
);
INSERT INTO h_staff_src VALUES
-- ผู้จัดการ / บัญชี
('วิชัย',     'ศรีวงศ์',       'wichai.s',     'manager',      'mgr',  '2000-01-01', '2009-12-31'),
('ประภาพร',   'เกษมสุข',       'praphaporn.k', 'manager',      'mgr',  '2010-01-04', '2024-01-14'),
('สมศรี',     'บุญประเสริฐ',   'somsri.b',     'accounting',   'acct', '2000-01-01', '2011-06-30'),
('อัญชลี',    'วงศ์ใหญ่',       'anchalee.w',   'accounting',   'acct', '2011-07-01', '2024-02-16'),
-- เคาน์เตอร์ 4 ตำแหน่ง (ตำแหน่งที่ 4 ยุบช่วงโควิด แทนด้วยระบบจองออนไลน์ปี 2024)
('สุภาพร',    'แก้วมณี',       'supaporn.k',   'receptionist', 'desk', '2000-01-01', '2006-05-31'),
('ธนากร',     'ใจงาม',         'thanakorn.j',  'receptionist', 'desk', '2006-06-01', '2013-08-31'),
('พิมพ์ชนก',  'รุ่งเรือง',      'pimchanok.r',  'receptionist', 'desk', '2013-09-02', '2019-12-31'),
('ศุภกร',     'นาคสวัสดิ์',     'supakorn.n',   'receptionist', 'desk', '2020-01-06', '2024-02-29'),
('อนุชา',     'พึ่งทอง',        'anucha.p',     'receptionist', 'desk', '2000-01-01', '2004-10-31'),
('วราภรณ์',   'สุขสันต์',       'waraporn.s',   'receptionist', 'desk', '2004-11-01', '2011-03-31'),
('ณัฐวุฒิ',   'ทองดี',         'nattawut.t',   'receptionist', 'desk', '2011-04-01', '2017-07-31'),
('กัญญารัตน์', 'มีสุข',         'kanyarat.m',   'receptionist', 'desk', '2017-08-01', '2025-02-07'),
('จิราพร',    'ศรีสมบูรณ์',     'jiraporn.s',   'receptionist', 'desk', '2000-01-01', '2008-12-31'),
('ปิยะพงษ์',  'เรืองศรี',       'piyapong.r',   'receptionist', 'desk', '2009-01-05', '2015-10-31'),
('ชนิดา',     'อินทรสุวรรณ',    'chanida.i',    'receptionist', 'desk', '2015-11-02', '2021-05-31'),
('ธีรวัฒน์',  'บุญเรือง',       'teerawat.b',   'receptionist', 'desk', '2022-06-01', '2025-06-19'),
('มานพ',      'เจริญผล',       'manop.c',      'receptionist', 'desk', '2000-01-01', '2007-03-31'),
('ศิริพร',    'ดวงแก้ว',       'siriporn.d',   'receptionist', 'desk', '2007-04-02', '2014-12-31'),
('อภิชาติ',   'ชัยมงคล',       'apichat.c',    'receptionist', 'desk', '2015-01-05', '2020-03-31'),
-- แม่บ้าน (8-11 คนในยุคปกติ ราว 1 คนต่อ 12-14 ห้องที่มีแขก, เหลือ 4 คนช่วงโควิด,
-- ปัจจุบัน 11 คนรวม staff 6-7 ของ seed)
('สมพร',      'ใจดี',          'somporn.j',    'housekeeping', 'hk',   '2000-01-01', '2008-06-30'),
('บุญเรือน',  'ทองมา',         'boonruean.t',  'housekeeping', 'hk',   '2000-01-01', '2012-12-31'),
('ละเอียด',   'สีสุข',         'laiad.s',      'housekeeping', 'hk',   '2000-01-01', '2005-09-30'),
('ประยูร',    'แก้วกล้า',       'prayoon.k',    'housekeeping', 'hk',   '2000-01-01', '2010-04-30'),
('สำราญ',     'บุญช่วย',        'samran.b',     'housekeeping', 'hk',   '2000-01-01', '2015-03-31'),
('จันทร์เพ็ญ', 'อ่อนละมัย',     'chanphen.o',   'housekeeping', 'hk',   '2000-01-01', '2003-12-31'),
('ทองใบ',     'ศรีจันทร์',      'thongbai.s',   'housekeeping', 'hk',   '2004-01-05', '2011-08-31'),
('ยุพิน',     'พรหมสุวรรณ',     'yupin.p',      'housekeeping', 'hk',   '2005-10-03', '2016-06-30'),
('สายสุนีย์', 'รักษ์ดี',        'saisunee.r',   'housekeeping', 'hk',   '2006-02-01', '2014-05-31'),
('สมหมาย',    'ดีประเสริฐ',     'sommai.d',     'housekeeping', 'hk',   '2008-07-01', '2020-03-31'),
('นงลักษณ์',  'จันทร์หอม',      'nongluck.c',   'housekeeping', 'hk',   '2010-05-03', '2019-11-30'),
('ประนอม',    'ศักดิ์ดี',        'pranom.s',     'housekeeping', 'hk',   '2011-09-01', '2020-03-31'),
('วันเพ็ญ',   'มากมูล',        'wanphen.m',    'housekeeping', 'hk',   '2013-01-07', '2020-04-30'),
('บุญชู',     'ทองสุข',        'boonchu.t',    'housekeeping', 'hk',   '2014-06-02', '2019-09-30'),
('สุนทร',     'เพชรรัตน์',      'sunthorn.p',   'housekeeping', 'hk',   '2015-04-01', NULL),
('อรุณี',     'ชัยวงศ์',        'arunee.c',     'housekeeping', 'hk',   '2016-07-01', '2021-12-31'),
('ศรีไพร',    'คงสุข',         'sriprai.k',    'housekeeping', 'hk',   '2019-12-02', NULL),
('มยุรี',     'บุญมาก',        'mayuree.b',    'housekeeping', 'hk',   '2022-01-10', NULL),
('ไพโรจน์',   'แสงจันทร์',      'pairoj.s',     'housekeeping', 'hk',   '2022-06-01', NULL),
('กาญจนา',    'พรมดี',         'kanchana.p',   'housekeeping', 'hk',   '2022-09-01', NULL),
('วิไลวรรณ',  'ทองคำ',         'wilaiwan.t',   'housekeeping', 'hk',   '2022-11-01', NULL),
('รัตนา',     'สุขใจ',         'rattana.s',    'housekeeping', 'hk',   '2000-01-01', '2009-02-28'),
('สุดา',      'แก้วใส',        'suda.k',       'housekeeping', 'hk',   '2000-01-01', '2006-11-30'),
('ปราณี',     'ทองอยู่',        'pranee.t',     'housekeeping', 'hk',   '2003-02-03', '2013-10-31'),
('บัวผัน',    'ศรีเมือง',       'buaphan.s',    'housekeeping', 'hk',   '2006-12-01', '2017-05-31'),
('ลำดวน',     'พรมสุข',        'lamduan.p',    'housekeeping', 'hk',   '2009-03-02', '2020-03-31'),
('อุไร',      'จันทร์แก้ว',     'urai.c',       'housekeeping', 'hk',   '2013-11-01', '2020-04-30'),
('ทองสุข',    'มีชัย',          'thongsuk.m',   'housekeeping', 'hk',   '2014-06-02', '2020-03-31'),
('สมจิตร',    'วงศ์ดี',         'somjit.w',     'housekeeping', 'hk',   '2017-06-01', NULL),
('นิภา',      'แสงสว่าง',       'nipha.s',      'housekeeping', 'hk',   '2023-01-09', NULL),
('จำเนียร',   'บุญยืน',         'chamnian.b',   'housekeeping', 'hk',   '2024-02-01', NULL),
-- ช่างซ่อมบำรุง (สังกัดฝ่ายแม่บ้าน/อาคาร) - ปี 2024 ย้ายงานไปผู้ดูแลระบบอาคาร (staff 9)
('สมศักดิ์',  'มั่นคง',         'somsak.m',     'housekeeping', 'tech', '2000-01-01', '2012-08-31'),
('ประเสริฐ',  'ดีงาม',         'prasert.d',    'housekeeping', 'tech', '2005-03-01', '2018-12-31'),
('วีระ',      'ชาญช่าง',       'weera.c',      'housekeeping', 'tech', '2012-09-03', '2024-01-05'),
('อำนาจ',     'สายทอง',        'amnat.s',      'housekeeping', 'tech', '2019-01-07', '2024-01-05');

CREATE TEMP TABLE h_staff (
    staff_id int PRIMARY KEY, role text, kind text, start_d date, stop_d date,
    label text, user_id int, is_new boolean
);

WITH ins AS (
    INSERT INTO staff (first_name, last_name, email, phone, role, hired_at, is_active)
    SELECT s.first_name, s.last_name, s.email_local || '@hotel.local',
           '09' || lpad((abs(hashtext(s.email_local)) % 100000000)::text, 8, '0'),
           s.role, s.hired, s.left_on IS NULL
    FROM h_staff_src s
    ORDER BY s.hired, s.email_local
    RETURNING staff_id, email
)
INSERT INTO h_staff (staff_id, role, kind, start_d, stop_d, label, user_id, is_new)
SELECT ins.staff_id, s.role, s.kind, s.hired, COALESCE(s.left_on, DATE '9999-12-31'),
       s.email_local, NULL, TRUE
FROM ins JOIN h_staff_src s ON s.email_local || '@hotel.local' = ins.email;

-- พนักงานเดิมจาก seed: ใช้ username ถ้ามีบัญชี ไม่มีก็ใช้ชื่อหน้าอีเมล (actor_label)
INSERT INTO h_staff (staff_id, role, kind, start_d, stop_d, label, user_id, is_new)
SELECT st.staff_id, st.role,
       CASE WHEN st.email = 'online@tiggeroriental.com' THEN 'online'
            WHEN st.role = 'receptionist' THEN 'desk'
            WHEN st.role = 'housekeeping' THEN 'hk'
            WHEN st.role = 'manager'      THEN 'mgr'
            WHEN st.role = 'accounting'   THEN 'acct'
            ELSE 'tech' END,                                -- admin = ผู้ดูแลระบบ/อาคาร
       st.hired_at, DATE '9999-12-31',
       COALESCE(u.username, split_part(st.email, '@', 1)), u.user_id, FALSE
FROM staff st
LEFT JOIN app_user u ON u.staff_id = st.staff_id
WHERE st.staff_id NOT IN (SELECT staff_id FROM h_staff);

-- รายชื่อคนที่อยู่เวรในแต่ละวัน (ใช้เลือกคนแบบ set-based)
CREATE TEMP TABLE h_roster AS
SELECT d::date AS d, s.kind,
       array_agg(s.staff_id ORDER BY s.staff_id) AS ids
FROM generate_series(DATE '2000-01-01', DATE '2026-12-31', INTERVAL '1 day') AS d
JOIN h_staff s ON d::date BETWEEN s.start_d AND s.stop_d
GROUP BY d::date, s.kind;
CREATE INDEX ON h_roster (kind, d);

DO $$
DECLARE gap int;
BEGIN
    SELECT count(*) INTO gap
    FROM generate_series(DATE '2000-01-01', DATE '2026-12-31', INTERVAL '1 day') d
    CROSS JOIN (VALUES ('desk'), ('hk'), ('mgr'), ('tech')) k(kind)
    WHERE NOT EXISTS (SELECT 1 FROM h_roster r WHERE r.d = d::date AND r.kind = k.kind);
    IF gap > 0 THEN
        RAISE EXCEPTION 'staff roster has % uncovered day/role slots', gap;
    END IF;
END $$;

-- ---- rate plan รายปี 2000-2025 --------------------------------------
-- ปี 2026 ใช้ราคาตั้งต้น + rate plan ของ seed ตามเดิม; ย้อนหลังใช้ดัชนีราคาตามปี
-- (ต่ำช่วงวิกฤต 2009-2010 และโควิด 2020-2022) ทุกคืนในอดีตจึง quote ได้ด้วย fn_quote_room
CREATE TEMP TABLE h_year_factor (y int PRIMARY KEY, f numeric);
INSERT INTO h_year_factor
SELECT 1999 + i, f
FROM unnest(ARRAY[0.56,0.57,0.58,0.59,0.61,0.62,0.64,0.66,0.68,0.67,0.67,0.70,0.73,
                  0.76,0.76,0.78,0.81,0.84,0.87,0.89,0.82,0.74,0.80,0.88,0.94,0.97,
                  1.00]::numeric[]) WITH ORDINALITY AS t(f, i);

CREATE TEMP TABLE h_rate_plan_new (rate_plan_id int);
WITH ins AS (
    INSERT INTO rate_plan (room_type_id, name, kind, price_per_night, valid_from, valid_to,
                           applies_weekday, applies_weekend, priority, is_active)
    SELECT p.room_type_id, p.name, p.kind, p.price, p.vf, p.vt, p.wd, p.we, p.prio, TRUE
    FROM (
        SELECT rt.room_type_id, 'Rack rate ' || yf.y AS name, 'seasonal' AS kind,
               pg_temp.r10(rt.base_price_per_night * yf.f) AS price,
               make_date(yf.y, 1, 1) AS vf, make_date(yf.y, 12, 31) AS vt,
               TRUE AS wd, TRUE AS we, 5 AS prio, 1 AS ord
        FROM room_type rt, h_year_factor yf WHERE yf.y <= 2025
        UNION ALL
        SELECT rt.room_type_id, 'Weekend ' || yf.y, 'weekend',
               pg_temp.r10(rt.base_price_per_night * yf.f * 1.16),
               make_date(yf.y, 1, 1), make_date(yf.y, 12, 31), FALSE, TRUE, 10, 2
        FROM room_type rt, h_year_factor yf WHERE yf.y <= 2025
        UNION ALL
        SELECT rt.room_type_id, 'High season NY ' || yf.y, 'seasonal',
               pg_temp.r10(rt.base_price_per_night * yf.f * 1.45),
               make_date(yf.y, 12, 20), make_date(yf.y + 1, 1, 5), TRUE, TRUE, 50, 3
        FROM room_type rt, h_year_factor yf
        WHERE yf.y <= 2025 AND rt.room_type_id IN (1, 3, 5)
    ) p
    ORDER BY p.vf, p.ord, p.room_type_id
    RETURNING rate_plan_id
)
INSERT INTO h_rate_plan_new SELECT rate_plan_id FROM ins;

-- ราคาต่อคืนของทุกประเภทห้อง ทุกวัน - คำนวณด้วย fn_quote_room ของ schema เอง
CREATE TEMP TABLE h_price AS
SELECT rt.room_type_id, d::date AS d, fn_quote_room(rt.room_type_id, d::date) AS price
FROM room_type rt
CROSS JOIN generate_series(DATE '2000-01-01', DATE '2026-12-31', INTERVAL '1 day') AS d;
CREATE UNIQUE INDEX ON h_price (room_type_id, d);

-- ---- ช่วงที่ห้องขายไม่ได้ (คืน [d_from, d_to)) ---------------------
CREATE TEMP TABLE h_block (room_id int, d_from date, d_to date, why text);
-- การจองที่มีอยู่แล้วทุกสถานะ (ข้อมูลตั้งต้นของ seed / ที่สร้างผ่านแอป)
INSERT INTO h_block
SELECT br.room_id, b.check_in_date, b.check_out_date, 'booking #' || b.booking_id
FROM booking b JOIN booking_room br USING (booking_id);
-- งานซ่อมเดิมที่ปิดห้อง (ห้องยังเป็น maintenance อยู่ = ปิดยาวไปจนสิ้นช่วง)
INSERT INTO h_block
SELECT t.room_id, t.created_at::date,
       CASE WHEN t.resolved_at IS NOT NULL THEN GREATEST(t.resolved_at::date, t.created_at::date + 1)
            WHEN r.status = 'maintenance' THEN DATE '2027-01-01'
            ELSE t.created_at::date + 1 END,
       'ticket #' || t.ticket_id
FROM maintenance_ticket t JOIN room r USING (room_id);
INSERT INTO h_block
SELECT l.room_id, l.changed_at::date,
       COALESCE((SELECT min(l2.changed_at)::date + 1 FROM room_status_log l2
                  WHERE l2.room_id = l.room_id AND l2.changed_at > l.changed_at
                    AND l2.old_status = 'maintenance'), DATE '2027-01-01'),
       'status log #' || l.log_id
FROM room_status_log l
WHERE l.new_status = 'maintenance';
-- ปิดโรงแรมชั่วคราวช่วงโควิดระลอกแรก
INSERT INTO h_block
SELECT room_id, DATE '2020-04-01', DATE '2020-07-01', 'covid closure' FROM room;

-- ---- ความต้องการห้องรายวัน (จำนวนคำขอจองที่ "มาถึง" วันนั้น) -------
-- อัตราเข้าพักพื้นฐานรายปี x ฤดูกาล x วันในสัปดาห์ x เหตุการณ์จริงในกรุงเทพฯ x วันหยุดยาว
CREATE TEMP TABLE h_event (d_from date, d_to date, f float8, why text);
INSERT INTO h_event VALUES
('2003-03-15', '2003-06-30', 0.70, 'SARS'),
('2004-12-26', '2005-03-31', 0.85, 'tsunami'),
('2006-09-19', '2006-10-15', 0.90, 'coup'),
('2008-11-25', '2008-12-15', 0.30, 'airport closure'),
('2010-03-14', '2010-05-31', 0.35, 'Ratchaprasong protests'),
('2011-10-10', '2011-12-15', 0.60, 'floods'),
('2013-11-25', '2014-03-15', 0.65, 'Bangkok shutdown'),
('2014-05-22', '2014-07-31', 0.75, 'curfew'),
('2015-08-17', '2015-09-15', 0.80, 'Erawan shrine bombing'),
('2016-10-13', '2016-11-30', 0.90, 'mourning period'),
('2020-01-25', '2020-03-31', 0.45, 'covid-19 onset'),
('2020-04-01', '2020-06-30', 0.00, 'hotel closed'),
('2020-07-01', '2020-12-31', 0.25, 'borders closed');

CREATE TEMP TABLE h_day AS
WITH base AS (
    SELECT d::date AS d,
           (ARRAY[.60,.62,.65,.66,.69,.68,.71,.73,.72,.66,.70,.72,.76,.79,.75,.77,.79,
                  .81,.83,.82,.80,.12,.50,.70,.76,.78,.79])[extract(year FROM d)::int - 1999]
               AS occ,
           (ARRAY[1.15,1.12,1.05,0.97,0.86,0.84,0.93,0.95,0.83,0.96,1.10,1.22])
               [extract(month FROM d)::int] AS mf,
           (ARRAY[0.95,0.90,0.92,1.00,1.22,1.08,0.93])[extract(isodow FROM d)::int] AS df
    FROM generate_series(DATE '2000-01-01', DATE '2026-12-30', INTERVAL '1 day') AS d
)
SELECT (b.d - DATE '2000-01-01') AS di, b.d,
       155.0
       * CASE WHEN extract(year FROM b.d) = 2022      -- เปิดประเทศ: ฟื้นตัวทีละเดือน
              THEN 0.25 + 0.50 * (extract(month FROM b.d) - 1) / 11.0 ELSE b.occ END
       * b.mf * b.df
       * COALESCE((SELECT min(e.f) FROM h_event e WHERE b.d BETWEEN e.d_from AND e.d_to), 1.0)
       * CASE WHEN to_char(b.d, 'MM-DD') >= '12-28' OR to_char(b.d, 'MM-DD') <= '01-02' THEN 1.25
              WHEN to_char(b.d, 'MM-DD') BETWEEN '04-11' AND '04-16' THEN 1.20
              ELSE 1.0 END
       * current_setting('hist.scale')::float8
       * 1.18                   -- ชดเชยคำขอที่ยกเลิก / ห้องเต็ม
       / (3.0 * 1.12)           -- คืนเฉลี่ยต่อการจอง x ห้องเฉลี่ยต่อการจอง
       AS lam
FROM base b;

SELECT (SELECT count(*) FROM h_staff WHERE is_new)   AS staff_added,
       (SELECT count(*) FROM h_rate_plan_new)        AS rate_plans_added,
       (SELECT round(sum(lam)) FROM h_day)           AS expected_requests;
