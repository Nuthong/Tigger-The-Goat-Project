-- =====================================================================
--  04_insert : ลูกค้า, การจอง, ห้องที่จอง (ราคาจาก fn_quote_room), บริการเสริม
-- =====================================================================
\echo '>> 04 customers, bookings, rooms, add-ons'

-- ---- รายชื่อ (ชื่อไทยมีตัวสะกดโรมันไว้ทำอีเมล) ------------------------
CREATE TEMP TABLE h_name (grp text, part text, i int, name text, roman text);
INSERT INTO h_name
SELECT 'TH', 'f', i, split_part(v, '|', 1), split_part(v, '|', 2)
FROM unnest(ARRAY[
  'สมชาย|somchai','สมศักดิ์|somsak','วิชัย|wichai','ประเสริฐ|prasert','สุรชัย|surachai',
  'อนันต์|anan','ธนพล|thanaphon','กิตติ|kitti','ชัยวัฒน์|chaiwat','ณัฐพงษ์|natthaphong',
  'พงศกร|phongsakon','วีระพงษ์|weeraphong','ศุภชัย|suphachai','อภิสิทธิ์|aphisit',
  'ธีรภัทร|thiraphat','ปิยะ|piya','จักรพันธ์|chakkraphan','เอกชัย|ekkachai','ภานุวัฒน์|phanuwat',
  'วรเชษฐ์|worachet','สุภาวดี|suphawadee','มาลี|malee','วันเพ็ญ|wanphen','ปรียา|preeya',
  'อรทัย|orathai','กาญจนา|kanchana','นภัสสร|naphatsorn','พิมพ์ชนก|pimchanok','ศิริพร|siriporn',
  'จิราภรณ์|jiraphon','ณัฐธิดา|natthida','กมลชนก|kamonchanok','ธิดารัตน์|thidarat','วรรณา|wanna',
  'สุนิสา|sunisa','อัญชลี|anchalee','เบญจมาศ|benjamat','ปวีณา|paweena','รัชนี|ratchanee',
  'ชลธิชา|chonthicha']) WITH ORDINALITY AS t(v, i);
INSERT INTO h_name
SELECT 'TH', 'l', i, split_part(v, '|', 1), split_part(v, '|', 2)
FROM unnest(ARRAY[
  'ใจดี|jaidee','แสงทอง|saengthong','ทองดี|thongdee','ศรีสุข|srisuk','บุญมา|boonma',
  'วงศ์สวัสดิ์|wongsawat','จันทร์เพ็ญ|chanphen','สุขเจริญ|sukcharoen','พรหมมา|phromma',
  'รุ่งเรือง|rungrueang','ชัยมงคล|chaimongkol','ทองคำ|thongkham','เพชรรัตน์|phetcharat',
  'มั่นคง|mankhong','ศรีวงศ์|sriwong','แก้วมณี|kaewmanee','นาคสวัสดิ์|naksawat','บุญเรือง|boonrueang',
  'อินทรสุวรรณ|intharasuwan','เจริญผล|charoenphon','ดวงแก้ว|duangkaew','พึ่งทอง|phuengthong',
  'สมบูรณ์|somboon','ประเสริฐศรี|prasertsri','กิตติวงศ์|kittiwong','วัฒนากุล|watthanakul',
  'ธนสาร|thanasan','ศักดิ์ดี|sakdee','พูนผล|poonphon','ทองแท้|thongthae']) WITH ORDINALITY AS t(v, i);
