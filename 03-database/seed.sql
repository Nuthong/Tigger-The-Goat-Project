-- =====================================================================
--  310-2209 Database Systems -- Mini-DB Group Project
--  ระบบจองห้องพัก / Room Booking System
--  seed.sql : ข้อมูลตัวอย่างสำหรับทดสอบ query
--  ต้องรัน schema.sql ก่อน
--  วิธีรัน   : psql -U postgres -d roombooking -f seed.sql
--  หมายเหตุ : id ทุกตารางเป็น SERIAL -> ใส่ตามลำดับ INSERT จะได้ 1..N
--             อ้างอิงวันที่ "ปัจจุบัน" สมมติ = 2026-09-07
-- =====================================================================

-- ล้างข้อมูลเดิม (คงโครงสร้างไว้) + รีเซ็ตลำดับ id
TRUNCATE audit_log, maintenance_ticket, housekeeping_task, invoice_line, invoice,
         rate_plan, auth_event, app_user, room_status_log, review, payment,
         booking_service, booking_room, booking, service, room, room_type,
         staff, customer
RESTART IDENTITY CASCADE;

-- ---------------------------------------------------------------------
--  room_type (1..5)
-- ---------------------------------------------------------------------
INSERT INTO room_type (name, description, base_price_per_night, max_occupancy) VALUES
('Cityview Room',         'ห้องพักใจกลางเมือง เตียงเดี่ยวหรือคู่ วิวตัวเมือง',                900.00, 2),
('Parkview Room',         'กว้างขึ้น มีมุมนั่งเล่น วิวสวนลุมพินี',                          1300.00, 2),
('Premier Skyline Room',  'ห้องมุม วิวเส้นขอบฟ้าพาโนรามา เตียง King พร้อมสิทธิ์เลานจ์',      1800.00, 3),
('Skyline Residence',     'สองห้องนอน ห้องนั่งเล่นแยก วิวเมือง เหมาะกับครอบครัว',           2500.00, 4),
('Oriental Suite',        'ห้องชุดพร้อมห้องนั่งเล่นแยก อ่างอาบน้ำ วิวเมืองพาโนรามา',          3800.00, 2);

-- ---------------------------------------------------------------------
--  room (1..155)  -- 155 ห้องพัก 9 ชั้น (ตรงกับที่หน้าเว็บเคลมไว้)
--    id 1..16 = ห้องที่ booking/housekeeping/maintenance ตัวอย่างอ้างถึง — ห้ามขยับ
--    id 17..155 = เติมให้ครบ ด้วย generate_series ด้านล่าง
-- ---------------------------------------------------------------------
INSERT INTO room (room_number, floor, room_type_id, status, note) VALUES
('101', 1, 1, 'available',   NULL),
('102', 1, 1, 'available',   NULL),
('103', 1, 1, 'available',   NULL),
('104', 1, 2, 'available',   NULL),
('201', 2, 2, 'available',   NULL),
('202', 2, 2, 'available',   NULL),
('203', 2, 3, 'available',   NULL),
('204', 2, 3, 'available',   NULL),
('301', 3, 3, 'available',   NULL),
('302', 3, 4, 'available',   NULL),
('303', 3, 4, 'available',   NULL),
('304', 3, 5, 'available',   NULL),
('401', 4, 5, 'available',   NULL),
('402', 4, 3, 'available',   NULL),
('403', 4, 2, 'available',   NULL),
('404', 4, 1, 'maintenance', 'ซ่อมเครื่องปรับอากาศ');

-- เติมห้องที่เหลือให้ครบ 155 ห้อง กระจาย 9 ชั้น (ชั้น 1–4 มี 17 ห้อง/ชั้น, ชั้น 5–8 มี 17,
-- ชั้น 9 มี 19) : 16 + 139 = 155. เลขห้อง = <ชั้น><ลำดับ 2 หลัก> เช่น 105, 512, 919
INSERT INTO room (room_number, floor, room_type_id, status)
SELECT
    g.f::text || lpad(n::text, 2, '0'),
    g.f,
    CASE
        WHEN g.f >= 8 AND n >= 15 THEN 5   -- Oriental Suite — ชั้นบนสุด
        WHEN g.f >= 6 AND n >= 15 THEN 4   -- Skyline Residence — ชั้นสูง
        WHEN n % 4 = 3               THEN 3   -- Premier Skyline (~25%)
        WHEN n % 2 = 0               THEN 2   -- Parkview (~ครึ่ง)
        ELSE 1                                -- Cityview (ที่เหลือ)
    END,
    'available'
FROM (VALUES (1,5,17),(2,5,17),(3,5,17),(4,5,17),
             (5,1,17),(6,1,17),(7,1,17),(8,1,17),(9,1,19)) AS g(f, nlo, nhi)
CROSS JOIN LATERAL generate_series(g.nlo, g.nhi) AS n;

