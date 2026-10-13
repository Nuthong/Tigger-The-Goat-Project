-- =====================================================================
--  07_audit : audit_log ย้อนหลังตามเวลาที่เกิดจริง
--  - การจอง: แถวเดียวกับที่ trigger aiu_booking_audit เขียน (booking.create /
--    booking.status_change, actor_user_id NULL, actor_label = username ผู้ทำ หรือ 'system')
--  - แถวที่แอปเขียนเอง: booking.no_show, invoice.issue, maintenance.report /
--    maintenance.status_change, rate_plan.create (actor_user_id เฉพาะคนที่ยังมีบัญชี)
--  งานแม่บ้านไม่เขียน audit ซ้ำ - ประวัติอยู่ใน housekeeping_task + room_status_log แล้ว
-- =====================================================================
\echo '>> 07 audit trail'

CREATE TEMP TABLE h_audit (at timestamptz, actor_user_id int, actor_label text, action text,
                           entity_type text, entity_id text, summary text, data jsonb);

-- ผู้ทำรายการแต่ละขั้นของการจอง
CREATE TEMP TABLE h_act AS
SELECT b.k, b.bid, b.status, b.cancelled, b.noshow, b.cust, b.staff_id, b.ci, b.co,
       b.b_at, b.in_at, b.out_at, b.cancel_at, p.pay1_at, p.open_status,
       CASE WHEN b.staff_id = (SELECT online_id FROM h_param) THEN 'system' ELSE sb.label END AS by_label,
       si.label AS in_label, so.label AS out_label,
       sc.label AS cancel_label, sc.user_id AS cancel_user
FROM h_bf b
JOIN h_pay1 p USING (k)
JOIN h_staff sb ON sb.staff_id = b.staff_id
JOIN h_staff si ON si.staff_id = b.in_staff
JOIN h_staff so ON so.staff_id = b.out_staff
LEFT JOIN h_roster rc ON b.cancelled AND rc.kind = 'desk'
                     AND rc.d = (b.cancel_at AT TIME ZONE 'Asia/Bangkok')::date
LEFT JOIN h_staff sc ON sc.staff_id = rc.ids[1 + floor(pg_temp.rnd(b.k, 131) * cardinality(rc.ids))::int];

-- booking.create
INSERT INTO h_audit
SELECT b_at, NULL, by_label, 'booking.create', 'booking', bid::text,
       format('การจอง #%s สถานะ %s', bid, open_status),
       jsonb_build_object('customer_id', cust, 'staff_id', staff_id, 'check_in', ci, 'check_out', co)
FROM h_act;

-- pending -> confirmed เมื่อเงินมัดจำเข้า
INSERT INTO h_audit
SELECT pay1_at, NULL, by_label, 'booking.status_change', 'booking', bid::text,
       format('การจอง #%s: %s -> %s', bid, 'pending', 'confirmed'),
       jsonb_build_object('from', 'pending', 'to', 'confirmed')
FROM h_act
WHERE open_status = 'pending' AND pay1_at IS NOT NULL;

-- เช็คอิน / เช็คเอาท์
INSERT INTO h_audit
SELECT in_at, NULL, in_label, 'booking.status_change', 'booking', bid::text,
       format('การจอง #%s: %s -> %s', bid, 'confirmed', 'checked_in'),
       jsonb_build_object('from', 'confirmed', 'to', 'checked_in')
FROM h_act WHERE status IN ('checked_in', 'checked_out');
INSERT INTO h_audit
SELECT out_at, NULL, out_label, 'booking.status_change', 'booking', bid::text,
       format('การจอง #%s: %s -> %s', bid, 'checked_in', 'checked_out'),
       jsonb_build_object('from', 'checked_in', 'to', 'checked_out')
FROM h_act WHERE status = 'checked_out';

-- ยกเลิก (จองออนไลน์ยกเลิกผ่านระบบ = system, นอกนั้นพนักงานเคาน์เตอร์) + no-show
INSERT INTO h_audit
SELECT a.cancel_at, NULL,
       CASE WHEN a.by_label = 'system' AND NOT a.noshow THEN 'system' ELSE a.cancel_label END,
       'booking.status_change', 'booking', a.bid::text,
       format('การจอง #%s: %s -> %s', a.bid,
              CASE WHEN a.pay1_at IS NULL AND a.open_status = 'pending' THEN 'pending' ELSE 'confirmed' END,
              'cancelled'),
       jsonb_build_object('from', CASE WHEN a.pay1_at IS NULL AND a.open_status = 'pending'
                                       THEN 'pending' ELSE 'confirmed' END,
                          'to', 'cancelled')
