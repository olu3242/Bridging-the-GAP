#!/usr/bin/env bash
# Local Postgres cluster for BTG AI schema / RLS certification.
# Not a Supabase replacement: it applies supabase/migrations against a bare
# Postgres 16 cluster plus the auth-schema shim in tests/db/bootstrap.sql.
set -euo pipefail

PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
PGDATA=${PGDATA:-/tmp/btg-pgdata}
PGPORT=${PGPORT:-55432}
PGUSER_LOCAL=${PGUSER_LOCAL:-postgres}
DB=${DB:-btg_test}
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

as_pg() { if [ "$(id -u)" = "0" ]; then su postgres -s /bin/bash -c "$1"; else bash -c "$1"; fi }

up() {
  if [ ! -d "$PGDATA/base" ]; then
    mkdir -p "$PGDATA"; chown -R postgres:postgres "$PGDATA" 2>/dev/null || true
    as_pg "$PGBIN/initdb -D $PGDATA -U $PGUSER_LOCAL --auth=trust" >/dev/null
  fi
  if ! as_pg "$PGBIN/pg_isready -h 127.0.0.1 -p $PGPORT" >/dev/null 2>&1; then
    as_pg "$PGBIN/pg_ctl -D $PGDATA -o '-p $PGPORT -c listen_addresses=127.0.0.1' -l $PGDATA/server.log start" >/dev/null
    for _ in $(seq 1 30); do as_pg "$PGBIN/pg_isready -h 127.0.0.1 -p $PGPORT" >/dev/null 2>&1 && break; sleep 1; done
  fi
  reset
}

reset() {
  psql -h 127.0.0.1 -p "$PGPORT" -U "$PGUSER_LOCAL" -d postgres -v ON_ERROR_STOP=1 -q \
    -c "DROP DATABASE IF EXISTS $DB WITH (FORCE);" -c "CREATE DATABASE $DB;"
  psql -h 127.0.0.1 -p "$PGPORT" -U "$PGUSER_LOCAL" -d "$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/tests/db/bootstrap.sql"
  for f in "$ROOT"/supabase/migrations/*.sql; do
    echo "applying $(basename "$f")"
    psql -h 127.0.0.1 -p "$PGPORT" -U "$PGUSER_LOCAL" -d "$DB" -v ON_ERROR_STOP=1 -q -f "$f"
  done
  echo "BTG_TEST_DATABASE_URL=postgresql://$PGUSER_LOCAL@127.0.0.1:$PGPORT/$DB"
}

down() { as_pg "$PGBIN/pg_ctl -D $PGDATA stop -m fast" >/dev/null 2>&1 || true; }

case "${1:-up}" in
  up) up ;;
  reset) reset ;;
  down) down ;;
  *) echo "usage: local-db.sh [up|reset|down]" >&2; exit 2 ;;
esac
