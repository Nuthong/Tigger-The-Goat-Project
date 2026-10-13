-- =====================================================================
--  06_operations : งานแม่บ้าน, งานซ่อม, room_status_log, รีวิว, สถานะห้องปัจจุบัน
-- =====================================================================
\echo '>> 06 housekeeping, maintenance, room status log, reviews'

-- ---- งานแม่บ้าน: สถานะตามเวลาจริง (เสร็จ / กำลังทำ / รอ) -----------------
CREATE TEMP TABLE h_task_out AS
SELECT t.tid, t.room_id, b.bid, t.ttype, t.day, t.hk, t.created_at, t.note, t.skipped,
       CASE WHEN s.tid IS NULL THEN NULL ELSE pg_temp.bkk(t.day, s.done_min - s.dur) END AS start_at,
       CASE WHEN s.tid IS NULL THEN NULL ELSE pg_temp.bkk(t.day, s.done_min) END        AS done_at
FROM h_task t
LEFT JOIN h_sched s USING (tid)
LEFT JOIN h_bf b ON b.k = t.k;

INSERT INTO housekeeping_task (room_id, booking_id, task_type, status, scheduled_for, assigned_to,
                               created_at, started_at, completed_at, note)
SELECT o.room_id, o.bid, o.ttype,
       CASE WHEN o.skipped THEN 'skipped'
            WHEN o.done_at  <= p.t_now THEN 'done'
            WHEN o.start_at <= p.t_now THEN 'in_progress'
            ELSE 'pending' END,
       o.day, o.hk, o.created_at,
       CASE WHEN NOT o.skipped AND o.start_at <= p.t_now THEN o.start_at END,
       CASE WHEN NOT o.skipped AND o.done_at  <= p.t_now THEN o.done_at END,
       o.note
FROM h_task_out o CROSS JOIN h_param p
ORDER BY o.day, o.created_at, o.tid;

-- ---- งานซ่อม ---------------------------------------------------------
CREATE TEMP TABLE h_issue (category text, i int, title text, resolution text);
INSERT INTO h_issue VALUES
('hvac', 1, 'แอร์ห้อง %s ไม่เย็น', 'ล้างแอร์และเติมน้ำยา ทดสอบแล้วเย็นปกติ'),
('hvac', 2, 'แอร์ห้อง %s มีน้ำหยด', 'ล้างท่อน้ำทิ้งแอร์ที่อุดตัน'),
('hvac', 3, 'แอร์ห้อง %s เสียงดัง', 'เปลี่ยนมอเตอร์พัดลมคอยล์เย็น'),
('plumbing', 1, 'น้ำรั่วใต้อ่างล้างหน้า ห้อง %s', 'เปลี่ยนท่อน้ำทิ้งใต้อ่างและยาแนวใหม่'),
('plumbing', 2, 'ชักโครกห้อง %s น้ำไหลไม่หยุด', 'เปลี่ยนลูกลอยและยางปิดน้ำ'),
('plumbing', 3, 'ฝักบัวห้อง %s น้ำไม่แรง', 'ล้างหัวฝักบัวและตะแกรงกรองน้ำ'),
('plumbing', 4, 'ท่อระบายน้ำห้องน้ำห้อง %s ตัน', 'ทะลวงท่อระบายน้ำ ทดสอบการไหลแล้ว'),
('electrical', 1, 'ไฟหัวเตียงห้อง %s ติด ๆ ดับ ๆ', 'เปลี่ยนขั้วหลอดและสายไฟ'),
('electrical', 2, 'ปลั๊กข้างโต๊ะทำงานห้อง %s ไม่มีไฟ', 'เปลี่ยนเต้ารับใหม่'),
('electrical', 3, 'คีย์การ์ดห้อง %s ไม่ตัดไฟ', 'เปลี่ยนสวิตช์คีย์การ์ด'),
('furniture', 1, 'เก้าอี้ทำงานห้อง %s โยก', 'ขันสกรูใหม่ทั้งตัว ใช้งานได้ปกติ'),
('furniture', 2, 'ลิ้นชักตู้ห้อง %s ฝืด', 'เปลี่ยนรางลิ้นชัก'),
('furniture', 3, 'ม่านห้อง %s ปิดไม่สนิท', 'เปลี่ยนรางม่านและตะขอ'),
('appliance', 1, 'ทีวีห้อง %s เปิดไม่ติด', 'เปลี่ยนแผงจ่ายไฟทีวี'),
('appliance', 2, 'ตู้เย็นห้อง %s ไม่เย็น', 'เปลี่ยนตู้เย็นใหม่'),
('appliance', 3, 'กาต้มน้ำห้อง %s เสีย', 'เปลี่ยนกาใหม่'),
('appliance', 4, 'ไดร์เป่าผมห้อง %s ไม่ทำงาน', 'เปลี่ยนไดร์เป่าผม'),
('other', 1, 'กลอนประตูห้อง %s ล็อกยาก', 'หยอดน้ำมันและปรับตั้งกลอน'),
('other', 2, 'วอลเปเปอร์ห้อง %s ลอก', 'ติดวอลเปเปอร์ใหม่บริเวณที่ลอก');
CREATE TEMP TABLE h_issuecount AS SELECT category, count(*)::int AS n FROM h_issue GROUP BY 1;

