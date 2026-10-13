-- =====================================================================
--  310-2209 Database Systems -- Mini-DB Group Project
--  ระบบจองห้องพัก / Room Booking System
--  schema.sql : DDL (โครงสร้างฐานข้อมูล + constraint + index + view + function + trigger)
--  DBMS      : PostgreSQL 16
--  วิธีรัน    : psql -U postgres -d roombooking -f schema.sql
-- =====================================================================

-- ส่วนขยายที่ใช้: pgcrypto -> crypt()/gen_salt() สำหรับ bcrypt hash ใน seed.sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ลบของเดิม (ตอนพัฒนา รันซ้ำได้) -- เรียงจากลูกไปแม่
DROP VIEW  IF EXISTS v_invoice_summary        CASCADE;
DROP VIEW  IF EXISTS v_daily_revenue          CASCADE;
DROP VIEW  IF EXISTS v_maintenance_open       CASCADE;
DROP VIEW  IF EXISTS v_housekeeping_board     CASCADE;
DROP VIEW  IF EXISTS v_room_type_revenue      CASCADE;
DROP VIEW  IF EXISTS v_current_guests         CASCADE;
DROP VIEW  IF EXISTS v_booking_bill           CASCADE;
DROP TABLE IF EXISTS audit_log                CASCADE;
DROP TABLE IF EXISTS maintenance_ticket       CASCADE;
DROP TABLE IF EXISTS housekeeping_task        CASCADE;
DROP TABLE IF EXISTS invoice_line             CASCADE;
DROP TABLE IF EXISTS invoice                  CASCADE;
DROP TABLE IF EXISTS rate_plan                CASCADE;
DROP TABLE IF EXISTS auth_event               CASCADE;
DROP TABLE IF EXISTS app_user                 CASCADE;
DROP TABLE IF EXISTS room_status_log          CASCADE;
DROP TABLE IF EXISTS review                   CASCADE;
DROP TABLE IF EXISTS payment                  CASCADE;
DROP TABLE IF EXISTS booking_service          CASCADE;
DROP TABLE IF EXISTS booking_room             CASCADE;
DROP TABLE IF EXISTS booking                  CASCADE;
DROP TABLE IF EXISTS service                  CASCADE;
DROP TABLE IF EXISTS room                     CASCADE;
DROP TABLE IF EXISTS room_type                CASCADE;
DROP TABLE IF EXISTS staff                    CASCADE;
DROP TABLE IF EXISTS customer                 CASCADE;
DROP FUNCTION IF EXISTS fn_quote_stay(INT, DATE, DATE)  CASCADE;
DROP FUNCTION IF EXISTS fn_quote_room(INT, DATE)        CASCADE;

-- =====================================================================
--  1) ตารางหลัก (master / lookup)
-- =====================================================================

CREATE TABLE room_type (
    room_type_id          SERIAL       PRIMARY KEY,
    name                  VARCHAR(50)  NOT NULL UNIQUE,
    description           VARCHAR(255),
    base_price_per_night  NUMERIC(10,2) NOT NULL CHECK (base_price_per_night >= 0),
    max_occupancy         INT          NOT NULL CHECK (max_occupancy > 0)
);

CREATE TABLE room (
    room_id       SERIAL       PRIMARY KEY,
    room_number   VARCHAR(10)  NOT NULL UNIQUE,
    floor         INT          NOT NULL CHECK (floor >= 0),
    room_type_id  INT          NOT NULL
                  REFERENCES room_type(room_type_id) ON DELETE RESTRICT,
    -- สถานะ "ทางกายภาพ" ของห้อง (ว่าง/กำลังทำความสะอาด/ปิดซ่อม/ปิดใช้งาน)
    -- ส่วน "จองแล้ว/เข้าพักอยู่" ดูจากตาราง booking ไม่เก็บซ้ำที่นี่
    status        VARCHAR(20)  NOT NULL DEFAULT 'available'
                  CHECK (status IN ('available','cleaning','maintenance','closed')),
    note          VARCHAR(255)
);

