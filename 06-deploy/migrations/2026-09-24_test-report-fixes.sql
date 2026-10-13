-- =====================================================================
--  Migration 2026-09-24 : fixes from TEST_REPORT_v2 (H1-H4, M1-M3, M8, L7)
--  for a database that already holds data (e.g. the 27-year history).
--  A fresh `docker compose run --rm db-loader` needs none of this - it loads
--  03-database/schema.sql, which already contains every change below.
--  Every view / function / trigger here is copied verbatim from schema.sql.
--
--  Run as the owner (postgres), once:
--    psql -h localhost -p 5433 -U postgres -d roombooking -f 06-deploy/migrations/2026-09-24_test-report-fixes.sql
--  All-or-nothing: any error rolls the whole migration back.
-- =====================================================================
\set ON_ERROR_STOP on
BEGIN;

-- ---- pre-checks: refuse to run if the data would break a new rule ------
DO $$
BEGIN
    IF EXISTS (SELECT customer_id FROM app_user WHERE customer_id IS NOT NULL
               GROUP BY customer_id HAVING COUNT(*) > 1)
       OR EXISTS (SELECT staff_id FROM app_user WHERE staff_id IS NOT NULL
                  GROUP BY staff_id HAVING COUNT(*) > 1) THEN
        RAISE EXCEPTION 'a customer or staff member has two logins - resolve before migrating';
    END IF;
    IF EXISTS (SELECT 1 FROM invoice_line WHERE amount <> ROUND(quantity * unit_price, 2)) THEN
        RAISE EXCEPTION 'invoice_line.amount differs from quantity x unit_price - resolve first';
    END IF;
    IF EXISTS (SELECT 1 FROM app_user u JOIN staff s USING (staff_id) WHERE u.role <> s.role) THEN
        RAISE EXCEPTION 'app_user.role and staff.role disagree - resolve before migrating';
    END IF;
END $$;

-- ---- M3 : one login per person (customer/staff 1 : 0..1 app_user) -------
DROP INDEX IF EXISTS idx_app_user_customer;
DROP INDEX IF EXISTS idx_app_user_staff;
ALTER TABLE app_user DROP CONSTRAINT IF EXISTS uq_app_user_customer;
ALTER TABLE app_user DROP CONSTRAINT IF EXISTS uq_app_user_staff;
ALTER TABLE app_user ADD CONSTRAINT uq_app_user_customer UNIQUE (customer_id);
ALTER TABLE app_user ADD CONSTRAINT uq_app_user_staff    UNIQUE (staff_id);

-- ---- M1 : void-and-reissue (one live invoice per booking) ---------------
ALTER TABLE invoice DROP CONSTRAINT IF EXISTS invoice_booking_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_active_booking ON invoice (booking_id) WHERE status <> 'void';
CREATE INDEX IF NOT EXISTS idx_invoice_booking ON invoice (booking_id);

-- ---- invoice_line.amount is derived: keep it consistent -----------------
ALTER TABLE invoice_line DROP CONSTRAINT IF EXISTS chk_invoice_line_amount;
ALTER TABLE invoice_line ADD CONSTRAINT chk_invoice_line_amount
    CHECK (amount = ROUND(quantity * unit_price, 2));

-- ---- L7 : an index on every foreign-key column --------------------------
-- ทุกคอลัมน์ FK มี index: ใช้ตอน join จากฝั่งแม่ และตอนตรวจ ON DELETE ไม่ต้องสแกนทั้งตาราง
CREATE INDEX IF NOT EXISTS idx_booking_staff          ON booking (staff_id);
CREATE INDEX IF NOT EXISTS idx_booking_service_svc    ON booking_service (service_id);
CREATE INDEX IF NOT EXISTS idx_rsl_room               ON room_status_log (room_id);
CREATE INDEX IF NOT EXISTS idx_rsl_changed_by         ON room_status_log (changed_by);
CREATE INDEX IF NOT EXISTS idx_invoice_issued_by      ON invoice (issued_by);
CREATE INDEX IF NOT EXISTS idx_hk_booking             ON housekeeping_task (booking_id);
CREATE INDEX IF NOT EXISTS idx_hk_assigned            ON housekeeping_task (assigned_to);
CREATE INDEX IF NOT EXISTS idx_mt_reported_by         ON maintenance_ticket (reported_by);
CREATE INDEX IF NOT EXISTS idx_mt_assigned            ON maintenance_ticket (assigned_to);
CREATE INDEX IF NOT EXISTS idx_audit_actor            ON audit_log (actor_user_id);