CREATE TEMP TABLE h_ticket AS
WITH f AS (
    SELECT f.*,
           CASE WHEN u < 0.25 THEN 'hvac' WHEN u < 0.50 THEN 'plumbing' WHEN u < 0.65 THEN 'electrical'
                WHEN u < 0.77 THEN 'furniture' WHEN u < 0.92 THEN 'appliance' ELSE 'other' END AS category
    FROM (SELECT h.*, pg_temp.rnd(h.fid, 91) AS u FROM h_fault h) f
)
SELECT f.fid, f.room_id, f.k, f.found, f.prio, f.category, f.rep_at, f.res_at, f.d, f.dur,
       CASE WHEN f.found = 'checkout' THEN ct.hk
            ELSE rd.ids[1 + floor(pg_temp.rnd(f.fid, 92) * cardinality(rd.ids))::int] END AS reported_by,
       tech.ids[1 + floor(pg_temp.rnd(f.fid, 93) * cardinality(tech.ids))::int] AS assigned_to,
       format(i.title, hr.room_number) AS title,
       CASE WHEN f.found = 'checkout' THEN 'พบระหว่างทำความสะอาดหลังเช็คเอาท์'
            ELSE 'แขกแจ้งที่เคาน์เตอร์ระหว่างเข้าพัก' END
       || CASE WHEN f.dur > 0 THEN ' - ปิดห้องงดขายระหว่างซ่อม' ELSE '' END AS description,
       i.resolution
FROM f
JOIN h_room hr ON hr.room_id = f.room_id
JOIN h_issuecount ic ON ic.category = f.category
JOIN h_issue i ON i.category = f.category AND i.i = 1 + floor(pg_temp.rnd(f.fid, 94) * ic.n)::int
LEFT JOIN h_task ct ON f.found = 'checkout' AND ct.ttype = 'checkout_clean'
                   AND ct.k = f.k AND ct.room_id = f.room_id
JOIN h_roster rd ON rd.kind = 'desk' AND rd.d = f.d
JOIN h_roster rt ON rt.kind = 'tech' AND rt.d = (f.rep_at AT TIME ZONE 'Asia/Bangkok')::date
-- ช่างที่รับงานต้องยังทำงานอยู่ทั้งวันที่แจ้งและวันที่ซ่อมเสร็จ
LEFT JOIN h_roster re ON re.kind = 'tech' AND re.d = (f.res_at AT TIME ZONE 'Asia/Bangkok')::date
CROSS JOIN LATERAL (
    SELECT COALESCE(NULLIF(ARRAY(SELECT unnest(rt.ids) INTERSECT SELECT unnest(re.ids) ORDER BY 1),
                           '{}'), rt.ids) AS ids
) tech;

-- งานพื้นที่ส่วนกลาง (ไม่ผูกห้อง) ราว 2 ใบต่อเดือน
INSERT INTO h_ticket
SELECT -z.g AS fid, NULL, NULL, 'public',
       (ARRAY['low','normal','normal','high'])[1 + floor(pg_temp.rnd(z.g, 95) * 4)::int],
       pa.category,
       pg_temp.bkk(z.d, 540 + floor(pg_temp.rnd(z.g, 96) * 480)::int),
       pg_temp.bkk(z.d + 1 + floor(pg_temp.rnd(z.g, 97) * 4)::int, 600 + floor(pg_temp.rnd(z.g, 98) * 360)::int),
       z.d, 0,
       rd.ids[1 + floor(pg_temp.rnd(z.g, 99) * cardinality(rd.ids))::int],
       rt.ids[1 + floor(pg_temp.rnd(z.g, 100) * cardinality(rt.ids))::int],
       pa.title, pa.description, pa.resolution