CREATE TABLE customer (
    customer_id  SERIAL       PRIMARY KEY,
    first_name   VARCHAR(60)  NOT NULL,
    last_name    VARCHAR(60)  NOT NULL,
    email        VARCHAR(120) NOT NULL UNIQUE,
    phone        VARCHAR(20),
    id_card_no   VARCHAR(30),
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE staff (
    staff_id    SERIAL       PRIMARY KEY,
    first_name  VARCHAR(60)  NOT NULL,
    last_name   VARCHAR(60)  NOT NULL,
    email       VARCHAR(120) NOT NULL UNIQUE,
    phone       VARCHAR(20),
    -- admin = Super Admin, manager = Hotel Manager, receptionist = Front Desk
    role        VARCHAR(20)  NOT NULL DEFAULT 'receptionist'
                CHECK (role IN ('receptionist','housekeeping','accounting','manager','admin')),
    hired_at    DATE         NOT NULL DEFAULT CURRENT_DATE,
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE
);

CREATE TABLE service (
    service_id   SERIAL       PRIMARY KEY,
    name         VARCHAR(80)  NOT NULL UNIQUE,
    price        NUMERIC(10,2) NOT NULL CHECK (price >= 0),
    description  VARCHAR(255),
    is_active    BOOLEAN      NOT NULL DEFAULT TRUE
);

-- =====================================================================
--  1b) บัญชีผู้ใช้ & audit (application / auth layer)
--      * เก็บเฉพาะ bcrypt hash ไม่มี plaintext (SECURITY.md DB-1)
--      * รองรับ brute-force lockout (failed_login_count / locked_until)
-- =====================================================================
CREATE TABLE app_user (
    user_id             SERIAL       PRIMARY KEY,
    username            VARCHAR(50)  NOT NULL UNIQUE,
    email               VARCHAR(120) NOT NULL UNIQUE,
    password_hash       VARCHAR(255) NOT NULL,          -- bcrypt ($2...) เท่านั้น
    role                VARCHAR(20)  NOT NULL
                        CHECK (role IN ('customer','receptionist','housekeeping',
                                        'accounting','manager','admin')),
    customer_id         INT REFERENCES customer(customer_id) ON DELETE CASCADE,
    staff_id            INT REFERENCES staff(staff_id)       ON DELETE CASCADE,
    is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
    failed_login_count  INT          NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
    locked_until        TIMESTAMPTZ,
    last_login_at       TIMESTAMPTZ,
    password_changed_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    token_version       INT          NOT NULL DEFAULT 0,   -- +1 = เพิกถอน token ที่ออกไปแล้วทั้งหมด (logout-all / เปลี่ยนรหัส)
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    -- role customer -> ผูก customer เท่านั้น ; receptionist/manager -> ผูก staff เท่านั้น
    CONSTRAINT chk_user_identity CHECK (
        (role =  'customer' AND customer_id IS NOT NULL AND staff_id    IS NULL) OR
        (role <> 'customer' AND staff_id    IS NOT NULL AND customer_id IS NULL)
    ),
    -- หนึ่งคนมีบัญชีได้ไม่เกินหนึ่งบัญชี (customer/staff 1 : 0..1 app_user)
    -- NULL ซ้ำกันได้ จึงไม่กระทบบัญชีฝั่งตรงข้าม; UNIQUE สร้าง index ให้ FK ด้วย
    CONSTRAINT uq_app_user_customer UNIQUE (customer_id),
    CONSTRAINT uq_app_user_staff    UNIQUE (staff_id)
);

CREATE TABLE auth_event (
    event_id       SERIAL       PRIMARY KEY,
    user_id        INT REFERENCES app_user(user_id) ON DELETE SET NULL,
    username_tried VARCHAR(50),                          -- เก็บไว้ตอน login ไม่สำเร็จ (ไม่รู้ user_id)
    event_type     VARCHAR(20)  NOT NULL
                   CHECK (event_type IN ('login_success','login_fail','logout','locked','password_change')),
    ip_address     INET,
    user_agent     VARCHAR(255),
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_auth_event_user ON auth_event (user_id);
CREATE INDEX idx_auth_event_time ON auth_event (created_at);

-- =====================================================================
--  2) ตารางธุรกรรม (transaction)
-- =====================================================================

CREATE TABLE booking (
    booking_id      SERIAL       PRIMARY KEY,
    customer_id     INT          NOT NULL
                    REFERENCES customer(customer_id) ON DELETE RESTRICT,
    staff_id        INT          NOT NULL
                    REFERENCES staff(staff_id) ON DELETE RESTRICT,
    booking_date    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    check_in_date   DATE         NOT NULL,
    check_out_date  DATE         NOT NULL,
    num_guests      INT          NOT NULL DEFAULT 1 CHECK (num_guests > 0),
    status          VARCHAR(20)  NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','confirmed','checked_in','checked_out','cancelled')),
    note            VARCHAR(255),
    CONSTRAINT chk_booking_dates CHECK (check_out_date > check_in_date)
);