-- ---------------------------------------------------------------------
--  customer (1..12)  -- 11,12 ยังไม่เคยจอง (ไว้ทดสอบ anti-join)
-- ---------------------------------------------------------------------
INSERT INTO customer (first_name, last_name, email, phone, id_card_no, created_at) VALUES
('สมชาย',  'ใจดี',        'somchai.j@example.com',  '0811110001', '1100701234567', '2026-06-01 10:00+07'),
('Anna',   'Schmidt',     'anna.s@example.com',     '0811110002', 'P1234567',       '2026-06-15 09:20+07'),
('มาลี',   'ดอกไม้',      'malee.d@example.com',    '0811110003', '1100701234568', '2026-07-02 14:05+07'),
('John',   'Carter',      'john.c@example.com',     '0811110004', 'P7654321',       '2026-07-10 11:30+07'),
('วิเชียร', 'แสงทอง',      'wichian.s@example.com',  '0811110005', '1100701234569', '2026-07-18 16:45+07'),
('ปรียา',  'ทองแท้',      'preeya.t@example.com',   '0811110006', '1100701234570', '2026-08-01 08:15+07'),
('Kenji',  'Tanaka',      'kenji.t@example.com',    '0811110007', 'JP998877',       '2026-08-09 19:00+07'),
('อรทัย',  'พูนผล',       'orathai.p@example.com',  '0811110008', '1100701234571', '2026-08-20 13:40+07'),
('เอกพงษ์', 'มั่นคง',      'ekkapong.m@example.com', '0811110009', '1100701234572', '2026-08-28 10:10+07'),
('Sarah',  'Wilson',      'sarah.w@example.com',    '0811110010', 'P5551212',       '2026-09-02 12:00+07'),
('ธนพล',   'แซ่เฬิน',      'thanaphon.s@example.com','0811110011', '1100701234573', '2026-09-05 09:00+07'),
('Laura',  'Meyer',       'laura.m@example.com',    '0811110012', 'P4443331',       '2026-09-06 18:30+07');

-- ---------------------------------------------------------------------
--  staff (1..9)  -- 1 ผู้จัดการ, 2..4 เคาน์เตอร์, 5 ระบบจองออนไลน์,
--                   6..7 แม่บ้าน, 8 บัญชี, 9 ผู้ดูแลระบบ
-- ---------------------------------------------------------------------
INSERT INTO staff (first_name, last_name, email, phone, role, hired_at, is_active) VALUES
('กมล',    'ดีเยี่ยงอย่าง', 'kamol.d@hotel.local',   '0900000001', 'manager',      '2024-01-15', TRUE),
('นรภร',   'มุตติศานต์',    'noraphon.m@hotel.local','0900000002', 'receptionist', '2024-03-01', TRUE),
('ชีวาวิชญ์', 'หนูทอง',      'chiwawit.n@hotel.local','0900000003', 'receptionist', '2025-02-10', TRUE),
('นฤชิต',  'บุญยัง',        'naruchit.b@hotel.local','0900000004', 'receptionist', '2025-06-20', TRUE),
('Online', 'Reservations',  'online@tiggeroriental.com','0000000000','receptionist','2024-01-01', TRUE),
-- 6..9 : ทีมแม่บ้าน / บัญชี / ผู้ดูแลระบบ
('สายฝน',  'พรมมา',         'saifon.p@hotel.local',  '0900000006', 'housekeeping', '2024-05-02', TRUE),
('บุญมี',   'ศรีสุข',        'boonmee.s@hotel.local', '0900000007', 'housekeeping', '2025-01-08', TRUE),
('ชลิดา',  'เจริญทรัพย์',   'chalida.c@hotel.local', '0900000008', 'accounting',   '2024-02-19', TRUE),
('ณัฐพล',  'ระบบดี',        'nattapon.r@hotel.local','0900000009', 'admin',        '2024-01-02', TRUE);

-- ---------------------------------------------------------------------
--  service (1..6)
-- ---------------------------------------------------------------------
INSERT INTO service (name, price, description, is_active) VALUES
('Breakfast Buffet', 250.00, 'บุฟเฟต์อาหารเช้า ต่อคนต่อวัน',        TRUE),
('Airport Transfer', 600.00, 'รถรับส่งสนามบิน เที่ยวเดียว',          TRUE),
('Laundry',          150.00, 'ซักรีด ต่อถุง',                        TRUE),
('Extra Bed',        400.00, 'เตียงเสริม ต่อคืน',                    TRUE),
('Late Checkout',    300.00, 'เช็คเอาท์ช้าถึง 16:00 น.',             TRUE),
('Mini Bar',         200.00, 'เครื่องดื่ม/ขนม ในตู้เย็น',            TRUE);

