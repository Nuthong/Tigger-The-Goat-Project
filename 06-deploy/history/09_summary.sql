-- =====================================================================
--  09_summary : สรุปหลังนำเข้า (อ่านอย่างเดียว)
-- =====================================================================
\echo '>> 09 summary'

SELECT 'customer' AS "table", count(*) AS "rows" FROM customer
UNION ALL SELECT 'staff', count(*) FROM staff
UNION ALL SELECT 'booking', count(*) FROM booking
UNION ALL SELECT 'booking_room', count(*) FROM booking_room
UNION ALL SELECT 'booking_service', count(*) FROM booking_service
UNION ALL SELECT 'payment', count(*) FROM payment
UNION ALL SELECT 'invoice', count(*) FROM invoice
UNION ALL SELECT 'invoice_line', count(*) FROM invoice_line
UNION ALL SELECT 'review', count(*) FROM review
UNION ALL SELECT 'housekeeping_task', count(*) FROM housekeeping_task
UNION ALL SELECT 'maintenance_ticket', count(*) FROM maintenance_ticket
UNION ALL SELECT 'room_status_log', count(*) FROM room_status_log
UNION ALL SELECT 'rate_plan', count(*) FROM rate_plan
UNION ALL SELECT 'audit_log', count(*) FROM audit_log;

-- ภาพรวมรายปี: การจอง, อัตราเข้าพัก, รายได้ค่าห้อง, งานแม่บ้าน
WITH nights AS (
    SELECT extract(year FROM d)::int AS y, count(*) AS room_nights, sum(br.price_per_night) AS revenue
    FROM booking b
    JOIN booking_room br USING (booking_id)
    CROSS JOIN LATERAL generate_series(b.check_in_date, b.check_out_date - 1, INTERVAL '1 day') AS d
    WHERE b.status <> 'cancelled'
    GROUP BY 1
), bk AS (
    SELECT extract(year FROM check_in_date)::int AS y, count(*) AS bookings,
           count(*) FILTER (WHERE status = 'cancelled') AS cancelled
    FROM booking GROUP BY 1
), hk AS (
    SELECT extract(year FROM scheduled_for)::int AS y, count(*) AS tasks
    FROM housekeeping_task GROUP BY 1
)
SELECT bk.y AS year, bk.bookings, bk.cancelled,
       round(100.0 * n.room_nights / (155 * (make_date(bk.y + 1, 1, 1) - make_date(bk.y, 1, 1))), 1)
           AS occupancy_pct,
       round(n.revenue / 1e6, 1) AS room_revenue_mthb,
       hk.tasks AS housekeeping_tasks
FROM bk
LEFT JOIN nights n USING (y)
LEFT JOIN hk USING (y)
ORDER BY bk.y;

-- ภาระงานแม่บ้าน: เวลาที่งานสุดท้ายของแต่ละคนในแต่ละวันเสร็จ (เวลากรุงเทพฯ)
SELECT round(percentile_cont(0.50) WITHIN GROUP (ORDER BY h)::numeric, 2) AS median_finish_hour,
       round(percentile_cont(0.95) WITHIN GROUP (ORDER BY h)::numeric, 2) AS p95_finish_hour,
       round(100.0 * count(*) FILTER (WHERE h > 20) / count(*), 2)        AS pct_after_20h
FROM (SELECT extract(epoch FROM max(completed_at AT TIME ZONE 'Asia/Bangkok') - scheduled_for) / 3600 AS h
      FROM housekeeping_task
      WHERE completed_at IS NOT NULL AND task_type <> 'turndown'
      GROUP BY scheduled_for, assigned_to) z;

-- วันนี้ในระบบ
SELECT (SELECT count(*) FROM booking WHERE status = 'checked_in')                      AS in_house,
       (SELECT count(*) FROM booking WHERE status = 'confirmed' AND check_in_date = CURRENT_DATE)
                                                                                         AS arriving_today,
       (SELECT count(*) FROM housekeeping_task WHERE scheduled_for = CURRENT_DATE)       AS tasks_today,
       (SELECT count(*) FROM room WHERE status = 'cleaning')                             AS rooms_cleaning,
       (SELECT count(*) FROM maintenance_ticket WHERE status IN ('open', 'in_progress')) AS open_tickets;