-- ตารางเชื่อม booking <-> room (M:N) + ราคา/คืน ที่ล็อกไว้ ณ เวลาจอง (BR-6)
CREATE TABLE booking_room (
    booking_room_id  SERIAL       PRIMARY KEY,
    booking_id       INT          NOT NULL
                     REFERENCES booking(booking_id) ON DELETE CASCADE,
    room_id          INT          NOT NULL
                     REFERENCES room(room_id) ON DELETE RESTRICT,
    price_per_night  NUMERIC(10,2) NOT NULL CHECK (price_per_night >= 0),
    CONSTRAINT uq_booking_room UNIQUE (booking_id, room_id)   -- BR-3 ห้ามห้องซ้ำในการจองเดียว
);

-- ตารางเชื่อม booking <-> service (M:N) + ราคาที่ล็อกไว้
CREATE TABLE booking_service (
    booking_service_id  SERIAL       PRIMARY KEY,
    booking_id          INT          NOT NULL
                        REFERENCES booking(booking_id) ON DELETE CASCADE,
    service_id          INT          NOT NULL
                        REFERENCES service(service_id) ON DELETE RESTRICT,
    quantity            INT          NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price          NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
    CONSTRAINT uq_booking_service UNIQUE (booking_id, service_id)
);

CREATE TABLE payment (
    payment_id    SERIAL       PRIMARY KEY,
    booking_id    INT          NOT NULL
                  REFERENCES booking(booking_id) ON DELETE CASCADE,
    amount        NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
    method        VARCHAR(20)  NOT NULL
                  CHECK (method IN ('cash','credit_card','bank_transfer','promptpay')),
    status        VARCHAR(20)  NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','paid','refunded','failed')),
    paid_at       TIMESTAMPTZ,
    reference_no  VARCHAR(50)
);