INSERT INTO h_name
SELECT g.grp, g.part, t.i, t.v, t.v
FROM (VALUES
  ('CN','f', ARRAY['Wei','Fang','Jing','Lei','Min','Jun','Yan','Hao','Xin','Yu','Hui','Ling',
                   'Qiang','Tao','Ying','Chen','Bo','Rui','Yue','Xiaoming','Lina','Zihan','Haoran','Yuxuan']),
  ('CN','l', ARRAY['Wang','Li','Zhang','Liu','Chen','Yang','Huang','Zhao','Wu','Zhou','Xu','Sun',
                   'Ma','Zhu','Hu','Guo','He','Lin','Gao','Luo']),
  ('JP','f', ARRAY['Haruto','Yuto','Sota','Kenji','Takumi','Daiki','Hiroshi','Takeshi','Yui','Sakura',
                   'Aoi','Hina','Yuki','Mei','Rin','Emi','Naoko','Keiko']),
  ('JP','l', ARRAY['Sato','Suzuki','Takahashi','Tanaka','Watanabe','Ito','Yamamoto','Nakamura',
                   'Kobayashi','Kato','Yoshida','Yamada','Sasaki','Matsumoto','Inoue','Kimura']),
  ('KR','f', ARRAY['Minjun','Seojun','Jiho','Hyunwoo','Doyun','Jiwoo','Seoyeon','Jiyoung','Minji',
                   'Soyeon','Hayoon','Yuna','Eunji','Jisoo']),
  ('KR','l', ARRAY['Kim','Lee','Park','Choi','Jung','Kang','Cho','Yoon','Jang','Lim','Han','Shin']),
  ('WE','f', ARRAY['James','Oliver','William','Thomas','Lucas','Daniel','Michael','David','Matteo',
                   'Luca','Pierre','Julien','Hans','Lukas','Erik','Sven','Emma','Olivia','Sophie',
                   'Charlotte','Mia','Hannah','Laura','Anna','Chloe','Isabella','Clara','Lea','Julia','Sarah']),
  ('WE','l', ARRAY['Smith','Johnson','Brown','Wilson','Taylor','Anderson','Thomas','Martin','Mueller',
                   'Schmidt','Schneider','Fischer','Weber','Dubois','Moreau','Laurent','Rossi','Bianchi',
                   'Garcia','Martinez','Jensen','Nielsen','Larsen','Johansson','Andersson','Murphy',
                   'Walker','Clarke','Evans','Hughes']),
  ('IN','f', ARRAY['Aarav','Vivaan','Arjun','Rohan','Rahul','Amit','Priya','Ananya','Diya','Kavya',
                   'Neha','Pooja','Sanjay','Vikram']),
  ('IN','l', ARRAY['Sharma','Patel','Singh','Kumar','Gupta','Reddy','Iyer','Nair','Mehta','Shah','Joshi','Rao']),
  ('AS','f', ARRAY['Minh','Linh','Anh','Huy','Siti','Nurul','Ahmad','Putri','Rizky','Maria','Jose',
                   'Mark','Angelica','Weiling','Junjie']),
  ('AS','l', ARRAY['Nguyen','Tran','Le','Pham','Tan','Lim','Wong','Santos','Reyes','Cruz','Hassan',
                   'Abdullah','Wijaya','Pratama','Rahman'])
) AS g(grp, part, arr)
CROSS JOIN LATERAL unnest(g.arr) WITH ORDINALITY AS t(v, i);
CREATE TEMP TABLE h_namecount AS SELECT grp, part, count(*)::int AS n FROM h_name GROUP BY 1, 2;

-- เลขบัตรประชาชนไทย 13 หลักพร้อมหลักตรวจสอบที่ถูกต้อง
CREATE FUNCTION pg_temp.thai_id(k bigint) RETURNS text
LANGUAGE sql STABLE AS $$
    WITH d AS (
        SELECT (1 + floor(pg_temp.rnd(k, 71) * 8))::int::text
               || lpad(floor(pg_temp.rnd(k, 72) * 1e11)::bigint::text, 11, '0') AS s
    )
    SELECT s || ((11 - (SELECT sum(substr(s, i, 1)::int * (14 - i))
                          FROM generate_series(1, 12) AS i) % 11) % 10)::text
    FROM d
$$;