-- ---------------------------------------------------------------------
--  app_user (1..10)  -- บัญชีทดสอบเท่านั้น
--  รหัสผ่านทุกบัญชี = "Passw0rd!2026"  (เก็บเป็น bcrypt ผ่าน pgcrypto, ไม่มี plaintext ใน DB)
--  ตรวจรหัสตอน login:  SELECT (password_hash = crypt('<input>', password_hash)) FROM app_user WHERE username = '<u>';
-- ---------------------------------------------------------------------
INSERT INTO app_user (username, email, password_hash, role, customer_id, staff_id) VALUES
('manager01', 'kamol.d@hotel.local',    crypt('Passw0rd!2026', gen_salt('bf', 12)), 'manager',      NULL, 1),
('recep01',   'noraphon.m@hotel.local', crypt('Passw0rd!2026', gen_salt('bf', 12)), 'receptionist', NULL, 2),
('recep02',   'chiwawit.n@hotel.local', crypt('Passw0rd!2026', gen_salt('bf', 12)), 'receptionist', NULL, 3),
('somchai',   'somchai.j@example.com',  crypt('Passw0rd!2026', gen_salt('bf', 12)), 'customer',      1,   NULL),
('anna',      'anna.s@example.com',     crypt('Passw0rd!2026', gen_salt('bf', 12)), 'customer',      2,   NULL),
('malee',     'malee.d@example.com',    crypt('Passw0rd!2026', gen_salt('bf', 12)), 'customer',      3,   NULL),
-- 7..10 : แม่บ้าน / บัญชี / ผู้ดูแลระบบ
('house01',   'saifon.p@hotel.local',   crypt('Passw0rd!2026', gen_salt('bf', 12)), 'housekeeping', NULL, 6),
('house02',   'boonmee.s@hotel.local',  crypt('Passw0rd!2026', gen_salt('bf', 12)), 'housekeeping', NULL, 7),
('acct01',    'chalida.c@hotel.local',  crypt('Passw0rd!2026', gen_salt('bf', 12)), 'accounting',   NULL, 8),
('admin01',   'nattapon.r@hotel.local', crypt('Passw0rd!2026', gen_salt('bf', 12)), 'admin',        NULL, 9);

-- ---------------------------------------------------------------------
--  auth_event  -- ตัวอย่าง audit log (login สำเร็จ/ล้มเหลว/ล็อก/logout)
-- ---------------------------------------------------------------------
INSERT INTO auth_event (user_id, username_tried, event_type, ip_address, user_agent, created_at) VALUES
(1,    'manager01', 'login_success', '203.0.113.10',   'Mozilla/5.0 (Macintosh)',      '2026-09-06 08:05+07'),
(1,    'manager01', 'logout',        '203.0.113.10',   'Mozilla/5.0 (Macintosh)',      '2026-09-06 12:30+07'),
(4,    'somchai',   'login_success', '198.51.100.22',  'Mozilla/5.0 (Windows NT 10.0)','2026-09-06 19:20+07'),
(NULL, 'somchai',   'login_fail',    '198.51.100.99',  'curl/8.4.0',                   '2026-09-07 02:11+07'),
(NULL, 'somchai',   'login_fail',    '198.51.100.99',  'curl/8.4.0',                   '2026-09-07 02:11+07'),
(4,    'somchai',   'locked',        '198.51.100.99',  'curl/8.4.0',                   '2026-09-07 02:12+07');

-- ---------------------------------------------------------------------
--  booking (1..14)  -- ต้อง INSERT ก่อน booking_room (trigger อ่านวันที่จากตารางนี้)
--  สถานะ: checked_out(1-4), cancelled(5,14), checked_in(6-8), confirmed(9,10,12), pending(11,13)
-- ---------------------------------------------------------------------
INSERT INTO booking (customer_id, staff_id, booking_date, check_in_date, check_out_date, num_guests, status, note) VALUES
( 1, 2, '2026-07-20 10:30+07', '2026-08-01', '2026-08-04', 2, 'checked_out', NULL),
( 2, 2, '2026-07-25 15:00+07', '2026-08-05', '2026-08-08', 3, 'checked_out', 'ขอห้องติดกัน'),
( 3, 3, '2026-08-01 09:10+07', '2026-08-10', '2026-08-12', 1, 'checked_out', NULL),
( 4, 2, '2026-08-10 18:20+07', '2026-08-20', '2026-08-25', 4, 'checked_out', 'มากับเด็ก 2 คน'),
( 5, 3, '2026-08-15 11:00+07', '2026-08-22', '2026-08-24', 2, 'cancelled',   'ลูกค้ายกเลิกเอง'),
( 1, 4, '2026-08-28 20:05+07', '2026-09-05', '2026-09-09', 2, 'checked_in',  NULL),
( 6, 2, '2026-08-30 13:15+07', '2026-09-06', '2026-09-10', 2, 'checked_in',  NULL),
( 7, 3, '2026-09-01 08:40+07', '2026-09-06', '2026-09-08', 3, 'checked_in',  'เดินทางเป็นกลุ่ม'),
( 8, 4, '2026-09-02 17:30+07', '2026-09-15', '2026-09-18', 2, 'confirmed',   NULL),
( 9, 2, '2026-09-03 10:00+07', '2026-09-20', '2026-09-25', 4, 'confirmed',   'ฉลองครบรอบ'),
(10, 3, '2026-09-04 14:25+07', '2026-10-01', '2026-10-05', 2, 'pending',     'รอโอนมัดจำ'),
( 2, 4, '2026-09-05 09:50+07', '2026-10-10', '2026-10-12', 1, 'confirmed',   NULL),
( 3, 2, '2026-09-06 19:10+07', '2026-12-24', '2026-12-28', 2, 'pending',     'ช่วงปีใหม่ รอยืนยันราคา'),
( 4, 3, '2026-09-06 21:00+07', '2026-11-01', '2026-11-03', 2, 'cancelled',   'เปลี่ยนแผนเดินทาง');

