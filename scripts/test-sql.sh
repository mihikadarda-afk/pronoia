#!/usr/bin/env bash
# Loads the migrations into a scratch database on a plain Postgres and runs tests/sql/scenario.sql.
# PGURL defaults to a local server: PGURL=postgres://postgres@localhost:5432 npm run test:sql
set -euo pipefail
cd "$(dirname "$0")/.."
PGURL="${PGURL:-postgres://postgres@localhost:5432}"
DB="pronoia_test_$$"
psql "$PGURL/postgres" -qc "create database $DB"
trap 'psql "$PGURL/postgres" -qc "drop database if exists $DB" >/dev/null' EXIT
run() { psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$1" >/dev/null 2>"$DB.err" || { cat "$DB.err"; rm -f "$DB.err"; exit 1; }; rm -f "$DB.err"; }
run tests/sql/supabase-stub.sql
for f in supabase/migrations/*.sql; do run "$f"; done
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f tests/sql/scenario.sql 2>&1 | grep -E 'ERROR|CONTEXT|ALL GOOD'