FROM (SELECT g, DATE '2000-01-10' + g * 15 + floor(pg_temp.rnd(g, 101) * 10)::int AS d
      FROM generate_series(0, 660) AS g) z
CROSS JOIN LATERAL (
    SELECT * FROM (VALUES
        (0, 'other',      'ประตูล็อบบี้ฝืด',              'ต้องออกแรงดันมากกว่าปกติ',          'ปรับตั้งโช้คประตูใหม่'),
        (1, 'electrical', 'ไฟทางเดินชั้น %s ดับบางดวง',    'แจ้งโดยพนักงาน',                    'เปลี่ยนหลอด LED'),
        (2, 'other',      'ลิฟต์ตัวที่ %s ค้างระหว่างชั้น',  'ไม่มีผู้โดยสารติดค้าง',               'ช่างลิฟต์ปรับตั้งเซ็นเซอร์ประตู'),
        (3, 'plumbing',   'ก๊อกน้ำห้องน้ำล็อบบี้รั่ว',        NULL,                                'เปลี่ยนวาล์วก๊อกน้ำ'),
        (4, 'hvac',       'แอร์ห้องอาหารเช้าไม่เย็น',        'แขกร้องเรียนช่วงเช้า',               'ล้างคอยล์และเติมน้ำยา'),
        (5, 'furniture',  'โซฟาล็อบบี้ขาหัก',              NULL,                                'ซ่อมขาโซฟาและเสริมโครงไม้'),
        (6, 'plumbing',   'สระว่ายน้ำปั๊มกรองมีเสียงดัง',     'ดาดฟ้าชั้น 9',                        'เปลี่ยนลูกปืนปั๊ม'),
        (7, 'appliance',  'เครื่องทำน้ำแข็งชั้น %s ไม่ทำงาน', NULL,                                'เปลี่ยนเทอร์โมสตัท')
    ) v(i, category, title, description, resolution)
    WHERE v.i = floor(pg_temp.rnd(z.g, 102) * 8)::int
) pa0
CROSS JOIN LATERAL (
    SELECT pa0.category, format(pa0.title, 1 + floor(pg_temp.rnd(z.g, 103) * 9)::int) AS title,
           pa0.description, pa0.resolution
) pa
JOIN h_roster rd ON rd.kind = 'desk' AND rd.d = z.d
JOIN h_roster rt ON rt.kind = 'tech' AND rt.d = z.d
CROSS JOIN h_param p
WHERE pg_temp.bkk(z.d, 540) <= p.t_now
  AND NOT (z.d BETWEEN DATE '2020-04-01' AND DATE '2020-06-30');

ALTER TABLE h_ticket ADD COLUMN ticket_id int, ADD COLUMN status text;
UPDATE h_ticket t
   SET ticket_id = z.id
  FROM (SELECT fid, (SELECT COALESCE(max(ticket_id), 0) FROM maintenance_ticket)
                    + row_number() OVER (ORDER BY rep_at, fid) AS id
        FROM h_ticket) z
 WHERE z.fid = t.fid;
UPDATE h_ticket t
   SET status = CASE WHEN t.found = 'public' AND pg_temp.rnd(t.fid, 104) < 0.04 THEN 'cancelled'
                     WHEN t.res_at > p.t_now THEN 'in_progress'
                     WHEN t.res_at < p.t_now - INTERVAL '7 days' THEN 'closed'
                     ELSE 'resolved' END
  FROM h_param p;
DELETE FROM h_ticket t USING h_param p WHERE t.rep_at > p.t_now;

INSERT INTO maintenance_ticket (ticket_id, room_id, reported_by, assigned_to, category, priority,
                                status, title, description, created_at, resolved_at, resolution)
SELECT ticket_id, room_id, reported_by, assigned_to, category, prio, status, title, description,
       rep_at,
       CASE WHEN status IN ('resolved', 'closed') THEN res_at END,
       CASE WHEN status IN ('resolved', 'closed') THEN resolution
            WHEN status = 'cancelled' THEN 'แจ้งซ้ำกับใบงานก่อนหน้า' END
FROM h_ticket
ORDER BY ticket_id;
SELECT setval(pg_get_serial_sequence('maintenance_ticket', 'ticket_id'),
              (SELECT max(ticket_id) FROM maintenance_ticket));

-- ---- room_status_log: ทุกการเปลี่ยนสถานะห้องที่แอปบันทึก ---------------
--  เช็คเอาท์ (trigger ตั้ง cleaning) -> ทำความสะอาดเสร็จ (available)
--  แจ้งซ่อม (maintenance) -> ซ่อมเสร็จ (available) ; ปิดโรงแรมช่วงโควิด (closed)
CREATE TEMP TABLE h_log (room_id int, changed_by int, old_status text, new_status text,
                         changed_at timestamptz);
