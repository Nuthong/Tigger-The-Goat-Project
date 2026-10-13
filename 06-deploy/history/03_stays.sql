-- =====================================================================
--  03_stays : id จริง, บริการเสริม, เวลาเช็คอิน/เอาท์, ตารางงานแม่บ้าน, สถานะ
--  ลำดับเหตุผล:  เช็คเอาท์ -> งานทำความสะอาด (ต่อคิวของแม่บ้านทีละงาน)
--                -> ห้องพร้อม -> แขกคนถัดไปเช็คอินได้  (ไม่มีเวลาไหนทับกัน)
-- =====================================================================
\echo '>> 03 stays'

-- ---- id จริง: ลูกค้าเรียงตามวันสมัคร, การจองเรียงตามเวลาจอง ---------
CREATE TEMP TABLE h_custmap AS
SELECT n.cust AS prov,
       ((SELECT cust_base FROM h_param) + row_number() OVER (ORDER BY n.created_at, n.cust))::int AS cid,
       n.created_at
FROM h_newcust n;
CREATE UNIQUE INDEX ON h_custmap (prov);

CREATE TEMP TABLE h_b AS
SELECT b.k,
       COALESCE(m.cid, b.cust) AS cust,
       ((SELECT booking_base FROM h_param) + row_number() OVER (ORDER BY b.b_at, b.k))::int AS bid,
       b.b_at, b.ci, b.co, (b.co - b.ci) AS n, b.guests, r.nr, r.cap, b.rtype, b.lead,
       b.walkin, b.cancelled, b.noshow, b.cancel_at
FROM h_bk b
LEFT JOIN h_custmap m ON m.prov = b.cust
JOIN (SELECT br.k, count(*)::int AS nr, sum(hr.cap)::int AS cap
      FROM h_bkroom br JOIN h_room hr USING (room_id)
      GROUP BY br.k) r ON r.k = b.k;
ALTER TABLE h_b ADD PRIMARY KEY (k);
ANALYZE h_b;

-- ---- บริการเสริม (BR-29: ไม่เกินที่การเข้าพักนั้นใช้ได้) ------------
-- จองล่วงหน้าได้: อาหารเช้า (ครบทุกคนทุกคืน = ปุ่ม Add ครอบคลุมทั้งทริป), รถรับส่ง
-- (<= 2 เที่ยว/ห้อง), เตียงเสริม (1 เตียงทุกคืน), เช็คเอาท์ช้า (1/ห้อง)
-- ใช้ระหว่างพักจริงเท่านั้น: ซักรีด, มินิบาร์ (<= ห้อง x คืน)
-- ราคาต่อหน่วย = ราคาในแคตตาล็อก ณ ปีนั้น (BR-6 snapshot)
CREATE TEMP TABLE h_svc AS
WITH b AS (
    SELECT h.*, (NOT h.cancelled AND h.ci < p.today) AS consumed,
           fb.f AS f_book, fs.f AS f_stay
    FROM h_b h
    CROSS JOIN h_param p
    JOIN h_year_factor fb ON fb.y = extract(year FROM h.b_at AT TIME ZONE 'Asia/Bangkok')
    JOIN h_year_factor fs ON fs.y = extract(year FROM h.ci)
)
SELECT s.k, s.service_id, s.qty,
       greatest(10, pg_temp.r10(sv.price * s.f))::numeric(10,2) AS unit_price
FROM (
    SELECT b.k, 1 AS service_id, least(b.guests * b.n, 99) AS qty, b.f_book AS f
      FROM b WHERE pg_temp.rnd(b.k, 11) < CASE WHEN b.rtype = 5 THEN 0.70 ELSE 0.42 END
    UNION ALL
    SELECT b.k, 2, CASE WHEN pg_temp.rnd(b.k, 13) < 0.6 THEN 2 ELSE 1 END, b.f_book
      FROM b WHERE pg_temp.rnd(b.k, 12) < 0.18
    UNION ALL
    SELECT b.k, 3, 1 + floor(pg_temp.rnd(b.k, 15) * least(3, b.nr * b.n))::int, b.f_stay
      FROM b WHERE b.consumed AND b.n >= 2 AND pg_temp.rnd(b.k, 14) < 0.14
    UNION ALL
    SELECT b.k, 4, least(b.n, 99), b.f_book
      FROM b WHERE b.guests = b.cap AND pg_temp.rnd(b.k, 16) < 0.25
    UNION ALL
    SELECT b.k, 5, 1, b.f_book
      FROM b WHERE pg_temp.rnd(b.k, 17) < 0.07
    UNION ALL
    SELECT b.k, 6, 1 + floor(pg_temp.rnd(b.k, 19) * least(4, b.nr * b.n))::int, b.f_stay
      FROM b WHERE b.consumed AND pg_temp.rnd(b.k, 18) < 0.24
) s
JOIN service sv USING (service_id);
CREATE INDEX ON h_svc (k);
ANALYZE h_svc;

