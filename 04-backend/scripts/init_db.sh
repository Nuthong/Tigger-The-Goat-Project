#!/usr/bin/env bash
# โหลด schema + roles + seed เข้า DB ที่ระบุ
# ใช้:  ./scripts/init_db.sh [DBNAME]     (ค่าเริ่มต้น: roombooking)
#      PGHOST / PGUSER / PGPASSWORD อ่านจาก environment ตามปกติของ psql
set -euo pipefail

DB="${1:-roombooking}"
SQL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../03-database" && pwd)"

echo ">> target database: $DB"
echo ">> sql dir        : $SQL_DIR"

createdb "$DB" 2>/dev/null || echo "   (database exists, continuing)"

psql -v ON_ERROR_STOP=1 -d "$DB" -f "$SQL_DIR/schema.sql"
psql -v ON_ERROR_STOP=1 -d "$DB" -f "$SQL_DIR/roles.sql"
psql -v ON_ERROR_STOP=1 -d "$DB" -f "$SQL_DIR/seed.sql"

echo ">> done. verify:  psql -d $DB -c 'SELECT * FROM v_booking_bill LIMIT 3;'"