-- ---- ลูกค้าใหม่: สัญชาติตามยุค (จีนโตขึ้นจนถึงปี 2019, ปี 2020-2022 เป็นคนไทยเกือบหมด) ----
CREATE TEMP TABLE h_cust AS
WITH c AS (
    SELECT m.cid, m.created_at,
           extract(year FROM m.created_at AT TIME ZONE 'Asia/Bangkok')::int AS y,
           pg_temp.rnd(m.cid, 61) AS u
    FROM h_custmap m
), w AS (
    SELECT c.*,
           ARRAY[CASE WHEN y IN (2020, 2021) THEN 80 WHEN y = 2022 THEN 45 ELSE 28 END,
                 CASE WHEN y <= 2019 THEN 4 + (y - 2000) WHEN y IN (2020, 2021) THEN 1
                      WHEN y = 2022 THEN 3 ELSE 12 END,
                 CASE WHEN y IN (2020, 2021) THEN 2 ELSE greatest(8, 16 - (y - 2000) * 0.35) END,
                 CASE WHEN y IN (2020, 2021) THEN 1 ELSE 4 + (y - 2000) * 0.15 END,
                 CASE WHEN y IN (2020, 2021) THEN 6 ELSE 30 - (y - 2000) * 0.3 END,
                 CASE WHEN y IN (2020, 2021) THEN 1 ELSE 3 + (y - 2000) * 0.2 END,
                 CASE WHEN y IN (2020, 2021) THEN 3 ELSE 8 END]::float8[] AS wt
    FROM c
)
SELECT w.cid, w.created_at,
       (SELECT a.g
          FROM unnest(ARRAY['TH','CN','JP','KR','WE','IN','AS']) WITH ORDINALITY AS a(g, i)
         WHERE (SELECT sum(x) FROM unnest(w.wt[1:a.i::int]) AS x)
               >= w.u * (SELECT sum(x) FROM unnest(w.wt) AS x)
         ORDER BY a.i LIMIT 1) AS grp
FROM w;

-- เลือกลำดับชื่อไว้ก่อน แล้วค่อย join ด้วยค่าเท่ากัน (hash join)
ALTER TABLE h_cust ADD COLUMN fi int, ADD COLUMN li int;
UPDATE h_cust c
   SET fi = 1 + floor(pg_temp.rnd(c.cid, 62) * nf.n)::int,
       li = 1 + floor(pg_temp.rnd(c.cid, 63) * nl.n)::int
  FROM h_namecount nf, h_namecount nl
 WHERE nf.grp = c.grp AND nf.part = 'f' AND nl.grp = c.grp AND nl.part = 'l';
ANALYZE h_cust;

-- ลูกค้าที่เคยเช็คอินจริง -> ฝ่ายต้อนรับบันทึกเลขบัตร/พาสปอร์ตแล้ว
CREATE TEMP TABLE h_checked_in AS
SELECT DISTINCT cust FROM h_bf WHERE status IN ('checked_in', 'checked_out');
CREATE UNIQUE INDEX ON h_checked_in (cust);
ANALYZE h_checked_in;

INSERT INTO customer (customer_id, first_name, last_name, email, phone, id_card_no, created_at)
SELECT c.cid, fn.name, ln.name,
       lower(regexp_replace(fn.roman, '[^A-Za-z]', '', 'g')) || '.'
       || lower(regexp_replace(ln.roman, '[^A-Za-z]', '', 'g')) || c.cid
       || '@example.' || (ARRAY['com','net','org'])[1 + floor(pg_temp.rnd(c.cid, 64) * 3)::int],
       CASE c.grp
            WHEN 'TH' THEN '0' || (ARRAY['6','8','9'])[1 + floor(pg_temp.rnd(c.cid, 65) * 3)::int]
                           || lpad(floor(pg_temp.rnd(c.cid, 66) * 1e8)::bigint::text, 8, '0')
            WHEN 'CN' THEN '+86 13' || lpad(floor(pg_temp.rnd(c.cid, 66) * 1e9)::bigint::text, 9, '0')
            WHEN 'JP' THEN '+81 90 ' || lpad(floor(pg_temp.rnd(c.cid, 66) * 1e4)::int::text, 4, '0')
                           || ' ' || lpad(floor(pg_temp.rnd(c.cid, 67) * 1e4)::int::text, 4, '0')
            WHEN 'KR' THEN '+82 10 ' || lpad(floor(pg_temp.rnd(c.cid, 66) * 1e4)::int::text, 4, '0')
                           || ' ' || lpad(floor(pg_temp.rnd(c.cid, 67) * 1e4)::int::text, 4, '0')
            WHEN 'WE' THEN (ARRAY['+44 7','+49 15','+33 6','+1 415','+61 4'])
                               [1 + floor(pg_temp.rnd(c.cid, 65) * 5)::int]
                           || lpad(floor(pg_temp.rnd(c.cid, 66) * 1e8)::bigint::text, 8, '0')
            WHEN 'IN' THEN '+91 9' || lpad(floor(pg_temp.rnd(c.cid, 66) * 1e9)::bigint::text, 9, '0')
            ELSE (ARRAY['+65 9','+84 9','+60 12','+63 917'])[1 + floor(pg_temp.rnd(c.cid, 65) * 4)::int]
                 || lpad(floor(pg_temp.rnd(c.cid, 66) * 1e7)::bigint::text, 7, '0')
       END,
       CASE WHEN ci.cust IS NULL THEN NULL
            WHEN c.grp = 'TH' THEN pg_temp.thai_id(c.cid)
            ELSE (CASE c.grp WHEN 'CN' THEN 'E' WHEN 'JP' THEN 'TK' WHEN 'KR' THEN 'M'
                             WHEN 'IN' THEN 'K' WHEN 'AS' THEN 'A' ELSE 'P' END)
                 || lpad(floor(pg_temp.rnd(c.cid, 73) * 1e8)::bigint::text, 8, '0')
       END,
       c.created_at