-- ---- เวลาเช็คเอาท์ / เวลาที่อยากเช็คอิน ------------------------------
-- เช็คเอาท์ 07:00-11:50 (ซื้อ Late Checkout: 12:30-16:00), เช็คอิน 14:00-21:30,
-- walk-in เข้าห้องหลังจองไม่นาน
CREATE TEMP TABLE h_t AS
SELECT b.k, (s.k IS NOT NULL) AS late,
       (CASE WHEN s.k IS NOT NULL THEN 750 + floor(pg_temp.rnd(b.k, 21) * 210)
             ELSE 420 + floor(pg_temp.rnd(b.k, 21) * 290) END)::int AS out_min,
       CASE WHEN b.walkin
            THEN b.b_at + make_interval(mins => 10 + floor(pg_temp.rnd(b.k, 22) * 30)::int)
            ELSE pg_temp.bkk(b.ci, 840 + floor(pg_temp.rnd(b.k, 22) * 450)::int) END AS want_in
FROM h_b b
LEFT JOIN h_svc s ON s.k = b.k AND s.service_id = 5;
ALTER TABLE h_t ADD PRIMARY KEY (k);
ANALYZE h_t;

-- ช่วงที่ห้องมีคน / ปิดซ่อม (ใช้หาวันว่างสำหรับ deep clean และตรวจห้อง)
CREATE TEMP TABLE h_occ AS
SELECT br.room_id, b.ci AS d_from, b.co AS d_to
FROM h_b b JOIN h_bkroom br USING (k) WHERE NOT b.cancelled
UNION ALL
SELECT room_id, d_from, d_to FROM h_block
UNION ALL
SELECT room_id, d, d + dur FROM h_fault WHERE found = 'checkout' AND dur > 0;
CREATE INDEX ON h_occ (room_id, d_from);
CREATE INDEX ON h_occ (room_id, d_to);
ANALYZE h_occ;

-- เวลาของงานซ่อมที่ไม่ขึ้นกับคิวแม่บ้าน
ALTER TABLE h_fault ADD COLUMN fid serial, ADD COLUMN res_day date, ADD COLUMN res_min int,
                    ADD COLUMN rep_at timestamptz, ADD COLUMN res_at timestamptz;
UPDATE h_fault SET
    rep_at  = CASE WHEN found = 'stay'
                   THEN pg_temp.bkk(d, 600 + floor(pg_temp.rnd(fid, 51) * 420)::int) END,
    res_day = CASE WHEN dur > 0 THEN d + dur END,
    res_min = CASE WHEN dur > 0 THEN 540 + floor(pg_temp.rnd(fid, 52) * 90)::int END;
UPDATE h_fault SET res_at = rep_at + make_interval(mins => 40 + floor(pg_temp.rnd(fid, 53) * 110)::int)
 WHERE found = 'stay';
UPDATE h_fault SET res_at = pg_temp.bkk(res_day, res_min) WHERE dur > 0;

-- ---- งานแม่บ้าน ------------------------------------------------------
CREATE TEMP TABLE h_task (
    tid        serial PRIMARY KEY,
    room_id    int NOT NULL,
    k          int,
    ttype      text NOT NULL,
    day        date NOT NULL,
    ready      int NOT NULL,        -- เริ่มได้ตั้งแต่นาทีที่เท่าไรของวัน
    dur        int NOT NULL,
    created_at timestamptz NOT NULL,
    note       text,
    skipped    boolean NOT NULL DEFAULT FALSE,
    evening    boolean NOT NULL DEFAULT FALSE,
    hk         int
);