-- ---------------------------------------------------------------------
--  booking_room  -- ราคา/คืน = สำเนา ณ เวลาจอง (BR-6)
--  หมายเหตุ: booking ที่ยัง active (pending/confirmed/checked_in) ห้ามใช้ห้องซ้อนช่วงวัน
-- ---------------------------------------------------------------------
INSERT INTO booking_room (booking_id, room_id, price_per_night) VALUES
( 1,  1,  850.00),                       -- B1: ห้อง 101 (ราคาเก่า 850)
( 2,  2,  900.00), ( 2,  3,  900.00),    -- B2: ห้อง 102,103
( 3,  5, 1300.00),                       -- B3: ห้อง 201
( 4, 10, 2500.00), ( 4, 11, 2500.00),    -- B4: ห้อง 302,303 (Skyline Residence x2)
( 5,  9, 1800.00),                       -- B5: ห้อง 301 (ยกเลิก)
( 6,  7, 1800.00),                       -- B6: ห้อง 203 (checked_in)
( 7,  8, 1800.00),                       -- B7: ห้อง 204 (checked_in)
( 8,  9, 1800.00),                       -- B8: ห้อง 301 (checked_in)
( 9,  7, 1800.00),                       -- B9: ห้อง 203 (คนละช่วงกับ B6)
(10, 10, 2500.00), (10, 11, 2500.00),    -- B10: ห้อง 302,303
(11,  7, 1900.00),                       -- B11: ห้อง 203 (ราคาปรับขึ้น 1900)
(12,  1,  900.00),                       -- B12: ห้อง 101
(13, 12, 4200.00),                       -- B13: ห้อง 304 (Oriental Suite ช่วงปีใหม่ 4200)
(14,  7, 1800.00);                       -- B14: ห้อง 203 (ยกเลิก)

-- ---------------------------------------------------------------------
--  booking_service  -- unit_price = สำเนา ณ เวลาจอง
-- ---------------------------------------------------------------------
INSERT INTO booking_service (booking_id, service_id, quantity, unit_price) VALUES
( 1, 1, 2, 250.00),
( 2, 1, 3, 250.00), ( 2, 3, 1, 150.00),
( 4, 2, 1, 600.00), ( 4, 4, 1, 400.00),
( 6, 1, 2, 250.00),
( 7, 1, 2, 250.00), ( 7, 6, 1, 200.00),
(10, 1, 4, 250.00), (10, 4, 1, 400.00),
(13, 2, 1, 600.00);

-- ---------------------------------------------------------------------
--  payment
-- ---------------------------------------------------------------------
INSERT INTO payment (booking_id, amount, method, status, paid_at, reference_no) VALUES
( 1,  3050.00, 'cash',          'paid',     '2026-08-04 11:00+07', 'RCPT-0001'),
( 2,  6300.00, 'bank_transfer', 'paid',     '2026-08-05 09:00+07', 'TRF-88213'),
( 3,  2600.00, 'promptpay',     'paid',     '2026-08-10 15:30+07', 'PP-55019'),
( 4, 26000.00, 'credit_card',   'paid',     '2026-08-25 12:15+07', 'CC-771002'),
( 5,  1000.00, 'promptpay',     'refunded', '2026-08-18 10:00+07', 'PP-55020'),
( 6,  2000.00, 'promptpay',     'paid',     '2026-08-28 20:30+07', 'PP-55031'),   -- มัดจำ B6
( 7,  3000.00, 'cash',          'pending',  NULL,                   NULL),         -- ยังไม่จ่าย B7
( 8,  3600.00, 'cash',          'paid',     '2026-09-06 16:00+07', 'RCPT-0002'),
( 9,  2000.00, 'promptpay',     'paid',     '2026-09-03 10:30+07', 'PP-55044'),   -- มัดจำ B9
(12,  1700.00, 'promptpay',     'paid',     '2026-09-05 10:00+07', 'PP-55050');

-- ---------------------------------------------------------------------
--  review  -- เฉพาะการจองที่ checked_out (B1..B4)
-- ---------------------------------------------------------------------
INSERT INTO review (booking_id, rating, comment, created_at) VALUES
(1, 5, 'ห้องสะอาด พนักงานบริการดีมาก',              '2026-08-04 12:00+07'),
(2, 4, 'คุ้มราคา แต่แอร์มีเสียงดังเล็กน้อย',         '2026-08-08 10:30+07'),
(3, 3, 'โดยรวมโอเค แต่ Wi-Fi ค่อนข้างช้า',           '2026-08-12 09:00+07'),
(4, 5, 'ห้องแฟมิลี่กว้างมาก เหมาะกับครอบครัว',       '2026-08-25 14:20+07');