CREATE TABLE review (
    review_id   SERIAL       PRIMARY KEY,
    booking_id  INT          NOT NULL UNIQUE          -- BR-11 หนึ่งการจองรีวิวได้ครั้งเดียว
                REFERENCES booking(booking_id) ON DELETE CASCADE,
    rating      INT          NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment     VARCHAR(500),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE room_status_log (
    log_id      SERIAL       PRIMARY KEY,
    room_id     INT          NOT NULL
                REFERENCES room(room_id) ON DELETE CASCADE,
    changed_by  INT          NOT NULL
                REFERENCES staff(staff_id) ON DELETE RESTRICT,
    old_status  VARCHAR(20)  NOT NULL,
    new_status  VARCHAR(20)  NOT NULL,
    changed_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- =====================================================================
--  2b) ราคาตามช่วงเวลา (rate plan)
--      ราคาใน room_type.base_price_per_night = ราคาตั้งต้น
--      rate_plan = ราคาที่ "ทับ" ตามฤดูกาล / วันธรรมดา-วันหยุด / โปรโมชั่น
--      เลือกใช้แผนที่ priority สูงสุดที่ตรงเงื่อนไข (ดู fn_quote_room)
-- =====================================================================
CREATE TABLE rate_plan (
    rate_plan_id     SERIAL       PRIMARY KEY,
    room_type_id     INT          NOT NULL
                     REFERENCES room_type(room_type_id) ON DELETE CASCADE,
    name             VARCHAR(80)  NOT NULL,
    kind             VARCHAR(20)  NOT NULL DEFAULT 'seasonal'
                     CHECK (kind IN ('seasonal','weekend','weekday','promotion')),
    price_per_night  NUMERIC(10,2) NOT NULL CHECK (price_per_night > 0),
    valid_from       DATE         NOT NULL,
    valid_to         DATE         NOT NULL,
    applies_weekday  BOOLEAN      NOT NULL DEFAULT TRUE,   -- จันทร์–ศุกร์
    applies_weekend  BOOLEAN      NOT NULL DEFAULT TRUE,   -- เสาร์–อาทิตย์
    priority         INT          NOT NULL DEFAULT 0,      -- มากกว่า = ชนะเมื่อทับกัน
    is_active        BOOLEAN      NOT NULL DEFAULT TRUE,
    CONSTRAINT chk_rate_plan_range CHECK (valid_to >= valid_from),
    CONSTRAINT chk_rate_plan_days  CHECK (applies_weekday OR applies_weekend)
);
CREATE INDEX idx_rate_plan_lookup
    ON rate_plan (room_type_id, valid_from, valid_to) WHERE is_active;

-- =====================================================================
--  2c) ใบแจ้งหนี้ / ใบกำกับภาษี  (ใช้งานได้ครั้งละหนึ่งใบต่อหนึ่งการจอง)
--      แยกจาก payment: invoice = ยอดที่ "เรียกเก็บ", payment = เงินที่ "รับมา"
--      แก้ใบที่ออกแล้วด้วยการ void แล้วออกใบใหม่ (BR-18) ใบที่ void เก็บไว้เป็นหลักฐาน
--      จึงเป็น booking 1 : N invoice แต่ใบที่ไม่ void มีได้ใบเดียว (partial unique index)
-- =====================================================================
CREATE TABLE invoice (
    invoice_id   SERIAL        PRIMARY KEY,
    booking_id   INT           NOT NULL
                 REFERENCES booking(booking_id) ON DELETE CASCADE,
    invoice_no   VARCHAR(20)   NOT NULL UNIQUE,            -- เช่น INV-2026-00001
    issued_by    INT           REFERENCES staff(staff_id) ON DELETE SET NULL,
    issued_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    status       VARCHAR(20)   NOT NULL DEFAULT 'issued'
                 CHECK (status IN ('draft','issued','paid','void')),
    tax_rate     NUMERIC(5,4)  NOT NULL DEFAULT 0.0700     -- VAT 7%
                 CHECK (tax_rate >= 0 AND tax_rate < 1),
    subtotal     NUMERIC(12,2) NOT NULL CHECK (subtotal   >= 0),
    tax_amount   NUMERIC(12,2) NOT NULL CHECK (tax_amount >= 0),
    total        NUMERIC(12,2) NOT NULL CHECK (total      >= 0),
    note         VARCHAR(255)
);
CREATE UNIQUE INDEX uq_invoice_active_booking ON invoice (booking_id) WHERE status <> 'void';
CREATE INDEX idx_invoice_booking ON invoice (booking_id);
CREATE INDEX idx_invoice_issued  ON invoice (issued_at);

CREATE TABLE invoice_line (
    invoice_line_id SERIAL       PRIMARY KEY,
    invoice_id      INT          NOT NULL
                    REFERENCES invoice(invoice_id) ON DELETE CASCADE,
    line_no         INT          NOT NULL CHECK (line_no > 0),
    line_type       VARCHAR(20)  NOT NULL
                    CHECK (line_type IN ('room','service','discount')),
    description     VARCHAR(160) NOT NULL,
    quantity        NUMERIC(10,2) NOT NULL CHECK (quantity > 0),
    unit_price      NUMERIC(10,2) NOT NULL,                -- ส่วนลดใช้ค่าติดลบได้
    amount          NUMERIC(12,2) NOT NULL,                -- เก็บไว้เพราะใบกำกับภาษีต้องคงค่า ณ วันออก
    CONSTRAINT uq_invoice_line UNIQUE (invoice_id, line_no),
    -- amount คำนวณได้จาก quantity x unit_price จึงบังคับให้ตรงกันเสมอ
    CONSTRAINT chk_invoice_line_amount CHECK (amount = ROUND(quantity * unit_price, 2))
);