INSERT INTO h_log
SELECT br.room_id, b.out_staff, 'available', 'cleaning', b.out_at
FROM h_bf b JOIN h_bkroom br USING (k)
WHERE b.status = 'checked_out';

INSERT INTO h_log
SELECT o.room_id, o.hk, 'cleaning', 'available', o.done_at
FROM h_task_out o CROSS JOIN h_param p
WHERE o.ttype = 'checkout_clean' AND o.done_at <= p.t_now;

INSERT INTO h_log
SELECT room_id, reported_by, 'available', 'maintenance', rep_at
FROM h_ticket WHERE room_id IS NOT NULL;
INSERT INTO h_log
SELECT room_id, assigned_to, 'maintenance', 'available', res_at
FROM h_ticket WHERE room_id IS NOT NULL AND status IN ('resolved', 'closed');

INSERT INTO h_log
SELECT r.room_id, m.ids[1], 'available', 'closed', pg_temp.bkk(DATE '2020-04-01', 1380)
FROM h_room r JOIN h_roster m ON m.kind = 'mgr' AND m.d = DATE '2020-04-01';
INSERT INTO h_log
SELECT r.room_id, m.ids[1], 'closed', 'available', pg_temp.bkk(DATE '2020-07-01', 480)
FROM h_room r JOIN h_roster m ON m.kind = 'mgr' AND m.d = DATE '2020-07-01';

INSERT INTO room_status_log (room_id, changed_by, old_status, new_status, changed_at)
SELECT room_id, changed_by, old_status, new_status, changed_at
FROM h_log
ORDER BY changed_at, room_id;

-- สถานะห้องตอนนี้ = ปลายทางของเหตุการณ์ล่าสุด (ห้องที่ยังทำความสะอาด / ยังซ่อมอยู่)
UPDATE room r
   SET status = l.new_status
  FROM (SELECT DISTINCT ON (room_id) room_id, new_status
          FROM h_log ORDER BY room_id, changed_at DESC) l
 WHERE r.room_id = l.room_id AND r.status = 'available' AND l.new_status <> 'available';