-- ---------------------------------------------------------------------
--  room_status_log
-- ---------------------------------------------------------------------
INSERT INTO room_status_log (room_id, changed_by, old_status, new_status, changed_at) VALUES
(16, 1, 'available',   'maintenance', '2026-09-01 09:00+07'),
( 1, 2, 'maintenance', 'available',   '2026-07-15 08:30+07'),
(10, 1, 'available',   'maintenance', '2026-08-26 10:00+07'),
(10, 1, 'maintenance', 'available',   '2026-08-30 15:00+07');

-- ---------------------------------------------------------------------
--  rate_plan  -- ราคาตามฤดูกาล / วันหยุด / โปรโมชั่น
--  priority สูงกว่า = ชนะเมื่อช่วงวันทับกัน (ดู fn_quote_room)
-- ---------------------------------------------------------------------
INSERT INTO rate_plan
    (room_type_id, name, kind, price_per_night, valid_from, valid_to,
     applies_weekday, applies_weekend, priority, is_active) VALUES
-- ราคาวันหยุดสุดสัปดาห์ตลอดปี (+15..20%)
(1, 'Weekend 2026',        'weekend',   1050.00, '2026-01-01', '2026-12-31', FALSE, TRUE,  10, TRUE),
(2, 'Weekend 2026',        'weekend',   1500.00, '2026-01-01', '2026-12-31', FALSE, TRUE,  10, TRUE),
(3, 'Weekend 2026',        'weekend',   2100.00, '2026-01-01', '2026-12-31', FALSE, TRUE,  10, TRUE),
(4, 'Weekend 2026',        'weekend',   2900.00, '2026-01-01', '2026-12-31', FALSE, TRUE,  10, TRUE),
(5, 'Weekend 2026',        'weekend',   4400.00, '2026-01-01', '2026-12-31', FALSE, TRUE,  10, TRUE),
-- ไฮซีซั่นปลายปี ทับทุกวัน และชนะราคาวันหยุด
(1, 'High season NY',      'seasonal',  1400.00, '2026-12-20', '2027-01-05', TRUE,  TRUE,  50, TRUE),
(3, 'High season NY',      'seasonal',  2600.00, '2026-12-20', '2027-01-05', TRUE,  TRUE,  50, TRUE),
(5, 'High season NY',      'seasonal',  5200.00, '2026-12-20', '2027-01-05', TRUE,  TRUE,  50, TRUE),
-- โปรโมชั่นโลว์ซีซั่น เฉพาะวันธรรมดา (ถูกกว่าราคาตั้งต้น)
(2, 'Green season midweek','promotion',  990.00, '2026-06-01', '2026-09-30', TRUE,  FALSE, 20, TRUE),
(4, 'Green season midweek','promotion', 1990.00, '2026-06-01', '2026-09-30', TRUE,  FALSE, 20, TRUE),
-- แผนที่ปิดใช้งานไว้ (ทดสอบว่า is_active ถูกกรองออกจริง)
(5, 'Old 2025 rate',       'seasonal',  3000.00, '2025-01-01', '2025-12-31', TRUE,  TRUE,  99, FALSE);

-- ---------------------------------------------------------------------
--  invoice + invoice_line  -- ออกให้การจองที่ปิดแล้ว (B1..B4)
--  subtotal = ยอดก่อน VAT, total = subtotal + tax_amount  (VAT 7%)
-- ---------------------------------------------------------------------
INSERT INTO invoice
    (booking_id, invoice_no, issued_by, issued_at, status, tax_rate,
     subtotal, tax_amount, total, note) VALUES
(1, 'INV-2026-00001', 8, '2026-08-04 11:05+07', 'paid', 0.0700, 2850.47,  199.53, 3050.00, NULL),
(2, 'INV-2026-00002', 8, '2026-08-08 10:40+07', 'paid', 0.0700, 5887.85,  412.15, 6300.00, NULL),
(3, 'INV-2026-00003', 8, '2026-08-12 09:10+07', 'paid', 0.0700, 2429.91,  170.09, 2600.00, NULL),
(4, 'INV-2026-00004', 8, '2026-08-25 14:30+07', 'paid', 0.0700, 24299.07, 1700.93, 26000.00, 'ครอบครัว 2 ห้อง');

INSERT INTO invoice_line
    (invoice_id, line_no, line_type, description, quantity, unit_price, amount) VALUES
-- INV-1 : ห้อง 101 x 3 คืน + อาหารเช้า x2
(1, 1, 'room',    'Cityview Room (101) · 3 คืน',        3,   850.00,  2550.00),
(1, 2, 'service', 'Breakfast Buffet',                    2,   250.00,   500.00),
-- INV-2 : ห้อง 102,103 x 3 คืน + อาหารเช้า x3 + ซักรีด
(2, 1, 'room',    'Cityview Room (102) · 3 คืน',        3,   900.00,  2700.00),
(2, 2, 'room',    'Cityview Room (103) · 3 คืน',        3,   900.00,  2700.00),
(2, 3, 'service', 'Breakfast Buffet',                    3,   250.00,   750.00),
(2, 4, 'service', 'Laundry',                             1,   150.00,   150.00),
-- INV-3 : ห้อง 201 x 2 คืน
(3, 1, 'room',    'Parkview Room (201) · 2 คืน',        2,  1300.00,  2600.00),
-- INV-4 : ห้อง 302,303 x 5 คืน + รถรับส่ง + เตียงเสริม
(4, 1, 'room',    'Skyline Residence (302) · 5 คืน',    5,  2500.00, 12500.00),
(4, 2, 'room',    'Skyline Residence (303) · 5 คืน',    5,  2500.00, 12500.00),
(4, 3, 'service', 'Airport Transfer',                    1,   600.00,   600.00),
(4, 4, 'service', 'Extra Bed',                           1,   400.00,   400.00),
(4, 5, 'discount','ส่วนลดลูกค้าประจำ',                    1,     0.00,     0.00);

