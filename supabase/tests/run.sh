#!/bin/sh
# Rebuilds a scratch database from the migrations, then runs the behaviour
# tests. Needs a local Postgres 16: PGHOST/PGPORT/PGUSER as usual. No seed:
# the salon starts empty and the tests make the rows they need.
#
# The baseline runs a second time after everything else, as it would if
# someone re-ran it against live after cutover: it must change nothing, and in
# particular must not reopen the photos bucket.
set -e
cd "$(dirname "$0")/.."
psql -qX -d postgres -c 'drop database if exists salon_test' -c 'create database salon_test'
for f in tests/00_supabase_stub.sql migrations/*.sql migrations/*_baseline.sql tests/10_rls_test.sql; do
  if ! out=$(psql -qX -v ON_ERROR_STOP=1 -d salon_test -f "$f" 2>&1); then
    printf '%s\n' "$out"
    echo "FAILED in $f"
    exit 1
  fi
  printf '%s\n' "$out" | grep -E 'NOTICE|ERROR|PASSED' | sed 's/.*NOTICE:  //' || true
done