-- ---- รีวิว -----------------------------------------------------------
CREATE INDEX ON h_fault (k);
CREATE TEMP TABLE h_review AS
WITH c AS (
    SELECT b.k, b.bid, b.out_at, b.rtype, b.cust,
           COALESCE(hc.grp, CASE WHEN b.cust <= 12 THEN 'TH' ELSE 'WE' END) AS grp,
           EXISTS (SELECT 1 FROM h_fault f WHERE f.k = b.k AND f.found = 'stay') AS had_issue,
           EXISTS (SELECT 1 FROM h_svc s WHERE s.k = b.k AND s.service_id = 1) AS had_breakfast,
           EXISTS (SELECT 1 FROM h_svc s WHERE s.k = b.k AND s.service_id = 2) AS had_transfer,
           b.out_at + CASE WHEN pg_temp.rnd(b.k, 111) < 0.6
                           THEN make_interval(mins => 120 + floor(pg_temp.rnd(b.k, 112) * 1200)::int)
                           ELSE make_interval(hours => 24 + floor(pg_temp.rnd(b.k, 112) * 216)::int) END
               AS rv_at,
           pg_temp.rnd(b.k, 113) AS u
    FROM h_bf b
    LEFT JOIN h_cust hc ON hc.cid = b.cust
    WHERE b.status = 'checked_out'
      AND pg_temp.rnd(b.k, 110) < CASE WHEN b.rtype >= 4 THEN 0.45 ELSE 0.35 END
), r AS (
    SELECT c.*,
           CASE WHEN c.had_issue AND pg_temp.rnd(c.k, 114) < 0.6 THEN 2 + floor(pg_temp.rnd(c.k, 115) * 2)::int
                WHEN c.u < 0.52 THEN 5 WHEN c.u < 0.82 THEN 4 WHEN c.u < 0.93 THEN 3
                WHEN c.u < 0.98 THEN 2 ELSE 1 END AS rating,
           c.grp = 'TH' AS thai
    FROM c
)
SELECT r.bid, r.rating, r.rv_at,
       CASE WHEN pg_temp.rnd(r.k, 116) < 0.2 THEN NULL
            ELSE concat_ws(' ',
                 CASE WHEN r.had_issue AND r.rating <= 3 THEN
                      CASE WHEN r.thai THEN 'มีปัญหาอุปกรณ์ในห้องระหว่างเข้าพัก แต่ช่างมาแก้ให้ภายในวันเดียว'
                           ELSE 'Something in the room broke during our stay, but maintenance fixed it the same day.' END
                 WHEN r.thai THEN
                      (CASE r.rating
                          WHEN 5 THEN ARRAY['ห้องสะอาด พนักงานบริการดีมาก','วิวสวนลุมพินีสวยมาก จะกลับมาพักอีก',
                                            'ทำเลดี เดินไป BTS ได้สะดวก','เตียงนอนสบาย เงียบสงบ',
                                            'พนักงานต้อนรับยิ้มแย้ม เช็คอินรวดเร็ว']
                          WHEN 4 THEN ARRAY['คุ้มราคา แต่ลิฟต์รอนานช่วงเช้า','ห้องดี แต่ Wi-Fi ช้าไปนิด',
                                            'โดยรวมดี ที่จอดรถค่อนข้างแคบ','บริการดี ห้องน้ำเล็กไปหน่อย']
                          WHEN 3 THEN ARRAY['โดยรวมโอเค แต่ห้องมีกลิ่นอับเล็กน้อย','เช็คอินช้า รอนาน',
                                            'ห้องเก่ากว่าในรูปเล็กน้อย']
                          ELSE ARRAY['ห้องไม่ค่อยสะอาด ผิดหวัง','บริการช้า ไม่ประทับใจ',
                                     'เสียงดังจากห้องข้าง ๆ นอนไม่ค่อยหลับ'] END)
                      [1 + floor(pg_temp.rnd(r.k, 117) * CASE r.rating WHEN 5 THEN 5 WHEN 4 THEN 4 ELSE 3 END)::int]
                 ELSE
                      (CASE r.rating
                          WHEN 5 THEN ARRAY['Impeccable service and a spotless room. We will be back.',
                                            'Beautiful view over Lumphini Park, and quiet despite being downtown.',
                                            'Great location, walkable to the BTS. The bed was very comfortable.',
                                            'Staff went out of their way to help. A lovely stay.',
                                            'Fast check-in and the room was ready early. Very smooth.']
                          WHEN 4 THEN ARRAY['Good value for the price. The lifts are slow in the morning.',
                                            'Nice room, but the Wi-Fi could be faster.',
                                            'Friendly front desk, comfortable room.',
                                            'Very clean. The bathroom is a little small.']
                          WHEN 3 THEN ARRAY['Okay overall, the room smelled a little musty.',
                                            'Check-in took a long time.',
                                            'The room looked older than in the photos.']
                          ELSE ARRAY['The room was not very clean. Disappointing.',
                                     'Slow service, not impressed.',
                                     'Noisy neighbours, hard to sleep.'] END)
                      [1 + floor(pg_temp.rnd(r.k, 117) * CASE r.rating WHEN 5 THEN 5 WHEN 4 THEN 4 ELSE 3 END)::int]
                 END,
                 CASE WHEN r.rating >= 4 AND r.had_breakfast AND pg_temp.rnd(r.k, 118) < 0.4 THEN
                      CASE WHEN r.thai THEN 'อาหารเช้าหลากหลาย อร่อย' ELSE 'The breakfast buffet had great variety.' END
                 END,
                 CASE WHEN r.rating >= 4 AND r.had_transfer AND pg_temp.rnd(r.k, 119) < 0.4 THEN
                      CASE WHEN r.thai THEN 'รถรับส่งสนามบินตรงเวลา' ELSE 'The airport transfer was right on time.' END
                 END,
                 CASE WHEN r.rating >= 4 AND r.rtype = 5 AND pg_temp.rnd(r.k, 120) < 0.5 THEN
                      CASE WHEN r.thai THEN 'ห้องสวีทกว้างขวาง อ่างอาบน้ำวิวเมืองสวยมาก'
                           ELSE 'The suite was spacious, with a stunning city view from the bathtub.' END
                      WHEN r.rating >= 4 AND r.rtype = 4 AND pg_temp.rnd(r.k, 120) < 0.5 THEN
                      CASE WHEN r.thai THEN 'ห้องครอบครัวกว้าง เหมาะกับเด็ก'
                           ELSE 'A great two-bedroom residence for our family.' END
                 END)
       END AS comment
FROM r CROSS JOIN h_param p
WHERE r.rv_at <= p.t_now;

INSERT INTO review (booking_id, rating, comment, created_at)
SELECT bid, rating, comment, rv_at FROM h_review ORDER BY rv_at, bid;
