-- =====================================================================
--  310-2209 Database Systems -- Mini-DB Group Project
--  ระบบจองห้องพัก / Room Booking System
--  roles.sql : least-privilege DB roles สำหรับแอป (SECURITY.md DB-2)
--
--  รันหลัง schema.sql โดย superuser/owner :
--      psql -d roombooking -f roles.sql
--
--  แนวคิด : แอป FastAPI ต่อ DB ด้วย role "app_rw" (อ่าน/เขียนข้อมูลได้ แต่
--           แก้โครงสร้าง/DROP ไม่ได้ และไม่ใช่ superuser)
--           งานรายงาน/BI ต่อด้วย role "app_readonly" (อ่านอย่างเดียว)
--  ก่อน deploy จริง : เปลี่ยนรหัสผ่านให้เป็นค่าใน env ไม่ใช่ค่าในไฟล์นี้
-- =====================================================================

-- 1) สร้าง role (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
        CREATE ROLE app_rw LOGIN PASSWORD 'CHANGE_ME_rw';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
        CREATE ROLE app_readonly LOGIN PASSWORD 'CHANGE_ME_ro';
    END IF;
END $$;

-- 2) สิทธิ์ระดับ database / schema
-- ใช้ current_database() แทนตัวแปร psql จึงรันได้ทั้งใน psql และ Query Tool ของ pgAdmin
DO $$
BEGIN
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_rw, app_readonly', current_database());
END $$;
GRANT USAGE   ON SCHEMA public       TO app_rw, app_readonly;

-- ทั้งสอง role ห้ามสร้าง object ใน schema (สร้าง/ลบตารางไม่ได้)
REVOKE CREATE ON SCHEMA public FROM app_rw, app_readonly;

-- 3) app_rw : DML เท่านั้น (ไม่มี DDL)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO app_rw;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA public TO app_rw;
-- ให้ครอบตารางที่จะสร้างเพิ่มในอนาคตด้วย
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO app_rw;

-- 4) app_readonly : อ่านอย่างเดียว
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT ON TABLES TO app_readonly;

-- 5) (ออปชัน — โชว์ในพรีเซนต์) Row-Level Security
--    ให้ role ลูกค้าเห็นเฉพาะการจองของตัวเอง แม้ query ตรง ๆ
--
-- ALTER TABLE booking ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY booking_customer_isolation ON booking
--     FOR SELECT TO app_rw
--     USING (customer_id = current_setting('app.current_customer_id', true)::int);
--   -- แอปต้องตั้งค่า:  SET app.current_customer_id = '<id>';  ต่อ request
--
-- หมายเหตุ Neon/บริการ managed บางเจ้าจำกัดการ CREATE ROLE — ใช้ role ที่ระบบให้มา
--          แล้ว GRANT ตามข้อ 3–4 แทน

-- ตรวจผล:
--   \du                                   -- ดู role
--   SET ROLE app_rw;  DROP TABLE room;     -- ต้องได้ ERROR: permission denied
--   RESET ROLE;