-- (ก) ทำความสะอาดหลังเช็คเอาท์ - แบบเดียวกับที่ trigger au_booking_checkout_housekeeping สร้าง
INSERT INTO h_task (room_id, k, ttype, day, ready, dur, created_at, note)
SELECT br.room_id, b.k, 'checkout_clean', b.co, t.out_min + 10,
       (CASE hr.room_type_id WHEN 1 THEN 25 WHEN 2 THEN 28 WHEN 3 THEN 32 ELSE 45 END
        + floor(pg_temp.rnd(b.k::bigint * 16 + br.seq, 23)
                * CASE WHEN hr.room_type_id >= 4 THEN 26 ELSE 13 END))::int,
       pg_temp.bkk(b.co, t.out_min), 'สร้างอัตโนมัติเมื่อ check-out'
FROM h_b b
JOIN h_t t USING (k)
JOIN h_bkroom br USING (k)
JOIN h_room hr USING (room_id)
CROSS JOIN h_param p
WHERE NOT b.cancelled AND pg_temp.bkk(b.co, t.out_min) <= p.t_now;

-- (ข) ทำความสะอาดรายวันระหว่างพัก (แขกแขวนป้ายห้ามรบกวน = skipped)
INSERT INTO h_task (room_id, k, ttype, day, ready, dur, created_at, note, skipped)
SELECT br.room_id, b.k, 'stayover_clean', d::date,
       510 + floor(pg_temp.rnd(z.h, 24) * 90)::int,
       18 + floor(pg_temp.rnd(z.h, 25) * 11)::int,
       pg_temp.bkk(d::date, 360),
       CASE WHEN pg_temp.rnd(z.h, 26) < 0.08 THEN 'แขกแขวนป้ายห้ามรบกวน' END,
       pg_temp.rnd(z.h, 26) < 0.08
FROM h_b b
JOIN h_bkroom br USING (k)
CROSS JOIN h_param p
CROSS JOIN LATERAL generate_series(b.ci + 1, b.co - 1, INTERVAL '1 day') AS d
CROSS JOIN LATERAL (SELECT (b.k::bigint * 16 + br.seq) * 4096 + (d::date - b.ci) AS h) z
WHERE NOT b.cancelled AND pg_temp.bkk(d::date, 360) <= p.t_now;

-- (ค) turndown ทุกคืนสำหรับ Oriental Suite
INSERT INTO h_task (room_id, k, ttype, day, ready, dur, created_at, evening)
SELECT br.room_id, b.k, 'turndown', d::date,
       1080 + floor(pg_temp.rnd(z.h, 27) * 60)::int,
       10 + floor(pg_temp.rnd(z.h, 28) * 6)::int,
       pg_temp.bkk(d::date, 360), TRUE
FROM h_b b
JOIN h_bkroom br USING (k)
JOIN h_room hr USING (room_id)
CROSS JOIN h_param p
CROSS JOIN LATERAL generate_series(b.ci, b.co - 1, INTERVAL '1 day') AS d
CROSS JOIN LATERAL (SELECT (b.k::bigint * 16 + br.seq) * 4096 + (d::date - b.ci) AS h) z
WHERE hr.room_type_id = 5 AND NOT b.cancelled AND pg_temp.bkk(d::date, 360) <= p.t_now;

-- (ง) deep clean ทุกไตรมาส ในวันที่ห้องว่างทั้งวัน (ไม่มีแขกคืนก่อนหน้าและคืนนั้น)
--     ช่วงว่างของแต่ละห้อง = ระหว่าง "จุดสิ้นสุดที่ไกลที่สุดของช่วงก่อนหน้า" กับ "ช่วงถัดไป"
CREATE TEMP TABLE h_gap AS
WITH o AS (
    SELECT room_id, d_from, d_to,
           max(d_to) OVER (PARTITION BY room_id ORDER BY d_from, d_to
                           ROWS UNBOUNDED PRECEDING)                    AS cover_to,
           lead(d_from) OVER (PARTITION BY room_id ORDER BY d_from, d_to) AS next_from
    FROM (SELECT room_id, d_from, d_to FROM h_occ
          UNION ALL
          SELECT room_id, DATE '1999-12-01', DATE '1999-12-31' FROM h_room) z
)
SELECT room_id, cover_to + 1 AS g_from, COALESCE(next_from, DATE '2027-01-02') - 1 AS g_to
FROM o
WHERE cover_to + 1 <= COALESCE(next_from, DATE '2027-01-02') - 1;
CREATE INDEX ON h_gap (room_id, g_to);
ANALYZE h_gap;