-- =====================================================================
--  2d) แม่บ้าน (housekeeping) และงานแจ้งซ่อม (maintenance)
-- =====================================================================
CREATE TABLE housekeeping_task (
    task_id       SERIAL      PRIMARY KEY,
    room_id       INT         NOT NULL REFERENCES room(room_id) ON DELETE CASCADE,
    booking_id    INT         REFERENCES booking(booking_id) ON DELETE SET NULL,
    task_type     VARCHAR(20) NOT NULL DEFAULT 'checkout_clean'
                  CHECK (task_type IN ('checkout_clean','stayover_clean',
                                       'deep_clean','turndown','inspection')),
    status        VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','in_progress','done','skipped')),
    scheduled_for DATE        NOT NULL DEFAULT CURRENT_DATE,
    assigned_to   INT         REFERENCES staff(staff_id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at    TIMESTAMPTZ,
    completed_at  TIMESTAMPTZ,
    note          VARCHAR(255),
    -- ปิดงานแล้วต้องมีเวลาที่ปิด
    CONSTRAINT chk_hk_done_time CHECK (status <> 'done' OR completed_at IS NOT NULL)
);
CREATE INDEX idx_hk_board ON housekeeping_task (scheduled_for, status);
CREATE INDEX idx_hk_room  ON housekeeping_task (room_id);

CREATE TABLE maintenance_ticket (
    ticket_id    SERIAL       PRIMARY KEY,
    room_id      INT          REFERENCES room(room_id) ON DELETE SET NULL,  -- NULL = พื้นที่ส่วนกลาง
    reported_by  INT          NOT NULL REFERENCES staff(staff_id) ON DELETE RESTRICT,
    assigned_to  INT          REFERENCES staff(staff_id) ON DELETE SET NULL,
    category     VARCHAR(20)  NOT NULL DEFAULT 'other'
                 CHECK (category IN ('plumbing','electrical','hvac',
                                     'furniture','appliance','other')),
    priority     VARCHAR(10)  NOT NULL DEFAULT 'normal'
                 CHECK (priority IN ('low','normal','high','urgent')),
    status       VARCHAR(20)  NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open','in_progress','resolved','closed','cancelled')),
    title        VARCHAR(120) NOT NULL,
    description  VARCHAR(500),
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    resolved_at  TIMESTAMPTZ,
    resolution   VARCHAR(500),
    CONSTRAINT chk_mt_resolved
        CHECK (status NOT IN ('resolved','closed') OR resolved_at IS NOT NULL)
);
CREATE INDEX idx_mt_open  ON maintenance_ticket (status, priority);
CREATE INDEX idx_mt_room  ON maintenance_ticket (room_id);

-- =====================================================================
--  2e) Audit log ระดับระบบ (auth_event ดูแลเฉพาะการ login)
--      actor_label เก็บชื่อ ณ เวลานั้น -> ลบ user แล้วยังรู้ว่าใครทำ
--      แอปตั้งค่า SET LOCAL app.actor = '<username>' ต่อ transaction
-- =====================================================================
CREATE TABLE audit_log (
    audit_id      BIGSERIAL   PRIMARY KEY,
    at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_user_id INT         REFERENCES app_user(user_id) ON DELETE SET NULL,
    actor_label   VARCHAR(50),
    action        VARCHAR(40) NOT NULL,     -- 'booking.create', 'room.status_change', ...
    entity_type   VARCHAR(30) NOT NULL,     -- 'booking' | 'room' | 'invoice' | ...
    entity_id     VARCHAR(30),
    summary       VARCHAR(255),
    data          JSONB
);
CREATE INDEX idx_audit_time   ON audit_log (at DESC);
CREATE INDEX idx_audit_entity ON audit_log (entity_type, entity_id);

-- =====================================================================
--  3) Index สำหรับ query ที่ใช้บ่อย
-- =====================================================================
CREATE INDEX idx_booking_dates      ON booking (check_in_date, check_out_date);
CREATE INDEX idx_booking_customer   ON booking (customer_id);
CREATE INDEX idx_booking_status     ON booking (status);
CREATE INDEX idx_booking_room_room  ON booking_room (room_id);
CREATE INDEX idx_payment_booking    ON payment (booking_id);
CREATE INDEX idx_room_type          ON room (room_type_id);

-- ทุกคอลัมน์ FK มี index: ใช้ตอน join จากฝั่งแม่ และตอนตรวจ ON DELETE ไม่ต้องสแกนทั้งตาราง
CREATE INDEX idx_booking_staff          ON booking (staff_id);
CREATE INDEX idx_booking_service_svc    ON booking_service (service_id);
CREATE INDEX idx_rsl_room               ON room_status_log (room_id);
CREATE INDEX idx_rsl_changed_by         ON room_status_log (changed_by);
CREATE INDEX idx_invoice_issued_by      ON invoice (issued_by);
CREATE INDEX idx_hk_booking             ON housekeeping_task (booking_id);
CREATE INDEX idx_hk_assigned            ON housekeeping_task (assigned_to);
CREATE INDEX idx_mt_reported_by         ON maintenance_ticket (reported_by);
CREATE INDEX idx_mt_assigned            ON maintenance_ticket (assigned_to);
CREATE INDEX idx_audit_actor            ON audit_log (actor_user_id);