-- ---------------------------------------------------------------------
--  housekeeping_task  -- กระดานงานแม่บ้าน (6,7 = สายฝน, บุญมี)
-- ---------------------------------------------------------------------
INSERT INTO housekeeping_task
    (room_id, booking_id, task_type, status, scheduled_for, assigned_to,
     started_at, completed_at, note) VALUES
-- งานที่ทำเสร็จแล้ว (หลัง check-out ของ B1, B2)
( 1,  1, 'checkout_clean', 'done',        '2026-08-04', 6, '2026-08-04 11:30+07', '2026-08-04 12:10+07', NULL),
( 2,  2, 'checkout_clean', 'done',        '2026-08-08', 7, '2026-08-08 11:00+07', '2026-08-08 11:50+07', NULL),
( 3,  2, 'checkout_clean', 'done',        '2026-08-08', 7, '2026-08-08 12:00+07', '2026-08-08 12:40+07', NULL),
-- งานวันนี้
( 7,  6, 'stayover_clean', 'in_progress', '2026-09-07', 6, '2026-09-07 09:15+07', NULL, 'แขกยังพักอยู่'),
( 9,  NULL, 'deep_clean',  'pending',     '2026-09-07', 7, NULL, NULL, 'ทำความสะอาดใหญ่ประจำเดือน'),
( 4,  NULL, 'inspection',  'pending',     '2026-09-07', NULL, NULL, NULL, 'ตรวจก่อนรับแขก VIP'),
-- งานพรุ่งนี้
(12,  NULL, 'turndown',    'pending',     '2026-09-08', 6, NULL, NULL, NULL),
(16,  NULL, 'deep_clean',  'skipped',     '2026-09-06', 7, NULL, NULL, 'ห้องปิดซ่อม ยังเข้าไม่ได้');

-- ---------------------------------------------------------------------
--  maintenance_ticket  -- งานแจ้งซ่อม
-- ---------------------------------------------------------------------
INSERT INTO maintenance_ticket
    (room_id, reported_by, assigned_to, category, priority, status, title,
     description, created_at, resolved_at, resolution) VALUES
(16, 1, 9, 'hvac',       'high',   'in_progress',
    'แอร์ห้อง 404 ไม่เย็น', 'คอมเพรสเซอร์ไม่ทำงาน รอช่างภายนอกเข้ามาดู',
    '2026-09-01 09:10+07', NULL, NULL),
( 9, 6, NULL, 'plumbing', 'urgent', 'open',
    'น้ำรั่วใต้อ่างล้างหน้า ห้อง 301', 'พบตอนทำความสะอาด มีน้ำขังใต้ตู้',
    '2026-09-07 08:40+07', NULL, NULL),
( 5, 2, 9, 'electrical', 'normal', 'open',
    'ไฟหัวเตียงห้อง 201 ติด ๆ ดับ ๆ', NULL,
    '2026-09-05 14:20+07', NULL, NULL),
(NULL, 3, 9, 'other',    'low',    'open',
    'ประตูล็อบบี้ฝืด', 'ต้องออกแรงดันมากกว่าปกติ',
    '2026-09-06 17:05+07', NULL, NULL),
( 2, 7, 9, 'furniture',  'normal', 'resolved',
    'เก้าอี้ทำงานห้อง 102 โยก', 'สกรูหลวม',
    '2026-08-20 10:00+07', '2026-08-20 15:30+07', 'ขันสกรูใหม่ทั้งตัว ใช้งานได้ปกติ'),
( 1, 2, 9, 'appliance',  'normal', 'closed',
    'กาต้มน้ำห้อง 101 เสีย', NULL,
    '2026-07-14 09:00+07', '2026-07-15 08:30+07', 'เปลี่ยนกาใหม่');

-- ---------------------------------------------------------------------
--  audit_log
--  แถวของ booking ถูกสร้างอัตโนมัติแล้วโดย trigger aiu_booking_audit
--  (INSERT booking 14 แถว -> audit 14 แถว) ตรงนี้เติมตัวอย่างของ entity อื่น
-- ---------------------------------------------------------------------
INSERT INTO audit_log (actor_user_id, actor_label, action, entity_type, entity_id, summary, data) VALUES
(1, 'manager01', 'room.status_change', 'room',    '16',
    'ห้อง 404: available -> maintenance', '{"from":"available","to":"maintenance"}'),
