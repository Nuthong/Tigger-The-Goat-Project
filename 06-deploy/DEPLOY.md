# Deployment

Three targets, easiest first. All are free-tier friendly.

| What | Where | Cost |
|---|---|---|
| PostgreSQL | Neon | free |
| API (FastAPI) | Render (Docker) | free |
| Web (React/nginx) | Vercel *or* the same nginx image | free |

---

## A. Local — whole stack in Docker (for the demo)

Same 3 commands on macOS, Linux, and Windows (cmd, PowerShell, or Git Bash) -
plain `docker compose`, no shell script required:

```bash
cd 06-deploy
docker compose up --build -d
docker compose run --rm db-loader   # schema + roles + seed into the db container
docker compose run --rm history-loader   # นำเข้าประวัติ ใช้เวลาราว 5-10 นาที
```

Then open http://localhost:8081 in a browser (SPA; API docs at http://localhost:8000/docs).

Sign in: `manager01` / `Passw0rd!2026` (or `recep01`, `somchai` — username, email or phone).
Ports on the host: web `8081`, API `8000`, Postgres `5433` (→ container 5432).
Tear down: `docker compose down -v`.

(`./load-db.sh` still works on macOS/Linux/Git-Bash if you prefer a real shell -
it drives the same `schema.sql` / `roles.sql` / `seed.sql` from the host via
`docker exec`. `db-loader` does the identical thing from inside a container, so
it needs nothing installed on the host and no shell at all.)

Troubleshooting (ports already in use, `docker compose ps` all "healthy" but the
site 500s, resetting data): [`HOWTO.md`](HOWTO.md).

---

## B. Cloud

### 1. Database — Neon

1. Create a project → you get a connection string:
   `postgresql://<user>:<pw>@<host>/<db>?sslmode=require`
2. In the Neon SQL editor (or `psql` with that URL) run, in order:
   `03-database/schema.sql` → `03-database/roles.sql` → `03-database/seed.sql`
   *(skip `seed.sql` for a real deployment; keep it for the class demo.)*
3. If Neon won't let you `CREATE ROLE`, use the role Neon gave you and just run the
   `GRANT …` parts of `roles.sql`. Then take a **separate** restricted role for the app
   if the plan allows; otherwise document that the app currently uses the owner role.
4. App connection string (note the SQLAlchemy driver prefix):
   `postgresql+psycopg://app_rw:<pw>@<host>/<db>?sslmode=require`

### 2. API — Render

- New **Web Service** → "Deploy from a Git repo" → root directory `…/04-backend`,
  environment **Docker** (uses `04-backend/Dockerfile`).
- Environment variables:

  | key | value |
  |---|---|
  | `DATABASE_URL` | the Neon `postgresql+psycopg://app_rw:…?sslmode=require` string |
  | `JWT_SECRET` | `python -c "import secrets;print(secrets.token_urlsafe(48))"` |
  | `CORS_ORIGINS` | `https://<your-web-domain>` |
  | `ENVIRONMENT` | `production` |

- Health check path: `/health`. Render provides HTTPS automatically; the app sets HSTS
  and `Secure` cookies when `ENVIRONMENT=production`.

### 3. Web — Vercel

- Import the repo → root `…/05-frontend`, framework **Vite**.
- Build command `npm run build`, output `dist`.
- Environment variable `VITE_API_BASE = https://<render-api-domain>/api/v1`.
- After it deploys, copy the Vercel domain into the API's `CORS_ORIGINS` and redeploy the API.

*Alternative:* skip Vercel and run `05-frontend/Dockerfile` (nginx) as a second Render
service — `nginx.conf` already proxies `/api` to the API service, so no CORS at all.

---

## C. Pre-flight checklist (from `../SECURITY.md` §4)

- [ ] `DATABASE_URL` uses `app_rw`, not a superuser
- [ ] `JWT_SECRET` is a fresh 48-byte random string, set only in the host's env
- [ ] `ENVIRONMENT=production` on the API (turns on HSTS + `Secure` cookies)
- [ ] `CORS_ORIGINS` is the exact web origin — never `*`
- [ ] No `.env` committed; `git log -p | grep -i secret` is clean
- [ ] `pip-audit` (API) and `npm audit` (web) pass
- [ ] `seed.sql` **not** loaded on a real deployment (demo only)