-- =====================================================================
--  4) VIEW : ยอดเงินและรายงาน
-- =====================================================================

-- 4.1 ยอดเงินของแต่ละการจอง (BR-9)
--     grand_total = ค่าห้อง + ค่าบริการเสริม
--     balance_due = grand_total - ยอดที่ชำระ + ยอดที่คืนเงินแล้ว ; การจองที่ยกเลิกเป็น 0
--     แต่ละยอดเป็น LATERAL subquery ต่อหนึ่งการจอง (ไม่ GROUP BY ทั้งตาราง)
--     เงื่อนไข booking_id จากภายนอกจึงถูกดันเข้าไปใช้ index ได้ แม้ join จากตารางอื่น
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

-- 4.2 ผู้เข้าพักที่กำลัง check-in อยู่ตอนนี้
CREATE VIEW v_current_guests AS
SELECT
    b.booking_id,
    c.first_name || ' ' || c.last_name AS customer_name,
    rm.room_number,
    rt.name                            AS room_type,
    b.check_in_date,
    b.check_out_date
FROM booking b
JOIN customer c      ON c.customer_id = b.customer_id
JOIN booking_room br ON br.booking_id = b.booking_id
JOIN room rm         ON rm.room_id = br.room_id
JOIN room_type rt    ON rt.room_type_id = rm.room_type_id
WHERE b.status = 'checked_in'
ORDER BY rm.room_number;

-- 4.3 รายได้ตามประเภทห้อง (นับเฉพาะการจองที่ไม่ถูกยกเลิก)
CREATE VIEW v_room_type_revenue AS
SELECT
    rt.room_type_id,
    rt.name                                                         AS room_type,
    COUNT(DISTINCT br.booking_id)                                   AS booking_count,
    SUM((bk.check_out_date - bk.check_in_date))                     AS total_room_nights,
    SUM(br.price_per_night * (bk.check_out_date - bk.check_in_date)) AS revenue
FROM booking_room br
JOIN booking bk   ON bk.booking_id = br.booking_id AND bk.status <> 'cancelled'
JOIN room rm      ON rm.room_id = br.room_id
JOIN room_type rt ON rt.room_type_id = rm.room_type_id
GROUP BY rt.room_type_id, rt.name
ORDER BY revenue DESC;

-- 4.4 กระดานงานแม่บ้าน : งานที่ต้องทำ + ห้อง + คนที่รับผิดชอบ
CREATE VIEW v_housekeeping_board AS
SELECT
    h.task_id,
    h.scheduled_for,
    h.status,
    h.task_type,
    rm.room_id,
    rm.room_number,
    rm.floor,
    rt.name                                            AS room_type,
    rm.status                                          AS room_status,
    h.booking_id,
    s.first_name || ' ' || s.last_name                 AS assigned_to_name,
    h.note
FROM housekeeping_task h
JOIN room rm      ON rm.room_id = h.room_id
JOIN room_type rt ON rt.room_type_id = rm.room_type_id
LEFT JOIN staff s ON s.staff_id = h.assigned_to
ORDER BY h.scheduled_for, rm.room_number;

-- 4.5 งานแจ้งซ่อมที่ยังไม่ปิด + อายุของงาน (วัน)
CREATE VIEW v_maintenance_open AS
SELECT
    t.ticket_id,
    t.title,
    t.category,
    t.priority,
    t.status,
    rm.room_number,
    r1.first_name || ' ' || r1.last_name               AS reported_by_name,
    r2.first_name || ' ' || r2.last_name               AS assigned_to_name,
    t.created_at,
    (CURRENT_DATE - t.created_at::date)                AS age_days
FROM maintenance_ticket t
LEFT JOIN room  rm ON rm.room_id  = t.room_id
JOIN staff      r1 ON r1.staff_id = t.reported_by
LEFT JOIN staff r2 ON r2.staff_id = t.assigned_to
WHERE t.status IN ('open','in_progress')
ORDER BY
    CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2
                    WHEN 'normal' THEN 3 ELSE 4 END,
    t.created_at;