(10,'admin01',   'user.create',         'app_user','7',
    'สร้างบัญชี house01 (housekeeping)',  '{"role":"housekeeping"}'),
(9, 'acct01',    'invoice.issue',       'invoice', '4',
    'ออกใบกำกับภาษี INV-2026-00004',      '{"total":"26000.00"}'),
(1, 'manager01', 'rate_plan.create',    'rate_plan','6',
    'เพิ่มราคาไฮซีซั่นปลายปี',             '{"kind":"seasonal","priority":50}');

-- =====================================================================
--  ประชากรจำลอง : ลูกค้า 1000 คน (ชื่ออังกฤษ) + ประวัติการเข้าพัก
--  แถว 1..12 (customer) และ 1..14 (booking) ด้านบนเป็นชุดที่เทสต์อ้างถึง
--  ห้ามขยับ ; ส่วนนี้ต่อท้าย id 13.. / 15.. ล้วน ๆ
--  * ทุก booking ที่สร้างที่นี่เป็น 'checked_out' -> ไม่ชนกับ trigger กันจองซ้อน
-- =====================================================================

-- ---- customer 13..1000 ------------------------------------------------
INSERT INTO customer (first_name, last_name, email, phone, created_at)
SELECT
    nm.fn[1 + (g % array_length(nm.fn, 1))],
    nm.ln[1 + ((g / 6) % array_length(nm.ln, 1))],
    lower(nm.fn[1 + (g % array_length(nm.fn, 1))]) || '.' ||
        lower(nm.ln[1 + ((g / 6) % array_length(nm.ln, 1))]) || g || '@example.com',
    '08' || lpad(((g * 7919) % 100000000)::text, 8, '0'),
    -- 26+ years of guest history: oldest profiles date to the year 2000
    TIMESTAMPTZ '2000-01-01 08:00+07'
        + ((g * 131) % 9700) * INTERVAL '1 day'
        + (g % 24) * INTERVAL '1 hour'
FROM generate_series(13, 1000) AS g,
     (SELECT
        ARRAY['James','Mary','Robert','Patricia','John','Jennifer','Michael','Linda','David',
              'Elizabeth','William','Barbara','Richard','Susan','Joseph','Jessica','Thomas','Sarah',
              'Charles','Karen','Christopher','Nancy','Daniel','Lisa','Matthew','Betty','Anthony',
              'Sandra','Mark','Ashley','Donald','Kimberly','Steven','Emily','Paul','Donna','Andrew',
              'Michelle','Joshua','Carol','Kenneth','Amanda','Kevin','Melissa','Brian','Deborah',
              'George','Stephanie','Timothy','Rebecca','Ronald','Sharon','Edward','Laura','Jason',
              'Cynthia','Jeffrey','Kathleen','Ryan','Amy','Jacob','Angela','Gary','Shirley','Nicholas',
              'Anna','Eric','Brenda','Jonathan','Pamela','Stephen','Emma','Larry','Nicole','Justin',
              'Helen','Scott','Samantha','Brandon','Katherine','Benjamin','Christine','Samuel','Debra',
              'Gregory','Rachel','Alexander','Carolyn','Patrick','Janet','Frank','Maria','Raymond',
              'Heather','Jack','Diane','Dennis','Olivia','Jerry','Julie'] AS fn,
        ARRAY['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez',
              'Martinez','Hernandez','Lopez','Gonzalez','Wilson','Anderson','Thomas','Taylor','Moore',
              'Jackson','Martin','Lee','Perez','Thompson','White','Harris','Sanchez','Clark','Ramirez',
              'Lewis','Robinson','Walker','Young','Allen','King','Wright','Scott','Torres','Nguyen',
              'Hill','Flores','Green','Adams','Nelson','Baker','Hall','Rivera','Campbell','Mitchell',
              'Carter','Roberts','Gomez','Phillips','Evans','Turner','Diaz','Parker','Cruz','Edwards',
              'Collins','Reyes','Stewart','Morris','Morales','Murphy','Cook','Rogers','Gutierrez',
              'Ortiz','Morgan','Cooper','Peterson','Bailey','Reed','Kelly','Howard','Ramos','Kim',
              'Cox','Ward','Richardson','Watson','Brooks','Chavez','Wood','James','Bennett','Gray',
              'Mendoza','Ruiz','Hughes','Price','Alvarez','Castillo','Sanders','Patel','Myers','Long',
              'Ross','Foster','Jimenez'] AS ln) AS nm;

-- ---- booking 15..  (ประวัติ : 1..4 ครั้ง/คน, ทั้งหมด checked_out) --------
--   วันเข้าพักกระจายตั้งแต่วันสมัครของลูกค้ารายนั้น ๆ ถึง ~ปัจจุบัน
INSERT INTO booking (customer_id, staff_id, booking_date, check_in_date,
                     check_out_date, num_guests, status, note)
SELECT
    h.customer_id,
    2 + (h.s % 3),                                        -- receptionist 2/3/4
    GREATEST(h.joined, (h.ci - INTERVAL '18 days')::timestamptz),
    h.ci,
    h.ci + (1 + (h.s % 5)) * INTERVAL '1 day',            -- 1..5 คืน
    1 + (h.s % 2),                                        -- 1..2 คน
    'checked_out',
    'seed history'