-- ---- H4 + M8 : money views follow BR-9 and filter per booking -----------
DROP VIEW IF EXISTS v_booking_bill;
CREATE VIEW v_booking_bill AS
SELECT
    b.booking_id,
    b.customer_id,
    c.first_name || ' ' || c.last_name                       AS customer_name,
    b.check_in_date,
    b.check_out_date,
    (b.check_out_date - b.check_in_date)                     AS nights,
    r.room_total,
    s.service_total,
    r.room_total + s.service_total                          AS grand_total,
    p.paid_total,
    p.refunded_total,
    CASE WHEN b.status = 'cancelled' THEN 0
         ELSE r.room_total + s.service_total - p.paid_total + p.refunded_total
    END                                                     AS balance_due
FROM booking b
JOIN customer c ON c.customer_id = b.customer_id
CROSS JOIN LATERAL (
    SELECT COALESCE(SUM(br.price_per_night), 0)
           * (b.check_out_date - b.check_in_date)          AS room_total
    FROM booking_room br
    WHERE br.booking_id = b.booking_id
) r
CROSS JOIN LATERAL (
    SELECT COALESCE(SUM(bs.quantity * bs.unit_price), 0)    AS service_total
    FROM booking_service bs
    WHERE bs.booking_id = b.booking_id
) s
CROSS JOIN LATERAL (
    SELECT COALESCE(SUM(pm.amount) FILTER (WHERE pm.status = 'paid'), 0)     AS paid_total,
           COALESCE(SUM(pm.amount) FILTER (WHERE pm.status = 'refunded'), 0) AS refunded_total
    FROM payment pm
    WHERE pm.booking_id = b.booking_id
) p;

DROP VIEW IF EXISTS v_invoice_summary;
CREATE VIEW v_invoice_summary AS
SELECT
    i.invoice_id,
    i.invoice_no,
    i.booking_id,
    c.first_name || ' ' || c.last_name        AS customer_name,
    i.issued_at,
    i.status,
    i.subtotal,
    i.tax_amount,
    i.total,
    COALESCE(p.paid_total, 0)                 AS paid_total,
    COALESCE(p.refunded_total, 0)             AS refunded_total,
    -- สูตรเดียวกับ BR-9: คืนเงินแล้วบวกกลับ ; ใบที่ void หรือการจองที่ยกเลิกไม่มียอดค้าง
    CASE WHEN i.status = 'void' OR b.status = 'cancelled' THEN 0
         ELSE i.total - COALESCE(p.paid_total, 0) + COALESCE(p.refunded_total, 0)
    END                                       AS balance_due
FROM invoice i
JOIN booking  b ON b.booking_id  = i.booking_id
JOIN customer c ON c.customer_id = b.customer_id
-- ทะเบียนใบแจ้งหนี้อ่านทีละหลายพันใบ จึงรวมยอดชำระแบบ GROUP BY ครั้งเดียวทั้งตาราง
LEFT JOIN (
    SELECT booking_id,
           SUM(amount) FILTER (WHERE status = 'paid')     AS paid_total,
           SUM(amount) FILTER (WHERE status = 'refunded') AS refunded_total
    FROM payment
    GROUP BY booking_id
) p ON p.booking_id = i.booking_id;

GRANT SELECT ON v_booking_bill, v_invoice_summary TO app_rw, app_readonly;

-- ---- H1 : the BR-5 trigger serializes per room --------------------------
CREATE OR REPLACE FUNCTION trg_check_room_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_check_in  DATE;
    v_check_out DATE;
    v_conflict  INT;
    v_status    VARCHAR(20);