-- 4.6 รายได้รายวัน (สำหรับฝ่ายบัญชี) : กระจายค่าห้องเฉลี่ยรายคืน
CREATE VIEW v_daily_revenue AS
SELECT
    d::date                                   AS stay_date,
    COUNT(DISTINCT b.booking_id)              AS bookings,
    COUNT(*)                                  AS room_nights,
    SUM(br.price_per_night)                   AS room_revenue
FROM booking b
JOIN booking_room br ON br.booking_id = b.booking_id
CROSS JOIN LATERAL generate_series(
        b.check_in_date, b.check_out_date - 1, INTERVAL '1 day'
) AS d
WHERE b.status <> 'cancelled'
GROUP BY d::date
ORDER BY stay_date;

-- 4.7 ใบแจ้งหนี้ + ยอดที่ชำระแล้ว + ยอดคงเหลือ
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

-- =====================================================================
--  5) FUNCTION : ค้นหาห้องว่างในช่วงวันที่กำหนด
--     ใช้: SELECT * FROM fn_available_rooms('2026-10-01','2026-10-05');
-- =====================================================================
CREATE OR REPLACE FUNCTION fn_available_rooms(p_check_in DATE, p_check_out DATE)
RETURNS TABLE (
    room_id       INT,
    room_number   VARCHAR,
    room_type     VARCHAR,
    price_per_night NUMERIC,
    max_occupancy INT
)
LANGUAGE sql
AS $$
    SELECT r.room_id, r.room_number, rt.name, rt.base_price_per_night, rt.max_occupancy
    FROM room r
    JOIN room_type rt ON rt.room_type_id = r.room_type_id
    WHERE r.status = 'available'
      AND NOT EXISTS (
          SELECT 1
          FROM booking_room br
          JOIN booking b ON b.booking_id = br.booking_id
          WHERE br.room_id = r.room_id
            AND b.status IN ('pending','confirmed','checked_in')
            -- เงื่อนไขช่วงวันซ้อนกัน: (start1 < end2) AND (start2 < end1)
            AND b.check_in_date  < p_check_out
            AND p_check_in       < b.check_out_date
      )
    ORDER BY rt.base_price_per_night, r.room_number;
$$;

-- ---------------------------------------------------------------------
--  5.2 fn_quote_room : ราคาห้องของ "หนึ่งคืน" ตาม rate_plan
--      เลือกแผนที่ยัง active, ครอบวันนั้น, และตรงวันธรรมดา/วันหยุด
--      ถ้าไม่มีแผนไหนตรง -> ใช้ราคาตั้งต้นของประเภทห้อง
--      ใช้: SELECT fn_quote_room(5, DATE '2026-12-31');
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_quote_room(p_room_type_id INT, p_night DATE)
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(
        (
            SELECT rp.price_per_night
            FROM rate_plan rp
            WHERE rp.room_type_id = p_room_type_id
              AND rp.is_active
              AND p_night BETWEEN rp.valid_from AND rp.valid_to
              AND (
                    (EXTRACT(ISODOW FROM p_night) IN (6,7) AND rp.applies_weekend)
                 OR (EXTRACT(ISODOW FROM p_night) NOT IN (6,7) AND rp.applies_weekday)
              )
            ORDER BY rp.priority DESC, rp.price_per_night DESC
            LIMIT 1
        ),
        (SELECT rt.base_price_per_night FROM room_type rt
          WHERE rt.room_type_id = p_room_type_id)
    );
$$;

-- ---------------------------------------------------------------------
--  5.3 fn_quote_stay : รวมราคาทุกคืนของช่วงเข้าพัก (ไม่นับคืนที่ check-out)
--      ใช้: SELECT fn_quote_stay(5, DATE '2026-12-30', DATE '2027-01-02');
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_quote_stay(
    p_room_type_id INT, p_check_in DATE, p_check_out DATE
)
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(SUM(fn_quote_room(p_room_type_id, d::date)), 0)
    FROM generate_series(p_check_in, p_check_out - 1, INTERVAL '1 day') AS d;
$$;

-- =====================================================================
--  6) TRIGGER : กันจองห้องซ้อนช่วงวัน (BR-5)
--     ตรวจก่อน INSERT/UPDATE ที่ booking_room
-- =====================================================================
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

CREATE TRIGGER bi_booking_room_no_overlap
BEFORE INSERT OR UPDATE ON booking_room
FOR EACH ROW
EXECUTE FUNCTION trg_check_room_overlap();

