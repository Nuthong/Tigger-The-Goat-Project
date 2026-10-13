-- =====================================================================
--  05_money : การชำระเงิน / คืนเงิน และใบกำกับภาษี
--  - prepaid : จ่ายค่าห้อง + บริการที่จองล่วงหน้าตอนจอง, ส่วนที่ใช้ระหว่างพักจ่ายตอนเช็คเอาท์
--  - deposit : มัดจำค่าคืนแรก (เปิดเป็น pending -> confirmed เมื่อเงินเข้า), ที่เหลือจ่ายตอนเช็คเอาท์
--  - hotel   : จ่ายทั้งหมดตอนเช็คเอาท์
--  ยกเลิกก่อนเส้นตาย (check-in 00:00 UTC - 48 ชม. แบบเดียวกับแอป) คืนเต็ม,
--  หลังเส้นตาย / no-show เก็บค่าคืนแรกเป็นค่าธรรมเนียม
--  เช็คเอาท์แล้ว = จ่ายครบพอดี (balance 0) -> ออกใบกำกับภาษีสถานะ paid
-- =====================================================================
\echo '>> 05 payments, refunds, invoices'

-- เวลาชำระงวดแรก และสถานะตอนเปิดการจอง
CREATE TEMP TABLE h_pay1 AS
WITH a AS (
    SELECT b.k, b.bid, b.status, b.plan, b.b_at, b.in_at, b.out_at, b.cancel_at, b.cancelled,
           b.noshow, b.ci, b.staff_id, b.walkin, b.t_now,
           (b.opened_pending AND b.plan <> 'hotel') AS wait_money,
           bl.grand, bl.room_total, bl.pre_total, bl.first_night
    FROM h_bf b JOIN h_bill bl USING (k)
)
SELECT a.*,
       CASE WHEN a.plan = 'hotel' OR a.status = 'pending' THEN NULL
            WHEN a.wait_money
                 THEN least(a.b_at + make_interval(mins => 120 + floor(pg_temp.rnd(a.k, 81) * 2760)::int),
                            a.in_at - INTERVAL '1 hour')
            ELSE a.b_at + make_interval(mins => 1 + floor(pg_temp.rnd(a.k, 81) * 20)::int)
       END AS pay1_raw
FROM a;
ALTER TABLE h_pay1 ADD COLUMN pay1_at timestamptz;
UPDATE h_pay1 SET pay1_at = CASE
    WHEN pay1_raw IS NULL THEN NULL
    WHEN pay1_raw <= b_at THEN b_at + INTERVAL '10 minutes'
    ELSE pay1_raw END;
-- ไม่มีเงินเข้าถ้ายกเลิกก่อน หรือยังไม่ถึงเวลา
UPDATE h_pay1 SET pay1_at = NULL
 WHERE pay1_at IS NOT NULL
   AND (pay1_at > t_now OR (cancelled AND pay1_at >= cancel_at));
ALTER TABLE h_pay1 ADD COLUMN open_status text;
UPDATE h_pay1 SET open_status = CASE
    WHEN status = 'pending' THEN 'pending'
    WHEN wait_money THEN 'pending'
    ELSE 'confirmed' END;
ALTER TABLE h_pay1 ADD PRIMARY KEY (k);

-- เปิดเป็น pending แล้วเงินยังไม่เข้า ณ ตอนนี้ = ยัง pending อยู่ (ไม่ใช่ confirmed)
UPDATE h_bf b SET status = 'pending', note = concat_ws(' · ', b.note, 'รอโอนมัดจำ')
  FROM h_pay1 p
 WHERE p.k = b.k AND p.wait_money AND p.pay1_at IS NULL AND b.status = 'confirmed';
UPDATE booking bk SET status = 'pending', note = b.note
  FROM h_bf b
 WHERE bk.booking_id = b.bid AND b.status = 'pending' AND bk.status <> 'pending';
UPDATE h_pay1 p SET status = 'pending' FROM h_bf b WHERE b.k = p.k AND b.status = 'pending';