BEGIN
    -- ดึงช่วงวันและสถานะของการจองที่แถวนี้อ้างถึง
    SELECT check_in_date, check_out_date, status
      INTO v_check_in, v_check_out, v_status
    FROM booking
    WHERE booking_id = NEW.booking_id;

    -- การจองที่ยกเลิกแล้วไม่ได้ครองห้อง จึงไม่ต้องตรวจ
    IF v_status = 'cancelled' THEN
        RETURN NEW;
    END IF;

    -- กัน race condition: ภายใต้ READ COMMITTED สอง transaction ที่จองห้องเดียวกันพร้อมกัน
    -- จะมองไม่เห็นแถวที่อีกฝ่ายยังไม่ commit ทั้งคู่จึงนับได้ 0 (write skew)
    -- lock ต่อห้องจนจบ transaction ทำให้คนที่สองต้องรอ แล้ว COUNT ด้านล่าง
    -- (snapshot ใหม่ทุก statement) จะเห็นแถวที่คนแรก commit แล้ว
    PERFORM pg_advisory_xact_lock(5, NEW.room_id);

    SELECT COUNT(*)
      INTO v_conflict
    FROM booking_room br
    JOIN booking b ON b.booking_id = br.booking_id
    WHERE br.room_id = NEW.room_id
      AND br.booking_id <> NEW.booking_id
      AND b.status IN ('pending','confirmed','checked_in')
      AND b.check_in_date < v_check_out
      AND v_check_in      < b.check_out_date;

    IF v_conflict > 0 THEN
        RAISE EXCEPTION 'ห้อง room_id=% ถูกจองในช่วงวันที่ % ถึง % แล้ว (double booking)',
            NEW.room_id, v_check_in, v_check_out;
    END IF;

    RETURN NEW;
END;
$$;

-- ---- H2 : the same rule when booking dates or status change -------------
CREATE OR REPLACE FUNCTION trg_check_booking_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_room     INT;
    v_conflict INT;
BEGIN
    -- ตรวจเฉพาะเมื่อการจองยังครองห้อง และวันที่เปลี่ยนหรือเพิ่งกลับมาใช้จากสถานะยกเลิก
    IF NEW.status = 'cancelled'
       OR (NEW.check_in_date  = OLD.check_in_date
           AND NEW.check_out_date = OLD.check_out_date
           AND OLD.status <> 'cancelled') THEN
        RETURN NEW;
    END IF;

    FOR v_room IN
        SELECT room_id FROM booking_room WHERE booking_id = NEW.booking_id ORDER BY room_id
    LOOP
        PERFORM pg_advisory_xact_lock(5, v_room);   -- lock เดียวกับ trigger ของ booking_room

        SELECT COUNT(*)
          INTO v_conflict
        FROM booking_room br
        JOIN booking b ON b.booking_id = br.booking_id
        WHERE br.room_id = v_room
          AND br.booking_id <> NEW.booking_id
          AND b.status IN ('pending','confirmed','checked_in')
          AND b.check_in_date  < NEW.check_out_date
          AND NEW.check_in_date < b.check_out_date;

        IF v_conflict > 0 THEN
            RAISE EXCEPTION 'ห้อง room_id=% ถูกจองในช่วงวันที่ % ถึง % แล้ว (double booking)',
                v_room, NEW.check_in_date, NEW.check_out_date;
        END IF;
    END LOOP;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bu_booking_no_overlap ON booking;
CREATE TRIGGER bu_booking_no_overlap
BEFORE UPDATE OF check_in_date, check_out_date, status ON booking
FOR EACH ROW
EXECUTE FUNCTION trg_check_booking_overlap();

-- ---- M2 : staff.role and app_user.role stay equal ------------------------
CREATE OR REPLACE FUNCTION trg_sync_role_from_user()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.staff_id IS NOT NULL THEN
        UPDATE staff
           SET role = NEW.role
         WHERE staff_id = NEW.staff_id
           AND role IS DISTINCT FROM NEW.role;
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS aiu_app_user_role_sync ON app_user;
CREATE TRIGGER aiu_app_user_role_sync
AFTER INSERT OR UPDATE OF role, staff_id ON app_user
FOR EACH ROW
EXECUTE FUNCTION trg_sync_role_from_user();

CREATE OR REPLACE FUNCTION trg_sync_role_from_staff()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE app_user
       SET role = NEW.role
     WHERE staff_id = NEW.staff_id
       AND role IS DISTINCT FROM NEW.role;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS au_staff_role_sync ON staff;
CREATE TRIGGER au_staff_role_sync
AFTER UPDATE OF role ON staff
FOR EACH ROW
EXECUTE FUNCTION trg_sync_role_from_staff();

COMMIT;

ANALYZE app_user;
ANALYZE invoice;
ANALYZE invoice_line;
