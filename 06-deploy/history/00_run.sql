-- =====================================================================
--  310-2209 Database Systems -- Mini-DB Group Project
--  history : ประวัติการดำเนินงานโรงแรม 2000-01-01 .. 2026-12-31
--
--  เติม "ข้อมูล" (แถว) ลงฐานที่โหลด schema.sql + roles.sql + seed.sql แล้ว
--  ไม่แตะโครงสร้างใด ๆ (ไม่มี CREATE TABLE / ALTER / INDEX ถาวร - ใช้แค่ temp table
--  และ pg_temp function ที่หายไปเองเมื่อจบ session)
--
--  ทุกอย่างสร้างจาก "การเข้าพัก" ชุดเดียวกัน จึงสัมพันธ์กันทั้งระบบ:
--    การจอง -> ห้อง (ไม่ซ้อนคืนกัน) -> บริการเสริม (ไม่เกิน BR-29) -> การชำระเงิน / คืนเงิน
--    -> ใบกำกับภาษี -> งานแม่บ้าน (ทำความสะอาดหลังเช็คเอาท์, รายวัน, turndown, deep clean)
--    -> งานซ่อม (ห้องปิดขายระหว่างซ่อม) -> room_status_log -> รีวิว -> audit_log
--  ราคาห้องทุกคืนมาจาก fn_quote_room / fn_quote_stay (rate plan รายปี 2000-2025)
--  จบด้วยชุดตรวจความถูกต้อง - ถ้าข้อใดไม่ผ่าน ทั้งหมด ROLLBACK
--
--  วิธีรัน (ต้องเป็น superuser เช่น postgres - ใช้ session_replication_role):
--    cd 06-deploy
--    docker compose run --rm db-loader          # (แนะนำ) เริ่มจาก seed สะอาด
--    docker compose run --rm history-loader     # รันไฟล์นี้
--  หรือ psql ตรง ๆ:
--    psql -U postgres -d roombooking -v ON_ERROR_STOP=1 -f 00_run.sql
--  ตัวเลือก:  -v scale=0.5   (ปริมาณความต้องการห้อง, 1.0 = อัตราเข้าพักจริง ~70%)
--            -v seed=42      (เปลี่ยนชุดสุ่ม - ค่าเดิมได้ผลเหมือนเดิมทุกครั้ง)
-- =====================================================================
\set ON_ERROR_STOP on
\pset pager off
\if :{?scale}
\else
    \set scale 1.0
\endif
\if :{?seed}
\else
    \set seed 20260923
\endif

\echo '>> history: scale=' :scale ' seed=' :seed
\timing on

BEGIN;
-- ค่าพารามิเตอร์ส่งเข้า DO block ผ่าน GUC (ตัวแปร psql ขยายใน $$...$$ ไม่ได้)
SELECT set_config('hist.scale', :'scale', true),
       set_config('hist.seed',  :'seed',  true);

\ir 01_setup.sql
\ir 02_sweep.sql
\ir 03_stays.sql
\ir 04_insert.sql
\ir 05_money.sql
\ir 06_operations.sql
\ir 07_audit.sql
\ir 08_verify.sql

COMMIT;
\timing off

\echo '>> ANALYZE (refresh planner statistics after the bulk load)'
ANALYZE;

\ir 09_summary.sql
