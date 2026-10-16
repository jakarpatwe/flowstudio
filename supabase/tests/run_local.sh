#!/usr/bin/env bash
# Runs migrations + seed + behaviour tests on a throwaway local Postgres database.
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${DB:-sbtest}
dropdb --if-exists "$DB" && createdb "$DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -c 'create extension if not exists pgcrypto' -f tests/local_shim.sql
for f in migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f"; done
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f seed.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f tests/booking_rules_test.sql
