#!/usr/bin/env bash
# Load schema + least-privilege roles + seed into the compose `db` container,
# and set the app_rw password to what docker-compose.yml expects.
set -euo pipefail

# Git Bash / MSYS rewrites the container-side "/sql/..." paths into Windows paths
# before they reach `docker exec`; these no-ops on Linux/macOS turn that off.
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'

# Pick up the same overrides docker-compose.yml uses (if a .env exists next to it).
if [ -f "$(dirname "$0")/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$(dirname "$0")/.env"
  set +a
fi

CID="${1:-roombooking-stack-db-1}"
PSQL=(docker exec -i "$CID" psql -v ON_ERROR_STOP=1 -U postgres -d roombooking)

echo ">> schema.sql"
"${PSQL[@]}" -f /sql/schema.sql

echo ">> roles.sql (least-privilege app_rw / app_readonly)"
"${PSQL[@]}" -f /sql/roles.sql

echo ">> align role passwords with docker-compose.yml (.env overrides, else same demo defaults)"
APP_RW_PASSWORD="${APP_RW_PASSWORD:-app_rw_pw}"
APP_RO_PASSWORD="${APP_RO_PASSWORD:-app_ro_pw}"
# psql variables (:'pw') quote the value, so a quote in the password is safe
echo "ALTER ROLE app_rw       WITH PASSWORD :'pw';" | "${PSQL[@]}" -v pw="${APP_RW_PASSWORD}"
echo "ALTER ROLE app_readonly WITH PASSWORD :'pw';" | "${PSQL[@]}" -v pw="${APP_RO_PASSWORD}"

echo ">> seed.sql"
"${PSQL[@]}" -f /sql/seed.sql

echo ">> done — sign in at http://localhost:8081 with manager01 / Passw0rd!2026"
