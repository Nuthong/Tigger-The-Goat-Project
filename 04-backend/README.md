# Room Booking API (backend)

FastAPI + SQLAlchemy 2 (async) + PostgreSQL. **DB-first**: `../03-database/schema.sql`
is the source of truth; the ORM models mirror it (no migrations tool needed for this project).

Security design lives in [`../SECURITY.md`](../SECURITY.md) — this service implements §2 (API layer).

---

## Requirements

- Python **3.12+** (tested on 3.12 in Docker and 3.14 locally)
- PostgreSQL **16+** running, with `../03-database` scripts loadable
- `psql` on PATH (used by the test harness to build a throwaway DB)

## Setup

```bash
cd 04-backend
make install                 # creates .venv + installs requirements-dev.txt
cp .env.example .env          # then edit DATABASE_URL + JWT_SECRET
python -c "import secrets; print(secrets.token_urlsafe(48))"   # -> paste into JWT_SECRET
```

Load the database (schema + least-privilege roles + seed):

```bash
./scripts/init_db.sh roombooking          # or: make initdb
```

Point `DATABASE_URL` at the `app_rw` role (not a superuser):

```
DATABASE_URL=postgresql+psycopg://app_rw:<pw>@localhost:5432/roombooking
```

## Run

```bash
make dev            # uvicorn --reload on :8000
# docs:   http://localhost:8000/docs
# health: http://localhost:8000/health   /health/ready (checks DB)
```

Or the whole stack in containers:

```bash
docker compose up --build         # postgres + api
docker compose exec -T db psql -U postgres -d roombooking < ../03-database/schema.sql
docker compose exec -T db psql -U postgres -d roombooking < ../03-database/seed.sql
```

## Quality gates

```bash
make lint          # ruff  (E,F,I,UP,B,S,C4,PTH)
make typecheck     # mypy --strict
make test          # pytest  (builds roombooking_test from ../03-database/*.sql)
make audit         # pip-audit
```

Current status: **ruff clean · mypy strict clean · 107/107 tests pass · pip-audit clean**.

The suite covers all functional modules:

| # | Module | File |
|---|---|---|
| 1 | Auth & accounts (register, login by username / email / phone, refresh, lockout, RBAC) | `tests/test_auth.py` |
| 2 | Room catalog (types, listing, pagination, filters) | `tests/test_rooms.py` |
| 3 | Availability search (`fn_available_rooms`) | `tests/test_availability.py` |
| 4 | Booking creation & retrieval (price snapshot, IDOR scoping, past-date + capacity guards) | `tests/test_bookings.py` |
| 5 | Booking lifecycle (check-in / check-out / cancel + state guards) | `tests/test_lifecycle.py` |
| 6 | Payments (partial/full, bill balance, over-payment + state guards) | `tests/test_payments.py` |
| 7 | Reviews (guest-only, post-checkout, one-per-booking, public room-type feed) | `tests/test_reviews.py` |
| 8 | Reporting (revenue view, occupancy, manager-only) | `tests/test_reports.py` |
| 9 | Room administration (create, RBAC, status + audit) | `tests/test_room_admin.py` |
| 10 | Ops API (rate plans, invoices, housekeeping, maintenance, audit; user admin: role-locked customers, disable/delete) | `tests/test_ops_api.py` |
| 11 | Schema objects (views, functions, triggers, constraints) | `tests/test_schema_ops.py` |
| — | Infra (health, DB readiness, security headers) | `tests/test_health.py` |

---

## Layout

```
app/
├── main.py              app factory: CORS, security headers, exception handlers, /health
├── core/
│   ├── config.py        pydantic-settings (env / .env)
│   ├── security.py      bcrypt hash/verify + JWT encode/decode
│   ├── rate_limit.py    per-IP fixed-window limiter (FastAPI dependency)
│   ├── middleware.py    CSP + X-Frame-Options + nosniff + HSTS (prod)
│   └── logging.py       stdlib JSON logs, no secrets
├── db/                  async engine + session dependency + DeclarativeBase
├── models/              SQLAlchemy models, 1:1 with schema.sql (19 tables)
├── schemas/             Pydantic v2 — separate *In (extra="forbid") vs *Out; business rules
│                        live here (past-date, capacity, over-payment, rate-plan range, …)
├── services/            auth_service (login/lockout/audit) · booking_service (availability,
│                        bill, transitions) · ops_service (rate plans, invoices, housekeeping,
│                        maintenance, audit)
├── api/
│   ├── deps.py          get_current_user, require_role(...), pagination
│   └── v1/              auth · rooms · bookings · customers · reports · rate_plans · invoices
│                        · housekeeping · maintenance · admin
└── exceptions.py        AppError hierarchy -> clean JSON (no stack traces)
tests/                   pytest-asyncio + httpx ASGITransport, throwaway PG database
```