INSERT INTO h_task (room_id, k, ttype, day, ready, dur, created_at, note)
SELECT q.room_id, NULL, 'deep_clean', q.d,
       540 + floor(pg_temp.rnd(q.room_id * 100000 + (q.d - DATE '2000-01-01'), 29) * 60)::int,
       150 + floor(pg_temp.rnd(q.room_id * 100000 + (q.d - DATE '2000-01-01'), 30) * 91)::int,
       pg_temp.bkk(q.d - 3, 600), 'ทำความสะอาดใหญ่ประจำไตรมาส'
FROM (
    SELECT t.room_id, t.target, min(greatest(t.target, g.g_from)) AS d
    FROM (SELECT r.room_id, qs::date + (r.room_id * 7) % 60 AS target
          FROM h_room r
          CROSS JOIN h_param p
          CROSS JOIN LATERAL generate_series(DATE '2000-01-01', p.today, INTERVAL '3 months') AS qs
         ) t
    JOIN h_gap g ON g.room_id = t.room_id
                AND g.g_to >= t.target AND g.g_from <= t.target + 30
    GROUP BY t.room_id, t.target
) q
CROSS JOIN h_param p
WHERE q.d <= p.today AND pg_temp.bkk(q.d - 3, 600) <= p.t_now;

-- เตรียมเปิดโรงแรมหลังปิดช่วงโควิด: deep clean ทุกห้องปลายเดือนมิถุนายน 2020
INSERT INTO h_task (room_id, k, ttype, day, ready, dur, created_at, note)
SELECT r.room_id, NULL, 'deep_clean', DATE '2020-06-22' + (r.room_id % 9),
       540, 180, pg_temp.bkk(DATE '2020-06-15', 600), 'เตรียมเปิดโรงแรมหลังปิดชั่วคราว'
FROM h_room r;

-- (จ) ตรวจห้องก่อนรับแขก VIP (Oriental Suite ที่ห้องว่างมาก่อน) และหลังซ่อมเสร็จ
INSERT INTO h_task (room_id, k, ttype, day, ready, dur, created_at, note)
SELECT br.room_id, b.k, 'inspection', b.ci,
       720 + floor(pg_temp.rnd(b.k, 31) * 30)::int, 15,
       pg_temp.bkk(b.ci - 1, 900), 'ตรวจก่อนรับแขก VIP'
FROM h_b b
JOIN h_bkroom br USING (k)
JOIN h_room hr USING (room_id)
CROSS JOIN h_param p
WHERE hr.room_type_id = 5 AND NOT b.cancelled AND NOT b.walkin
  AND NOT EXISTS (SELECT 1 FROM h_occ o WHERE o.room_id = br.room_id AND o.d_to = b.ci)
  AND pg_temp.bkk(b.ci - 1, 900) <= p.t_now;

INSERT INTO h_task (room_id, k, ttype, day, ready, dur, created_at, note)
SELECT f.room_id, NULL, 'inspection', f.res_day, f.res_min + 15, 20, f.res_at,
       'ตรวจห้องหลังปิดงานซ่อม'
FROM h_fault f CROSS JOIN h_param p
WHERE f.dur > 0 AND f.res_at <= p.t_now;

