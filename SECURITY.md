# Security Plan — ระบบจองห้องพัก

แผนความปลอดภัยครอบทุกชั้น (DB → API → Frontend → Deploy)
ใช้เป็น checklist ตอนพัฒนา และเป็นหัวข้อหนึ่งในรายงาน/พรีเซนต์

หลักที่ยึด: **Defense in depth**, **Least privilege**, **Never trust client input**, **Fail closed**

---

## 1. Database (PostgreSQL)

| # | มาตรการ | ทำยังไง | ไฟล์ |
|---|---|---|---|
| DB-1 | **ไม่เก็บรหัสผ่านเป็น plaintext** | เก็บเฉพาะ bcrypt hash ใน `app_user.password_hash` (cost ≥ 12) | `schema.sql`, `seed.sql` (ใช้ `pgcrypto`) |
| DB-2 | **Least-privilege role** | แอปต่อ DB ด้วย role `app_rw` (แค่ SELECT/INSERT/UPDATE/DELETE เท่าที่ใช้) ไม่ใช่ owner/superuser · รายงานใช้ `app_readonly` | `roles.sql` |
| DB-3 | **Referential + domain integrity** | FK ทุกความสัมพันธ์, CHECK ค่า enum/ช่วงเลข, UNIQUE กันซ้ำ, NOT NULL ฟิลด์สำคัญ | `schema.sql` |
| DB-4 | **กันตรรกะพัง** | trigger `bi_booking_room_no_overlap` + `bu_booking_no_overlap` กันจองห้องซ้อนวัน (ทั้งตอนเพิ่มห้องและตอนเลื่อนวัน/เปลี่ยนสถานะ) ใช้ `pg_advisory_xact_lock` ต่อห้องกันการจองพร้อมกัน แม้แอปมีบั๊ก | `schema.sql` |
| DB-5 | **Audit trail** | `auth_event` เก็บ login สำเร็จ/ล้มเหลว/ล็อก/เปลี่ยนรหัส · `room_status_log` เก็บการเปลี่ยนสถานะห้อง · `audit_log` เก็บการกระทำทางธุรกิจ (trigger `aiu_booking_audit` + แอป) | `schema.sql` |
| DB-6 | **บังคับ SSL** | Neon บังคับ `sslmode=require` อยู่แล้ว · local ตั้ง `ssl=on` | connection string ใน env |
| DB-7 | **Backup** | Neon มี point-in-time restore · เก็บ `pg_dump` เป็นระยะตอนใกล้ส่ง | `06-deploy/` |
| DB-8 | **แยก DB จริง/ทดสอบ** | `roombooking` (dev) กับ `roombooking_test` (รัน test) คนละ database | |
| DB-9 | *(ออปชัน โชว์ในพรีเซนต์)* Row-Level Security | เปิด RLS บน `booking` ให้ role ลูกค้าเห็นเฉพาะแถวของตัวเอง | `roles.sql` (คอมเมนต์ไว้) |

---

## 2. Backend API (FastAPI)

### 2.1 Authentication  — _implemented in `04-backend/app/`_
- **Password hashing:** `bcrypt` โดยตรง (cost 12) ใน `app/core/security.py` — ไม่มี plaintext
- **Token:**
  - access token = JWT อายุสั้น **15 นาที**, ฝั่ง React เก็บ **ในหน่วยความจำเท่านั้น** (ไม่ใส่ localStorage)
  - refresh token อายุ **7 วัน** ส่งเป็น cookie `HttpOnly; Secure; SameSite=Strict`, หมุน (rotate) ทุกครั้งที่ refresh, มี jti เพิกถอนได้
  - เซ็น JWT ด้วย secret ยาว ≥ 32 ไบต์ จาก env (`JWT_SECRET`), อัลกอริทึม `HS256` (หรือ RS256)