-- ช่องทางชำระตามยุค (PromptPay เริ่มปี 2017)
CREATE FUNCTION pg_temp.pay_method(k bigint, salt int, at timestamptz) RETURNS text
LANGUAGE sql STABLE AS $$
    SELECT CASE
        WHEN y < 2010 THEN (CASE WHEN u < 0.45 THEN 'cash' WHEN u < 0.85 THEN 'credit_card' ELSE 'bank_transfer' END)
        WHEN y < 2017 THEN (CASE WHEN u < 0.35 THEN 'cash' WHEN u < 0.85 THEN 'credit_card' ELSE 'bank_transfer' END)
        WHEN y < 2020 THEN (CASE WHEN u < 0.20 THEN 'cash' WHEN u < 0.65 THEN 'credit_card'
                                 WHEN u < 0.75 THEN 'bank_transfer' ELSE 'promptpay' END)
        ELSE (CASE WHEN u < 0.10 THEN 'cash' WHEN u < 0.55 THEN 'credit_card'
                   WHEN u < 0.65 THEN 'bank_transfer' ELSE 'promptpay' END)
    END
    FROM (SELECT extract(year FROM at AT TIME ZONE 'Asia/Bangkok')::int AS y,
                 pg_temp.rnd(k, salt) AS u) z
$$;

CREATE TEMP TABLE h_pay (
    k int, bid int, amount numeric(10,2), method text, status text, paid_at timestamptz, kind text
);

-- งวดแรก (prepaid = ค่าห้อง + บริการจองล่วงหน้า, deposit = ค่าคืนแรก)
INSERT INTO h_pay
SELECT p.k, p.bid,
       CASE p.plan WHEN 'prepaid' THEN p.room_total + p.pre_total ELSE p.first_night END,
       CASE WHEN p.staff_id = (SELECT online_id FROM h_param) THEN 'credit_card'
            ELSE pg_temp.pay_method(p.k, 82, p.pay1_at) END,
       'paid', p.pay1_at, 'first'
FROM h_pay1 p
WHERE p.pay1_at IS NOT NULL;

-- ส่วนที่เหลือตอนเช็คเอาท์
INSERT INTO h_pay
SELECT p.k, p.bid, p.grand - COALESCE(f.amount, 0),
       pg_temp.pay_method(p.k, 83, p.out_at), 'paid',
       p.out_at - make_interval(mins => 2 + floor(pg_temp.rnd(p.k, 84) * 9)::int), 'final'
FROM h_pay1 p
LEFT JOIN h_pay f ON f.k = p.k AND f.kind = 'first'
WHERE p.status = 'checked_out' AND p.grand - COALESCE(f.amount, 0) > 0;

-- คืนเงินเมื่อยกเลิก (REFUND-<booking_id> แบบเดียวกับแอป)
INSERT INTO h_pay
SELECT p.k, p.bid,
       f.amount - CASE WHEN p.noshow
                            OR p.cancel_at >= (p.ci::timestamp AT TIME ZONE 'UTC') - INTERVAL '48 hours'
                       THEN least(p.first_night, f.amount) ELSE 0 END,
       f.method, 'refunded', p.cancel_at, 'refund'
FROM h_pay1 p
JOIN h_pay f ON f.k = p.k AND f.kind = 'first'
WHERE p.cancelled;
DELETE FROM h_pay WHERE kind = 'refund' AND amount <= 0;

-- บัตรถูกปฏิเสธก่อนรูดผ่าน ~2%
INSERT INTO h_pay
SELECT k, bid, amount, 'credit_card', 'failed', NULL, 'failed'
FROM h_pay
WHERE method = 'credit_card' AND status = 'paid' AND pg_temp.rnd(k, 85) < 0.02;