-- ---------------------------------------------------------------------
--  6.1b กฎเดียวกัน (BR-5) เมื่อแก้ที่ตาราง booking
--       วันที่และสถานะอยู่ใน booking ไม่ใช่ booking_room การเลื่อนวัน หรือเปลี่ยนการจอง
--       ที่ยกเลิกแล้วกลับมาใช้ จึงต้องตรวจทุกห้องของการจองนั้นอีกครั้ง
-- ---------------------------------------------------------------------
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

CREATE TRIGGER bu_booking_no_overlap
BEFORE UPDATE OF check_in_date, check_out_date, status ON booking
FOR EACH ROW
EXECUTE FUNCTION trg_check_booking_overlap();

-- ---------------------------------------------------------------------
--  6.2 เมื่อ booking กลายเป็น 'checked_out'
--      -> สร้างงานทำความสะอาดให้ทุกห้องในการจองนั้น
--      -> ตั้งสถานะห้องเป็น 'cleaning'
--      (ให้ฐานข้อมูลเป็นคนรับประกันว่าไม่มีห้องไหนหลุดการทำความสะอาด)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_checkout_makes_housekeeping()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.status = 'checked_out' AND OLD.status IS DISTINCT FROM 'checked_out' THEN
        INSERT INTO housekeeping_task (room_id, booking_id, task_type, scheduled_for, note)
        SELECT br.room_id, NEW.booking_id, 'checkout_clean', NEW.check_out_date,
               'สร้างอัตโนมัติเมื่อ check-out'
        FROM booking_room br
        WHERE br.booking_id = NEW.booking_id;

        UPDATE room
           SET status = 'cleaning'
         WHERE room_id IN (SELECT room_id FROM booking_room WHERE booking_id = NEW.booking_id)
           AND status = 'available';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER au_booking_checkout_housekeeping
AFTER UPDATE OF status ON booking
FOR EACH ROW
EXECUTE FUNCTION trg_checkout_makes_housekeeping();

-- ---------------------------------------------------------------------
--  6.3 Audit : บันทึกทุกครั้งที่สร้างการจอง หรือเปลี่ยนสถานะการจอง
--      ผู้ทำมาจาก SET LOCAL app.actor = '<username>' (แอปตั้งให้ต่อ request)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_audit_booking()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_actor TEXT := NULLIF(current_setting('app.actor', TRUE), '');
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO audit_log (actor_label, action, entity_type, entity_id, summary, data)
        VALUES (COALESCE(v_actor, 'system'), 'booking.create', 'booking',
                NEW.booking_id::text,
                format('การจอง #%s สถานะ %s', NEW.booking_id, NEW.status),
                jsonb_build_object('customer_id', NEW.customer_id,
                                   'staff_id',    NEW.staff_id,
                                   'check_in',    NEW.check_in_date,
                                   'check_out',   NEW.check_out_date));
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
        INSERT INTO audit_log (actor_label, action, entity_type, entity_id, summary, data)
        VALUES (COALESCE(v_actor, 'system'), 'booking.status_change', 'booking',
                NEW.booking_id::text,
                format('การจอง #%s: %s -> %s', NEW.booking_id, OLD.status, NEW.status),
                jsonb_build_object('from', OLD.status, 'to', NEW.status));
    END IF;
    RETURN NULL;   -- AFTER trigger
END;
$$;

CREATE TRIGGER aiu_booking_audit
AFTER INSERT OR UPDATE OF status ON booking
FOR EACH ROW
EXECUTE FUNCTION trg_audit_booking();

-- ---------------------------------------------------------------------
--  6.4 บทบาทของพนักงานเก็บสองที่: staff.role (หน้าที่ในโรงแรม) และ app_user.role
--      (สิทธิ์ในระบบ) FD staff_id -> role จึงต้องมีค่าเดียว แก้ที่ไหนก็ให้อีกที่ตามทันที
--      กัน update anomaly ; เงื่อนไข IS DISTINCT FROM ทำให้ไม่วนเรียกกันไม่รู้จบ
-- ---------------------------------------------------------------------
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

CREATE TRIGGER au_staff_role_sync
AFTER UPDATE OF role ON staff
FOR EACH ROW
EXECUTE FUNCTION trg_sync_role_from_staff();

-- =====================================================================
--  จบ schema.sql -- ต่อไปรัน seed.sql เพื่อใส่ข้อมูลตัวอย่าง
-- =====================================================================