FROM h_cust c
JOIN h_name fn ON fn.grp = c.grp AND fn.part = 'f' AND fn.i = c.fi
JOIN h_name ln ON ln.grp = c.grp AND ln.part = 'l' AND ln.i = c.li
LEFT JOIN h_checked_in ci ON ci.cust = c.cid
ORDER BY c.cid;

-- ลูกค้าประชากรจำลองของ seed (ชื่ออังกฤษ) ที่เพิ่งได้เข้าพัก -> บันทึกพาสปอร์ต
UPDATE customer c
   SET id_card_no = 'P' || lpad(floor(pg_temp.rnd(c.customer_id, 73) * 1e8)::bigint::text, 8, '0')
  FROM h_checked_in ci
 WHERE ci.cust = c.customer_id AND c.customer_id <= (SELECT cust_base FROM h_param)
   AND c.customer_id > 12 AND c.id_card_no IS NULL;

SELECT setval(pg_get_serial_sequence('customer', 'customer_id'), (SELECT max(customer_id) FROM customer));

-- ---- การจอง ----------------------------------------------------------
INSERT INTO booking (booking_id, customer_id, staff_id, booking_date, check_in_date,
                     check_out_date, num_guests, status, note)
SELECT bid, cust, staff_id, b_at, ci, co, guests, status, note
FROM h_bf
ORDER BY bid;
SELECT setval(pg_get_serial_sequence('booking', 'booking_id'), (SELECT max(booking_id) FROM booking));

-- ---- ห้อง + ราคาต่อคืน (BR-6) = fn_quote_stay / จำนวนคืน แบบเดียวกับ nightly_rate_for ----
CREATE TEMP TABLE h_brp AS
SELECT b.k, b.bid, br.room_id, br.seq, hr.room_type_id, pr.price
FROM h_bf b
JOIN h_bkroom br USING (k)
JOIN h_room hr USING (room_id)
CROSS JOIN LATERAL (
    SELECT round(sum(p.price) / b.n, 2) AS price
    FROM h_price p
    WHERE p.room_type_id = hr.room_type_id AND p.d >= b.ci AND p.d < b.co
) pr;
CREATE INDEX ON h_brp (k);
ANALYZE h_brp;

INSERT INTO booking_room (booking_id, room_id, price_per_night)
SELECT bid, room_id, price FROM h_brp ORDER BY bid, seq;

INSERT INTO booking_service (booking_id, service_id, quantity, unit_price)
SELECT b.bid, s.service_id, s.qty, s.unit_price
FROM h_svc s JOIN h_bf b USING (k)
ORDER BY b.bid, s.service_id;

-- ยอดของแต่ละการจอง (ใช้ต่อในการชำระเงิน / ใบกำกับภาษี)
CREATE TEMP TABLE h_bill AS
SELECT b.k, b.bid,
       r.room_total, COALESCE(s.svc_total, 0) AS svc_total,
       COALESCE(s.pre_total, 0) AS pre_total,        -- บริการที่จองล่วงหน้า
       r.room_total + COALESCE(s.svc_total, 0) AS grand, r.first_night
FROM h_bf b
JOIN (SELECT p.k, sum(p.price * x.n) AS room_total, sum(p.price) AS first_night
      FROM h_brp p JOIN h_bf x USING (k) GROUP BY p.k) r USING (k)
LEFT JOIN (SELECT k, sum(qty * unit_price) AS svc_total,
                  sum(qty * unit_price) FILTER (WHERE service_id IN (1, 2, 4, 5)) AS pre_total
           FROM h_svc GROUP BY k) s USING (k);
ALTER TABLE h_bill ADD PRIMARY KEY (k);
ANALYZE h_bill;
