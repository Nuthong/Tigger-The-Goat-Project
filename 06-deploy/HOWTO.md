# How To — รันทั้งระบบด้วย Docker (ทุก OS)

คำสั่งชุดเดียวกันเป๊ะสำหรับ macOS, Linux, และ Windows (cmd, PowerShell, หรือ Git Bash)
ไม่ต้องมี `bash`/`psql`/Node/Python ติดตั้งบนเครื่องเลย — ใช้แค่ Docker

## 1. ข้อกำหนดเบื้องต้น

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows/macOS) หรือ Docker Engine + Compose plugin (Linux) — เปิดโปรแกรมทิ้งไว้ให้ daemon รันอยู่
- พอร์ตว่างบนเครื่อง: `8081` (web), `8000` (API), `5433` (Postgres) — ถ้าชนกับของเดิมที่มีอยู่ ให้แก้เลขพอร์ตซ้ายมือใน `ports:` ของ [docker-compose.yml](docker-compose.yml)

## 2. รันขึ้นมา (ครั้งแรก หรือหลัง `down -v`)

```bash
cd 06-deploy
docker compose up --build -d
docker compose run --rm db-loader        # เริ่มจาก seed สะอาด
docker compose run --rm history-loader   # นำเข้าประวัติ ใช้เวลาราว 5-10 นาที
```

- คำสั่งที่ 2 (`up`) build image + สร้าง 3 container (`db`, `api`, `web`) แล้วคืน prompt ทันที (ไม่ค้างรอ)
- คำสั่งที่ 3 (`db-loader`) เป็น container แบบใช้ครั้งเดียว โหลด `schema.sql` → `roles.sql` → `seed.sql` เข้า Postgres แล้วปิดตัวเองทิ้ง (`--rm`) — **ต้องรันทุกครั้งที่เพิ่งสร้าง volume ใหม่** (ครั้งแรก หรือหลัง `docker compose down -v`)
- เสร็จแล้วเปิดเบราว์เซอร์ไปที่ **http://localhost:8081** เข้าสู่ระบบด้วย `manager01` / `Passw0rd!2026`
  (บัญชีอื่น: `recep01`, `acct01`, `house01`, `admin01`, หรือฝั่งลูกค้า `somchai` / `anna` — รหัสเดียวกันหมด)

## 3. ตรวจว่าใช้งานได้จริง

```bash
docker compose ps
```

ต้องเห็นทั้ง 3 บรรทัดเป็น `healthy` (ไม่ใช่ `starting` หรือ `unhealthy`):

```
roombooking-stack-db-1    ... healthy
roombooking-stack-api-1   ... healthy
roombooking-stack-web-1   ... healthy
```

`api` เป็น `healthy` แปลว่าต่อฐานข้อมูลได้จริง (เช็คด้วย `SELECT 1` ผ่าน role `app_rw`) ไม่ใช่แค่โปรเซสยังไม่ตาย — ถ้า `api` ค้างที่ `unhealthy` แปลว่ายังไม่ได้รัน `docker compose run --rm db-loader` หรือรันแล้ว error (ดูข้อ 4)

## 4. แก้ปัญหาที่พบบ่อย

**`docker compose ps` ขึ้น healthy หมด แต่เปิดเว็บแล้ว "Internal Server Error"**
เว็บ (`web`) ไม่ได้รอให้ API ต่อฐานข้อมูลได้ก่อนค่อยขึ้น (ตั้งใจออกแบบแบบนี้เพื่อไม่ให้ `up` ค้าง) ดังนั้นถ้าเปิดเบราว์เซอร์เร็วเกินไปก่อนรัน `db-loader` จะเจอแบบนี้ได้ — เช็ค `docker compose ps` ก่อนเสมอ ถ้า `api` ยัง `unhealthy`/`starting` ให้รอหรือรัน `docker compose run --rm db-loader`

**`docker compose run --rm db-loader` error ว่า role/database มีอยู่แล้ว หรือข้อมูลซ้ำ**
`seed.sql` เริ่มด้วย `TRUNCATE ... RESTART IDENTITY` เสมอ รันซ้ำได้ปลอดภัย แต่ถ้า error อื่นที่ไม่ใช่แบบนี้ ให้ล้างของเดิมทั้งหมดแล้วเริ่มใหม่ (ดูข้อ 5)

**พอร์ตชนกับโปรแกรมอื่นในเครื่อง** (`bind: address already in use`)
แก้เลขพอร์ตฝั่งซ้ายใน `ports:` ของ [docker-compose.yml](docker-compose.yml) เช่น เปลี่ยน `"8081:80"` เป็น `"18081:80"` แล้วเปิด `http://localhost:18081` แทน

**เพิ่งย้ายโปรเจกต์มาจาก macOS ผ่านไดรฟ์นอก/USB แล้ว `docker build` ฝั่ง backend fail แปลกๆ**
เช็คว่ามีไฟล์ขึ้นต้นด้วย `._` (macOS AppleDouble) หลุดเข้ามาใน `04-backend/app/` หรือเปล่า (`find 04-backend -name "._*"`) ไฟล์พวกนี้เป็นขยะจากระบบไฟล์ที่ไม่รองรับ extended attributes ลบทิ้งได้เลย — `.dockerignore` กันไว้แล้วสำหรับ build ครั้งต่อไป

## 5. ล้างข้อมูล / เริ่มใหม่หมด

```bash
docker compose down -v   # ลบ container + volume ฐานข้อมูลทิ้งทั้งหมด
docker compose up --build -d
docker compose run --rm db-loader
```

## 6. ปิดระบบ (เก็บข้อมูลไว้)

```bash
docker compose down      # ไม่มี -v : เก็บข้อมูลใน volume ไว้ เปิดใหม่คราวหน้าไม่ต้องรัน db-loader ซ้ำ
```

## ข้อควรระวัง

- `03-database/` และ `02-design/` เป็นของ **locked** (ฉบับส่งงาน) — ห้ามแก้ `schema.sql` / `seed.sql` / `roles.sql` / ERD ผ่านขั้นตอนไหนทั้งสิ้น การรัน `db-loader` เขียนแค่ **ข้อมูล (rows)** ลง container ที่กำลังรันอยู่ ไม่ได้แก้ไฟล์ในเครื่อง
- อยาก deploy ขึ้น cloud จริง (ไม่ใช่แค่เดโมในเครื่อง) ดู [DEPLOY.md](DEPLOY.md) ส่วน B