## Endpoints (all under `/api/v1`)

| Method | Path | Who |
|---|---|---|
| POST | `/auth/register` | public (rate-limited) — creates a `customer` |
| POST | `/auth/login` | public (rate-limited) |
| POST | `/auth/refresh` | refresh cookie (rotated) |
| POST | `/auth/logout` | authenticated |
| GET  | `/auth/me` | authenticated |
| POST | `/auth/change-password` | authenticated (bumps `token_version` → all tokens die) |
| GET  | `/room-types` | **public** — marketing site (carries `avg_rating` + `review_count`) |
| GET  | `/room-types/{id}/reviews` | **public** — score, star distribution, recent comments |
| GET  | `/room-types/availability?check_in&check_out` | **public** — availability grouped by category (guest view) |
| GET  | `/rooms/availability?check_in&check_out` | **public** — per-room list, calls `fn_available_rooms()` (portal) |
| GET  | `/rooms` | staff — physical room inventory |
| POST | `/rooms` | manager |
| PATCH| `/rooms/{id}/status` | staff — writes `room_status_log` |
| GET  | `/rooms/{id}/status-log` | any staff — the room's status history (who, from, to, when) |
| PATCH| `/room-types/{id}` | manager — list price, description, capacity (name fixed) |
| GET  | `/services` | **public** — active add-ons · `GET /services/catalog` manager (with units sold + revenue) |
| POST / PATCH | `/services`, `/services/{id}` | manager — add, reprice, retire (never delete) |
| POST | `/bookings` | customer (self, auto-assigns a room of the chosen type) · staff (for any guest) |
| GET  | `/bookings`, `/bookings/{id}` | staff = all · customer = own only (IDOR-safe) |
| GET  | `/bookings/{id}/bill` | owner/staff — room + service − paid |
| POST | `/bookings/{id}/check-in` `/check-out` | staff |
| POST | `/bookings/{id}/cancel` | staff, or customer for own |
| POST | `/bookings/{id}/payments` | staff |
| POST / DELETE | `/bookings/{id}/services[/{service_id}]` | staff — post / remove a folio charge (open folio, no live invoice; removal refunds any overpayment) |
| GET  | `/bookings/{id}/review` | owner/staff — the review for this stay, or 404 |
| POST | `/bookings/{id}/review` | customer, own, after check-out |
| GET  | `/customers?q=` | staff — guest directory + trips + lifetime value (paginated) |
| PATCH| `/customers/{id}` | staff — name, phone, ID card / passport no. |
| GET  | `/reports/revenue-by-room-type` `/reports/occupancy` | manager — SQL views (occupancy = last 24 months) |
| GET  | `/reports/in-house` | front desk — `v_current_guests` + balance |
| GET  | `/housekeeping/board?day=` | any staff — `v_housekeeping_board` (printable daily sheet) |
| GET  | `/maintenance/backlog` | any staff — `v_maintenance_open` (age in days) |
| GET  | `/admin/auth-events` `/admin/auth-events/stats` | admin — the sign-in log (`auth_event`) |
| GET  | `/admin/reviews` | staff — guest-feedback board |
| PATCH / DELETE | `/admin/users/{id}` | admin — staff role change; customers only disable/delete (role locked) |

## Notes / decisions

- **Only staff create bookings** (matches the proposal: customers *request*, พนักงานเคาน์เตอร์ *create*).
  This also keeps `booking.staff_id` NOT NULL honest.
- **Auth token model:** short access JWT (15 min, sent in body, kept in memory by the SPA) +
  rotating refresh JWT in an `HttpOnly; Secure; SameSite=Strict` cookie scoped to `/api/v1/auth`.
  `app_user.token_version` is the revocation lever (logout-all / password change).
- **Login identifier:** the `username` field on `/auth/login` also matches the account email
  or, for guests, the linked `customer.email` / `customer.phone` (`_find_login_user`).
- **Customer accounts:** a guest's role is fixed by registration. `PATCH /admin/users/{id}`
  refuses a role change on a customer account (`customer_role_locked`); admins may only
  disable or `DELETE` it — the `customer` profile and its booking history survive the delete.
- **Lockout:** 5 failed logins → 15-min lock; every attempt is written to `auth_event`
  and *committed* even though the request returns 401.
- Migrations: not used (DB-first). If the schema evolves, regenerate models or add Alembic.
