# Mini-DB Group Project - ระบบจองห้องพัก (Room Booking System)

**310-2209 Database Systems** · Mini-DB Group Project (30%)
Group: 6810301002 · 003 · 004 · 012 · 037 · 039

A relational database for a hotel room-booking system, proven end-to-end with a
FastAPI service and a React web client.

| Folder | What |
|---|---|
| [`SECURITY.md`](SECURITY.md) | cross-layer security design + checklist |
| [`01-proposal/`](01-proposal/proposal.md) | topic, scope, actors · **[`business-requirements.md`](01-proposal/business-requirements.md) / `.docx`** - the formal BRD: 46 FR, 28 BR (numbered as `schema.sql` cites them), 11 NFR, traceability of every table / view / function to its API and screen |
| [`02-design/`](02-design/Draft/relational-schema.md) | ER diagram (`ERD.drawio`) · relational schema · 1NF→3NF proof |
| [`03-database/`](03-database/README.md) | `schema.sql` · `roles.sql` · `seed.sql` (155 rooms/9 floors, 1000 guests, ~25 yrs of stays + reviews) · `queries.sql` (Q1-Q22) - **the graded artifact** |
| [`04-backend/`](04-backend/README.md) | FastAPI + SQLAlchemy 2 async · ~77 endpoints, every list endpoint paginated · 198 tests · business rules enforced in `schemas/` + `services/` |
| [`05-frontend/`](05-frontend/README.md) | React 18 + Vite + TS · **fully bilingual site, guest and staff (English / ไทย)** - guest site (Mandarin-Oriental-style, photography) + staff portal `/admin` (20 screens incl. Reports, TapeChart, In-house guests, Add-on services, Sign-in activity; printable tax invoice / folio / housekeeping daily sheet) · per-role route guards · guest ratings, reviews, self-serve cancel + reschedule + no-show · client guardrails mirror the API rules · 81 vitest tests · `design/ui-ux.md` |
| [`06-deploy/`](06-deploy/DEPLOY.md) | `docker-compose.yml` (db+api+web+`db-loader`+`history-loader`) · deploy runbook · [`history/`](06-deploy/history/README.md) - 27 years of consistent hotel history 2000-2026 (bookings, stays, housekeeping, repairs, payments, invoices, reviews, audit), 20 consistency checks before commit |
| [`07-report/`](07-report/report.md) | Final Report · presentation · `slides.html` · demo script |

## Quick start

**Database only** (what the course grades):

```bash
cd 03-database
createdb roombooking
psql -d roombooking -f schema.sql
psql -d roombooking -f roles.sql
psql -d roombooking -f seed.sql
psql -d roombooking -f queries.sql
```

**Whole stack** (demo) - needs Docker. Same 3 commands on macOS, Linux, and
Windows (cmd, PowerShell, or Git Bash) - no shell script required:

```bash
cd 06-deploy
docker compose up --build -d
docker compose run --rm db-loader   # schema + roles + seed, once
docker compose run --rm history-loader   # optional: 2000-2026 hotel history (see 06-deploy/history)
```

Then open http://localhost:8081 in a browser - sign in: `manager01` / `Passw0rd!2026`.
Full walkthrough + troubleshooting (ports in use, "healthy" but 500, resetting data): [`06-deploy/HOWTO.md`](06-deploy/HOWTO.md).

Host ports: web `8081` · API `8000` (`/docs`) · Postgres `5433`.

## Status

- ✅ Design + SQL (19 tables, ERD, normalization, 7 views, 3 functions, 6 triggers) - verified on PostgreSQL 16/18 - **finalized / locked**
- ✅ Backend - ruff / mypy --strict / **198 tests** / pip-audit all clean
- ✅ Frontend - `tsc --noEmit && vite build` passes / **81 vitest tests**; **ran the full stack** end to end against the live API
- ✅ Whole site is bilingual (English / ไทย) - guest search/booking/account/payment and all 20 staff-portal screens
- ✅ Report + slides + deploy config
- ⬜ Cloud deploy (Neon + Render + Vercel) - runbook in `06-deploy/DEPLOY.md`