FROM h_act a WHERE a.cancelled;
INSERT INTO h_audit
SELECT a.cancel_at + INTERVAL '1 second', a.cancel_user, a.cancel_label, 'booking.no_show', 'booking',
       a.bid::text,
       format('%s %s did not arrive; first night kept as a fee', c.first_name, c.last_name), NULL
FROM h_act a JOIN customer c ON c.customer_id = a.cust
WHERE a.noshow;

-- ใบกำกับภาษี
INSERT INTO h_audit
SELECT i.issued_at, s.user_id, s.label, 'invoice.issue', 'invoice', m.invoice_id::text,
       format('%s · booking #%s', i.invoice_no, i.bid),
       jsonb_build_object('total', i.grand::text)
FROM h_inv i
JOIN h_invmap m USING (k)
JOIN h_staff s ON s.staff_id = i.out_staff;

-- งานซ่อม: แจ้ง -> เริ่มซ่อม -> ซ่อมเสร็จ -> ปิดงาน (หรือยกเลิกเพราะแจ้งซ้ำ)
INSERT INTO h_audit
SELECT t.rep_at, s.user_id, s.label, 'maintenance.report', 'maintenance_ticket', t.ticket_id::text,
       format('[%s] %s', t.prio, t.title), NULL
FROM h_ticket t JOIN h_staff s ON s.staff_id = t.reported_by;
INSERT INTO h_audit
SELECT t.rep_at + make_interval(mins => 10 + floor(pg_temp.rnd(t.fid, 132) * 30)::int),
       s.user_id, s.label, 'maintenance.status_change', 'maintenance_ticket', t.ticket_id::text,
       format('#%s → %s', t.ticket_id, 'in_progress'), NULL
FROM h_ticket t JOIN h_staff s ON s.staff_id = t.assigned_to
WHERE t.status <> 'cancelled';
INSERT INTO h_audit
SELECT t.res_at, s.user_id, s.label, 'maintenance.status_change', 'maintenance_ticket', t.ticket_id::text,
       format('#%s → %s', t.ticket_id, 'resolved'), NULL
FROM h_ticket t JOIN h_staff s ON s.staff_id = t.assigned_to
WHERE t.status IN ('resolved', 'closed');
INSERT INTO h_audit
SELECT t.res_at + INTERVAL '7 days' - make_interval(hours => floor(pg_temp.rnd(t.fid, 133) * 24)::int),
       s.user_id, s.label, 'maintenance.status_change', 'maintenance_ticket', t.ticket_id::text,
       format('#%s → %s', t.ticket_id, 'closed'), NULL
FROM h_ticket t
JOIN h_roster m ON m.kind = 'mgr'
               AND m.d = ((t.res_at + INTERVAL '6 days') AT TIME ZONE 'Asia/Bangkok')::date
JOIN h_staff s ON s.staff_id = m.ids[1]
WHERE t.status = 'closed';
INSERT INTO h_audit
SELECT t.rep_at + INTERVAL '1 hour', s.user_id, s.label, 'maintenance.status_change',
       'maintenance_ticket', t.ticket_id::text, format('#%s → %s', t.ticket_id, 'cancelled'), NULL
FROM h_ticket t JOIN h_staff s ON s.staff_id = t.assigned_to
WHERE t.status = 'cancelled';

-- rate plan รายปี: ผู้จัดการในเวลานั้นตั้งไว้ล่วงหน้า ~1 เดือน
INSERT INTO h_audit
SELECT CASE WHEN rp.valid_from - 30 < DATE '2000-01-01' THEN pg_temp.bkk(DATE '2000-01-01', 480)
            ELSE pg_temp.bkk(rp.valid_from - 30, 600) END,
       s.user_id, s.label, 'rate_plan.create', 'rate_plan',
       rp.rate_plan_id::text,
       format('%s · %s · %s', rp.name, rt.name, rp.price_per_night),
       jsonb_build_object('kind', rp.kind, 'priority', rp.priority)
FROM h_rate_plan_new n
JOIN rate_plan rp USING (rate_plan_id)
JOIN room_type rt USING (room_type_id)
JOIN h_roster m ON m.kind = 'mgr' AND m.d = greatest(rp.valid_from - 30, DATE '2000-01-01')
JOIN h_staff s ON s.staff_id = m.ids[1];

INSERT INTO audit_log (at, actor_user_id, actor_label, action, entity_type, entity_id, summary, data)
SELECT at, actor_user_id, actor_label, action, entity_type, entity_id, summary, data
FROM h_audit
ORDER BY at, action, entity_id;