-- ---- มอบงาน: เรียงห้องตามชั้น แล้วตัดเป็นโซนที่ "ชั่วโมงงานเท่า ๆ กัน" ให้แม่บ้าน
--      ที่อยู่เวรวันนั้น หมุนโซนทุกวัน - กะเย็น (turndown) แบ่งแยกอีกชุด
UPDATE h_task t
   SET hk = z.ids[1 + ((z.bucket + extract(doy FROM z.day)::int) % z.n)]
  FROM (
    SELECT tid, day, ids, n,
           least(n - 1, floor((cum - dur / 2.0) / tot * n))::int AS bucket
    FROM (
        SELECT t2.tid, t2.day, t2.dur, r.ids, cardinality(r.ids) AS n,
               sum(t2.dur) OVER (PARTITION BY t2.day, t2.evening
                                 ORDER BY hr.floor, hr.room_number, t2.tid
                                 ROWS UNBOUNDED PRECEDING) AS cum,
               sum(t2.dur) OVER (PARTITION BY t2.day, t2.evening) AS tot
        FROM h_task t2
        JOIN h_room hr ON hr.room_id = t2.room_id
        JOIN h_roster r ON r.kind = 'hk' AND r.d = t2.day
        WHERE NOT t2.skipped
    ) w
  ) z
 WHERE z.tid = t.tid;
-- งานที่แขกปฏิเสธ (DND) ยังมีเจ้าของตามโซนของห้องนั้น
UPDATE h_task t
   SET hk = r.ids[1 + ((hr.floor + extract(doy FROM t.day)::int) % cardinality(r.ids))]
  FROM h_roster r, h_room hr
 WHERE t.skipped AND r.kind = 'hk' AND r.d = t.day AND hr.room_id = t.room_id;

CREATE INDEX ON h_task (k);
ANALYZE h_task;

-- ห้องที่มีแขกเข้าวันเดียวกันได้ทำก่อน (แบบเดียวกับ arriving_today ของแอป)
ALTER TABLE h_task ADD COLUMN prio int NOT NULL DEFAULT 0;
UPDATE h_task t SET prio = 1000
 WHERE t.ttype IN ('checkout_clean', 'inspection')
   AND EXISTS (SELECT 1 FROM h_occ o WHERE o.room_id = t.room_id AND o.d_from = t.day);

-- ---- จัดคิว: แม่บ้านแต่ละคนทำทีละงาน เรียงตามเวลาที่ห้องพร้อม -------------
-- done'_i = max_j (ready_j - S_{j-1}) + S_i  (S = ผลรวมเวลางาน + พัก 5 นาที) - คำนวณด้วย window
CREATE TEMP TABLE h_sched AS
WITH o AS (
    SELECT tid, day, hk, ready, dur, ready - prio AS skey,
           sum(dur + 5) OVER w                  AS s_i,
           ready - (sum(dur + 5) OVER w - dur - 5) AS rj
    FROM h_task
    WHERE NOT skipped AND NOT evening
    WINDOW w AS (PARTITION BY day, hk ORDER BY ready - prio, tid ROWS UNBOUNDED PRECEDING)
)
SELECT tid, day, hk, dur,
       (s_i + max(rj) OVER (PARTITION BY day, hk ORDER BY skey, tid ROWS UNBOUNDED PRECEDING)
        - 5)::int AS done_min
FROM o;
ALTER TABLE h_sched ADD PRIMARY KEY (tid);
ANALYZE h_sched;

-- ของเสียที่พบหลังทำความสะอาด: แจ้งหลังงานเสร็จ, ซ่อมเสร็จในวันนั้นถ้าไม่ต้องปิดห้อง
UPDATE h_fault f
   SET rep_at = pg_temp.bkk(f.d, s.done_min + 5 + floor(pg_temp.rnd(f.fid, 54) * 10)::int)
  FROM h_task t JOIN h_sched s USING (tid)
 WHERE f.found = 'checkout' AND t.ttype = 'checkout_clean'
   AND t.k = f.k AND t.room_id = f.room_id;
UPDATE h_fault
   SET res_day = d,
       res_at  = rep_at + make_interval(mins => 25 + floor(pg_temp.rnd(fid, 55) * 55)::int)
 WHERE found = 'checkout' AND dur = 0;
UPDATE h_fault
   SET res_min = (extract(epoch FROM res_at - pg_temp.bkk(res_day, 0)) / 60)::int
 WHERE found = 'checkout' AND dur = 0;

-- ---- ห้องพร้อมรับแขกเมื่อไร / เวลาเช็คอินจริง -------------------------
CREATE TEMP TABLE h_ready AS
SELECT room_id, day, max(m) AS ready_min
FROM (
    SELECT t.room_id, t.day, s.done_min AS m
      FROM h_task t JOIN h_sched s USING (tid)
     WHERE t.ttype IN ('checkout_clean', 'inspection')
    UNION ALL
    SELECT room_id, res_day, res_min FROM h_fault WHERE found = 'checkout'
) z
GROUP BY room_id, day;
CREATE UNIQUE INDEX ON h_ready (room_id, day);