- **Logout:** ลบ refresh cookie + บันทึก `auth_event` · เพิกถอน token ทั้งหมดของบัญชีด้วยการเพิ่ม `app_user.token_version` (ทำอัตโนมัติเมื่อเปลี่ยนรหัสผ่าน หรือเมื่อ admin เปลี่ยน role)
- **Brute force / lockout:** นับ `app_user.failed_login_count`; ครบ 5 → `locked_until = now() + 15 min`, รีเซ็ต count; ทุก attempt เขียน `auth_event` และ **commit แม้ response เป็น 401** (`auth_service.authenticate`)
- **Rate limiting:** limiter ของเราเอง (fixed-window ต่อ IP, `app/core/rate_limit.py`) เป็น FastAPI dependency บน `/auth/register|login|change-password` - ค่าเริ่มต้น `5/minute` (ปรับผ่าน env `AUTH_RATE_LIMIT`) ส่วน `/auth/refresh` แยก bucket ของตัวเอง ค่าเริ่มต้น `60/minute` (env `REFRESH_RATE_LIMIT`) เพราะเปิดหน้าหรือแท็บใหม่แต่ละครั้งเรียก refresh 1 ครั้ง และ refresh ต้องใช้ token ที่ลงลายเซ็นแล้ว จึงเดารหัสผ่านไม่ได้
- ตอบ login ผิดด้วยข้อความกลาง ๆ `"invalid username or password"` + dummy bcrypt compare กัน timing/user-enumeration

### 2.2 Authorization (RBAC)
- role 6 แบบ: `customer` / `receptionist` / `housekeeping` / `accounting` / `manager` / `admin`
- FastAPI dependency `require_role("receptionist","manager")` คุมทุก endpoint ที่ต้องสิทธิ์
- **IDOR / object-level:** ทุก endpoint ที่รับ `booking_id` ต้องเช็คว่าเป็นของ user (ลูกค้า) หรือ user เป็น staff — `WHERE customer_id = :current_user` เสมอ
- รายงานผู้บริหาร / เพิ่มห้อง / แผนราคา = `manager` ขึ้นไป · ใบแจ้งหนี้ = `accounting` · จัดการบัญชีผู้ใช้ = `admin` (กลุ่มสิทธิ์อยู่ใน `app/api/deps.py`)

### 2.3 Input handling
- **SQL injection:** ใช้ SQLAlchemy ORM / parameterized query เท่านั้น — **ห้าม** f-string / `.format` / `%` ต่อ SQL เด็ดขาด
- **Validation:** Pydantic model ทุก request — กำหนด type, `min_length`/`max_length`, ช่วงตัวเลข, รูปแบบวันที่; ตั้ง `model_config = ConfigDict(extra="forbid")` กัน field แปลกปลอม
- **Mass assignment:** แยก schema `BookingCreate` (ไม่มี `id`, `status`, `role`) ออกจาก model ตอบกลับ — client กำหนด role/สถานะเองไม่ได้
- **Business rule server-side:** ตรวจ check_out > check_in, ห้องว่างจริง, จำนวนเงิน ≥ 0 ที่ฝั่ง API ไม่พึ่ง frontend

### 2.4 Transport & headers
- **CORS:** allowlist เฉพาะ origin ของ React (`https://<app>.onrender.com`, `http://localhost:5173`) + `allow_credentials=True` — **ห้าม** `allow_origins=["*"]` คู่กับ credentials
- **HTTPS:** บังคับใน prod (Render ให้ TLS), redirect http→https, ตั้ง `HSTS`
- **Security headers** (middleware): `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Content-Security-Policy` (จำกัด script/connect ให้เหลือ origin ตัวเอง + API)
- ปิด `Server` header / เวอร์ชัน

### 2.5 Error handling & logging
- 500 ตอบข้อความกลาง ๆ — **ไม่** ส่ง stack trace / SQL / ค่า config กลับ client
- log แบบมีโครงสร้าง (JSON ด้วย stdlib `logging`, `app/core/logging.py`) — **ห้าม** log รหัสผ่าน, token, เลขบัตรประชาชนเต็ม
- log auth event (สำเร็จ/ล้มเหลว/ล็อก) ลง `auth_event`

