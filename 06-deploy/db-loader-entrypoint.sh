#!/bin/sh
# Runs *inside* the db-loader container (postgres:16-alpine, has psql built in) -
# never on the host, so this is the same on every OS: the host only ever runs
# `docker compose run --rm db-loader`, nothing OS-specific.
set -eu

PSQL="psql -v ON_ERROR_STOP=1 -h db -U postgres -d roombooking"

echo ">> schema.sql"
$PSQL -f /sql/schema.sql

echo ">> roles.sql (least-privilege app_rw / app_readonly)"
$PSQL -f /sql/roles.sql

echo ">> align role passwords with docker-compose.yml (.env overrides, else same demo defaults)"
# passed as psql variables and quoted by psql (:'pw'), so a quote in the password
# can't break or inject into the statement; -c doesn't expand variables, stdin does
echo "ALTER ROLE app_rw       WITH PASSWORD :'pw';" | $PSQL -v pw="${APP_RW_PASSWORD}"
echo "ALTER ROLE app_readonly WITH PASSWORD :'pw';" | $PSQL -v pw="${APP_RO_PASSWORD}"

echo ">> seed.sql"
$PSQL -f /sql/seed.sql

echo ">> done -- sign in at http://localhost:8081 with manager01 / Passw0rd!2026"