CREATE TEMP TABLE h_in AS
SELECT b.k,
       greatest(t.want_in, max(pg_temp.bkk(b.ci, rd.ready_min + 10))) AS in_at
FROM h_b b
JOIN h_t t USING (k)
JOIN h_bkroom br USING (k)
LEFT JOIN h_ready rd ON rd.room_id = br.room_id AND rd.day = b.ci
GROUP BY b.k, t.want_in;
ALTER TABLE h_in ADD PRIMARY KEY (k);

-- turndown: หลังแขกเข้าห้อง (คืนแรก) และหลังงานกลางวันของคนเดียวกัน
CREATE TEMP TABLE h_sched_eve AS
WITH last_day AS (
    SELECT day, hk, max(done_min) AS last_done FROM h_sched GROUP BY day, hk
), e AS (
    SELECT t.tid, t.day, t.hk, t.dur,
           greatest(t.ready,
                    CASE WHEN t.day = b.ci
                         THEN (extract(epoch FROM i.in_at - pg_temp.bkk(t.day, 0)) / 60)::int + 30
                    END,
                    ld.last_done + 5) AS ready
    FROM h_task t
    JOIN h_b b USING (k)
    JOIN h_in i USING (k)
    LEFT JOIN last_day ld ON ld.day = t.day AND ld.hk = t.hk
    WHERE t.evening
), o AS (
    SELECT tid, day, hk, dur, ready,
           sum(dur + 5) OVER w                  AS s_i,
           ready - (sum(dur + 5) OVER w - dur - 5) AS rj
    FROM e
    WINDOW w AS (PARTITION BY day, hk ORDER BY ready, tid ROWS UNBOUNDED PRECEDING)
)
SELECT tid, day, hk, dur,
       (s_i + max(rj) OVER (PARTITION BY day, hk ORDER BY ready, tid ROWS UNBOUNDED PRECEDING)
        - 5)::int AS done_min
FROM o;
INSERT INTO h_sched SELECT * FROM h_sched_eve;