INSERT INTO payment (booking_id, amount, method, status, paid_at, reference_no)
SELECT p.bid, p.amount, p.method, p.status, p.paid_at,
       CASE WHEN p.status = 'failed' THEN NULL
            WHEN p.kind = 'refund' THEN 'REFUND-' || p.bid
            WHEN p.method = 'cash' THEN
                 'RCPT-' || extract(year FROM p.paid_at AT TIME ZONE 'Asia/Bangkok') || '-'
                 || lpad(row_number() OVER (PARTITION BY p.method = 'cash' AND p.kind <> 'refund',
                                                 extract(year FROM p.paid_at AT TIME ZONE 'Asia/Bangkok')
                                            ORDER BY p.paid_at, p.bid)::text, 6, '0')
            WHEN p.method = 'credit_card' THEN 'CC-' || lpad(floor(pg_temp.rnd(p.k * 4 + 1, 86) * 1e6)::int::text, 6, '0')
            WHEN p.method = 'bank_transfer' THEN 'TRF-' || lpad(floor(pg_temp.rnd(p.k * 4 + 2, 86) * 1e8)::bigint::text, 8, '0')
            ELSE 'PP-' || lpad(floor(pg_temp.rnd(p.k * 4 + 3, 86) * 1e10)::bigint::text, 10, '0')
       END
FROM h_pay p
ORDER BY p.bid, p.paid_at NULLS FIRST, p.kind;

-- ---- ใบกำกับภาษี: ออกตอนเช็คเอาท์โดยพนักงานเคาน์เตอร์ (FR-23), VAT 7% รวมในราคา ----
CREATE TEMP TABLE h_inv AS
WITH x AS (
    SELECT b.k, b.bid, b.out_staff,
           b.out_at + make_interval(mins => 1 + floor(pg_temp.rnd(b.k, 87) * 6)::int) AS issued_at,
           bl.grand
    FROM h_bf b JOIN h_bill bl USING (k)
    WHERE b.status = 'checked_out'
), y AS (
    SELECT x.*, extract(year FROM x.issued_at AT TIME ZONE 'UTC')::int AS iy FROM x
), used AS (                 -- เลขที่ใบกำกับที่มีอยู่แล้วในแต่ละปี (เช่นของ seed ปี 2026)
    SELECT split_part(invoice_no, '-', 2)::int AS iy, max(split_part(invoice_no, '-', 3)::int) AS last_no
    FROM invoice WHERE invoice_no ~ '^INV-[0-9]{4}-[0-9]+$' GROUP BY 1
)
SELECT y.*,
       'INV-' || y.iy || '-' || lpad((row_number() OVER (PARTITION BY y.iy ORDER BY y.issued_at, y.bid)
             + COALESCE(u.last_no, 0))::text, 5, '0') AS invoice_no,
       round(y.grand / 1.07, 2)          AS subtotal,
       y.grand - round(y.grand / 1.07, 2) AS tax_amount
FROM y LEFT JOIN used u USING (iy);
ALTER TABLE h_inv ADD PRIMARY KEY (k);

INSERT INTO invoice (booking_id, invoice_no, issued_by, issued_at, status, tax_rate,
                     subtotal, tax_amount, total, note)
SELECT bid, invoice_no, out_staff, issued_at, 'paid', 0.0700, subtotal, tax_amount, grand, NULL
FROM h_inv
ORDER BY issued_at, bid;

CREATE TEMP TABLE h_invmap AS
SELECT i.invoice_id, h.k, h.bid FROM invoice i JOIN h_inv h ON h.bid = i.booking_id;
ALTER TABLE h_invmap ADD PRIMARY KEY (k);

-- รายการในใบกำกับ: ห้องตามลำดับ แล้วตามด้วยบริการ (ข้อความรูปแบบเดียวกับ issue_invoice ของแอป)
INSERT INTO invoice_line (invoice_id, line_no, line_type, description, quantity, unit_price, amount)
SELECT m.invoice_id,
       row_number() OVER (PARTITION BY m.invoice_id ORDER BY l.ord, l.sub),
       l.line_type, l.description, l.qty, l.unit_price, l.amount
FROM h_invmap m
JOIN (
    SELECT r.k, 1 AS ord, r.seq AS sub, 'room' AS line_type,
           hr.type_name || ' (' || hr.room_number || ') · ' || b.n || ' nights' AS description,
           b.n::numeric AS qty, r.price AS unit_price, r.price * b.n AS amount
    FROM h_brp r JOIN h_bf b USING (k) JOIN h_room hr ON hr.room_id = r.room_id
    UNION ALL
    SELECT s.k, 2, s.service_id, 'service', sv.name, s.qty::numeric, s.unit_price, s.qty * s.unit_price
    FROM h_svc s JOIN service sv USING (service_id)
) l ON l.k = m.k;