FROM (
    SELECT
        g AS customer_id, s, c.created_at AS joined,
        c.created_at::date
            + ((g * 17 + s * 89) %
               GREATEST(1, (DATE '2026-08-25' - c.created_at::date)))::int AS ci
    FROM generate_series(13, 1000) AS g
    CROSS JOIN LATERAL generate_series(1, 1 + (g % 4)) AS s
    JOIN customer c ON c.customer_id = g
) AS h;

-- ---- booking_room : 1 ห้อง/การจอง + ราคา snapshot ---------------------
-- เลือกห้องทีละการจองตามลำดับวันเข้าพัก และข้ามห้องที่มีคนพักทับช่วงวันอยู่แล้ว
-- (INSERT ... SELECT ครั้งเดียวมองไม่เห็นแถวที่ตัวเองเพิ่งเพิ่ม จึงเคยได้ห้องพักซ้อน)
-- trigger BR-5 ตรวจเฉพาะการจองที่ยังครองห้อง ประวัติที่ checked_out จึงต้องกันที่นี่
DO $$
DECLARE
    r      RECORD;
    v_room INT;
BEGIN
    FOR r IN
        SELECT booking_id, check_in_date, check_out_date, status
        FROM booking
        WHERE booking_id >= 15
        ORDER BY check_in_date, booking_id
    LOOP
        SELECT rm.room_id
          INTO v_room
        FROM room rm
        WHERE rm.status = 'available'
          AND (r.status = 'cancelled' OR NOT EXISTS (
                SELECT 1
                FROM booking_room br
                JOIN booking b ON b.booking_id = br.booking_id
                WHERE br.room_id = rm.room_id
                  AND b.status <> 'cancelled'
                  AND b.check_in_date < r.check_out_date
                  AND r.check_in_date < b.check_out_date))
        ORDER BY ((rm.room_id * 31 + r.booking_id * 17) % 2000)
        LIMIT 1;

        INSERT INTO booking_room (booking_id, room_id, price_per_night)
        SELECT r.booking_id, rm.room_id,
               ROUND(rt.base_price_per_night * (0.85 + (r.booking_id % 7) * 0.05), 2)
        FROM room rm
        JOIN room_type rt ON rt.room_type_id = rm.room_type_id
        WHERE rm.room_id = v_room;
    END LOOP;
END $$;

-- ---- payment : จ่ายเต็มจำนวน (ทุกการจองในอดีตปิดยอดแล้ว) ---------------
INSERT INTO payment (booking_id, amount, method, status, paid_at)
SELECT
    br.booking_id,
    ROUND(br.price_per_night * (b.check_out_date - b.check_in_date), 2),
    (ARRAY['cash','credit_card','bank_transfer','promptpay'])[1 + (br.booking_id % 4)],
    'paid',
    (b.check_out_date)::timestamptz + INTERVAL '11 hours'
FROM booking_room br
JOIN booking b ON b.booking_id = br.booking_id
WHERE br.booking_id >= 15;

-- ---- review : ~2/3 ของการเข้าพักมีรีวิว, คะแนนเอียงไปทางสูง (โรงแรม 5 ดาว)
INSERT INTO review (booking_id, rating, comment, created_at)
SELECT
    b.booking_id,
    CASE
        WHEN b.booking_id % 23 = 0 THEN 2
        WHEN b.booking_id % 11 = 0 THEN 3
        WHEN b.booking_id % 4  = 0 THEN 4
        ELSE 5
    END,
    (ARRAY[
        'Impeccable service and a spotless room. We will be back.',
        'Great location — walkable to the BTS. The bed was very comfortable.',
        'Staff went out of their way to help. A lovely stay.',
        'Beautiful skyline view at night, and quiet despite being downtown.',
        'Good value for the price. Breakfast could be a little better.',
        'Fast check-in and the room was ready early. Very smooth.',
        'Spacious and modern. The rain shower is fantastic.',
        'Very clean, very quiet, and close to everything we wanted to see.',
        'Friendly front desk, comfortable room — would recommend.',
        'The rooftop bar is a highlight and the rooms are genuinely elegant.',
        NULL, NULL, NULL
    ])[1 + (b.booking_id % 13)],
    b.check_out_date::timestamptz + INTERVAL '1 day' + (b.booking_id % 10) * INTERVAL '1 hour'
FROM booking b
WHERE b.booking_id >= 15 AND (b.booking_id % 3) <> 2;

-- =====================================================================
--  เสร็จ -- ตรวจด้วย:
--    SELECT * FROM v_booking_bill        ORDER BY booking_id;
--    SELECT * FROM v_housekeeping_board  WHERE scheduled_for = DATE '2026-09-07';
--    SELECT * FROM v_maintenance_open;
--    SELECT * FROM v_invoice_summary;
--    SELECT fn_quote_stay(5, DATE '2026-12-30', DATE '2027-01-02');  -- ไฮซีซั่น
-- =====================================================================