-- ---- การจองฉบับสมบูรณ์: สถานะตามเวลาจริง, พนักงาน, ช่องทาง, แผนชำระเงิน ----
CREATE TEMP TABLE h_bf AS
WITH x AS (
    SELECT b.*, t.late, t.out_min, pg_temp.bkk(b.co, t.out_min) AS out_at, i.in_at,
           extract(year FROM b.b_at AT TIME ZONE 'Asia/Bangkok')::int AS byear,
           CASE WHEN NOT b.walkin AND b.b_at >= TIMESTAMPTZ '2024-01-01 00:00+07'
                     AND pg_temp.rnd(b.k, 41) < 0.45
                THEN p.online_id
                ELSE rb.ids[1 + floor(pg_temp.rnd(b.k, 42) * cardinality(rb.ids))::int]
           END AS staff_id,
           ri.ids[1 + floor(pg_temp.rnd(b.k, 43) * cardinality(ri.ids))::int] AS in_staff,
           ro.ids[1 + floor(pg_temp.rnd(b.k, 44) * cardinality(ro.ids))::int] AS out_staff,
           p.t_now, p.online_id
    FROM h_b b
    JOIN h_t t USING (k)
    JOIN h_in i USING (k)
    CROSS JOIN h_param p
    JOIN h_roster rb ON rb.kind = 'desk' AND rb.d = (b.b_at AT TIME ZONE 'Asia/Bangkok')::date
    JOIN h_roster ri ON ri.kind = 'desk' AND ri.d = b.ci
    JOIN h_roster ro ON ro.kind = 'desk' AND ro.d = b.co
), y AS (
    SELECT x.*,
           CASE WHEN x.cancelled                THEN 'cancelled'
                WHEN x.out_at <= x.t_now         THEN 'checked_out'
                WHEN x.in_at  <= x.t_now         THEN 'checked_in'
                WHEN NOT x.walkin AND x.staff_id <> x.online_id AND x.b_at > x.t_now - INTERVAL '5 days'
                     AND pg_temp.rnd(x.k, 45) < 0.30 THEN 'pending'
                ELSE 'confirmed' END AS status,
           CASE WHEN x.walkin THEN 'Walk-in'
                WHEN x.staff_id = x.online_id THEN
                    (ARRAY['Agoda','Agoda','Booking.com','Booking.com','Expedia','Trip.com',
                           'Trip.com','เว็บไซต์โรงแรม'])[1 + floor(pg_temp.rnd(x.k, 46) * 8)::int]
                WHEN x.byear >= 2010 AND pg_temp.rnd(x.k, 47) < 0.30 THEN
                    (ARRAY['Agoda','Booking.com','Expedia'])[1 + floor(pg_temp.rnd(x.k, 46) * 3)::int]
                WHEN x.byear >= 2008 AND pg_temp.rnd(x.k, 47) < 0.22 THEN
                    (ARRAY['Agoda','Booking.com'])[1 + floor(pg_temp.rnd(x.k, 46) * 2)::int]
                WHEN x.byear >= 2005 AND pg_temp.rnd(x.k, 47) < 0.12 THEN 'Agoda'
                WHEN pg_temp.rnd(x.k, 47) < 0.55 THEN 'โทรจอง'
                WHEN pg_temp.rnd(x.k, 47) < 0.72 THEN 'อีเมล'
                WHEN pg_temp.rnd(x.k, 47) < 0.90 THEN 'บริษัททัวร์'
                ELSE 'Corporate rate' END AS channel
    FROM x
)
SELECT y.*,
       -- แผนชำระ: prepaid = จ่ายเต็มตอนจอง, deposit = มัดจำคืนแรก, hotel = จ่ายที่โรงแรม
       CASE WHEN y.walkin THEN 'hotel'
            WHEN y.staff_id = y.online_id THEN (CASE WHEN pg_temp.rnd(y.k, 48) < 0.60 THEN 'prepaid' ELSE 'hotel' END)
            WHEN pg_temp.rnd(y.k, 48) < 0.55 THEN 'deposit'
            WHEN pg_temp.rnd(y.k, 48) < 0.70 THEN 'prepaid'
            ELSE 'hotel' END AS plan,
       -- จองแบบรอโอน (pending) แล้วยืนยันเมื่อเงินเข้า - ~12% ของการจองมัดจำที่เคาน์เตอร์
       (y.status = 'pending'
        OR (NOT y.walkin AND y.staff_id <> y.online_id AND pg_temp.rnd(y.k, 49) < 0.12)) AS opened_pending,
       concat_ws(' · ', y.channel,
                 CASE WHEN pg_temp.rnd(y.k, 50) < 0.15 THEN
                      (ARRAY['ขอห้องชั้นสูง','ขอห้องปลอดบุหรี่','ฉลองวันเกิด','ฉลองครบรอบแต่งงาน',
                             'ขอเตียงแยก','ขอห้องใกล้ลิฟต์','แพ้อาหารทะเล'])
                      [1 + floor(pg_temp.rnd(y.k, 56) * 7)::int] END,
                 CASE WHEN y.status = 'pending' THEN 'รอโอนมัดจำ'
                      WHEN y.noshow THEN 'No-show'
                      WHEN y.cancelled THEN
                      (ARRAY['ลูกค้ายกเลิกเอง','เปลี่ยนแผนเดินทาง','เที่ยวบินถูกยกเลิก','ติดธุระด่วน'])
                      [1 + floor(pg_temp.rnd(y.k, 57) * 4)::int] END) AS note
FROM y;
ALTER TABLE h_bf ADD PRIMARY KEY (k);
CREATE UNIQUE INDEX ON h_bf (bid);
ANALYZE h_bf;

SELECT status, count(*) FROM h_bf GROUP BY status ORDER BY 2 DESC;
SELECT (SELECT count(*) FROM h_task) AS tasks,
       (SELECT max(done_min) FROM h_sched) / 60.0 AS latest_finish_hour,
       (SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY done_min) FROM h_sched s
          JOIN h_task t USING (tid) WHERE NOT t.evening) / 60.0 AS p95_day_finish_hour;