### 2.6 Secrets & config
- ทุก secret (`DATABASE_URL`, `JWT_SECRET`, ...) อยู่ใน env / `.env` (อยู่ใน `.gitignore`) — โหลดด้วย `pydantic-settings`
- ไม่มี default secret ในโค้ด · commit ไฟล์ `.env.example` ที่เป็นค่าเปล่า
- ตรวจ dependency: `pip-audit` เป็นระยะ + เปิด Dependabot บน repo

---

## 3. Frontend (React + Vite + TypeScript)

| # | มาตรการ |
|---|---|
| FE-1 | **XSS:** ให้ React render ปกติ (escape อัตโนมัติ) — เลี่ยง `dangerouslySetInnerHTML`; ถ้าจำเป็นให้ผ่าน DOMPurify |
| FE-2 | **เก็บ token:** access token ในตัวแปร/Context ในหน่วยความจำ; refresh token เป็น httpOnly cookie (JS อ่านไม่ได้) → ลดผลกระทบถ้าโดน XSS |
| FE-3 | **ไม่มี secret ใน bundle:** มีแค่ `VITE_API_BASE`; อย่าใส่ API key/secret ใด ๆ ในโค้ด frontend |
| FE-4 | **Validate ซ้ำฝั่ง client** เพื่อ UX เท่านั้น — ความปลอดภัยตัดสินที่ API |
| FE-5 | **CSRF:** เพราะ refresh อยู่ใน cookie → ใช้ `SameSite=Strict` + ต้องมี custom header (`Authorization: Bearer`) ในทุก state-changing request; endpoint ที่พึ่ง cookie ล้วนต้องมี CSRF token |
| FE-6 | ล็อกเอาต์อัตโนมัติเมื่อ token หมดอายุ / 401; ปุ่ม action สำคัญมี confirm |
| FE-7 | dependency audit: `npm audit` ก่อนส่ง |

---

## 4. Deployment (Neon + Render)

- [ ] `DATABASE_URL` ของแอปใช้ role `app_rw` ไม่ใช่ owner
- [ ] ทุก secret ตั้งใน Render Environment / Neon — ไม่อยู่ใน repo
- [ ] `.gitignore` ครอบ `.env`, `*.pem`, `__pycache__`, `node_modules`, dump ไฟล์
- [ ] เปิด GitHub secret scanning + push protection
- [ ] Render service เปิด HTTPS only, health check path
- [ ] CORS/CSP origin ชี้ domain prod จริง
- [ ] แยก branch/role ของ Neon สำหรับ dev กับ prod
- [ ] ก่อนส่ง: รัน `pip-audit` + `npm audit` + ตรวจว่าไม่มี secret หลุดใน git history (`git log -p | grep -i secret`)

---

## 5. Checklist สรุป (ติ๊กตอนรีวิวก่อนส่ง)

**DB**
- [x] ไม่มี plaintext password ใน DB / seed / โค้ด
- [x] แอปต่อด้วย `app_rw` (least privilege) — ทดสอบว่า `DROP TABLE` ด้วย role นี้ไม่ได้
- [x] FK/CHECK/UNIQUE/NOT NULL ครบตาม `relational-schema.md`
- [x] trigger กันจองซ้อนทำงาน (มี test)

**API**
- [x] ทุก query เป็น parameterized (grep หา f-string SQL = ไม่เจอ)
- [x] ทุก endpoint มี auth + role check ที่ถูกต้อง + เช็คความเป็นเจ้าของ (IDOR)
- [x] login มี rate-limit + lockout + ข้อความ error กลาง ๆ
- [x] CORS allowlist (ไม่ใช่ `*`), security headers ครบ
- [x] error 500 ไม่รั่ว stack trace; log ไม่มี secret
- [x] `.env` ไม่ถูก commit; มี `.env.example`

**Frontend**
- [x] ไม่มี `dangerouslySetInnerHTML` ที่ไม่ได้ sanitize
- [x] access token อยู่ในหน่วยความจำ, refresh เป็น httpOnly cookie
- [x] ไม่มี secret ใน bundle

**Deploy**
- [ ] HTTPS only, secret อยู่ใน env, dependency audit ผ่าน
