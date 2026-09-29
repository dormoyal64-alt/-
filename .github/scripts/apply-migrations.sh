#!/usr/bin/env bash
#
# Apply the migrations the database has not seen yet, in order, and stop at the
# first one that fails.
#
# The point of this file is that the business owner never opens a SQL editor
# again. A migration committed here reaches the database by itself.
#
# It keeps its own ledger rather than trusting file dates or the git history,
# because the only question that matters is "has THIS database run THIS file",
# and only the database can answer it. The ledger is seeded once from
# baseline.txt — the migrations that were applied by hand before this script
# existed — so an established database is not asked to replay its own past.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
migrations="$here/../../webapp/supabase/migrations"
baseline="$here/../../webapp/supabase/baseline.txt"

: "${DATABASE_URL:?DATABASE_URL is not set — add it as a repository secret}"

run() { psql "$DATABASE_URL" --no-psqlrc -v ON_ERROR_STOP=1 -q "$@"; }

run -c "
  create table if not exists applied_migrations (
    filename text primary key,
    applied_at timestamptz not null default now()
  );
  comment on table applied_migrations is
    'Which migration files this database has run. Written by .github/scripts/apply-migrations.sh.';
"

# First run on an established database: everything in baseline.txt was applied by
# hand before this existed, so it is recorded rather than replayed. The guard is
# "the ledger is empty", so this happens exactly once and never again.
if [ -f "$baseline" ] && [ "$(run -Atc 'select count(*) from applied_migrations')" = "0" ]; then
  echo "First run — recording the migrations that were already applied by hand:"
  while IFS= read -r name; do
    [ -z "$name" ] && continue
    case "$name" in \#*) continue ;; esac
    run -c "insert into applied_migrations (filename) values ('$name') on conflict do nothing;"
    echo "  · $name (already in place)"
  done < "$baseline"
fi

applied=0
for file in "$migrations"/*.sql; do
  name="$(basename "$file")"
  seen="$(run -Atc "select count(*) from applied_migrations where filename = '$name'")"
  if [ "$seen" != "0" ]; then
    continue
  fi
  echo "→ applying $name"
  run -f "$file"
  run -c "insert into applied_migrations (filename) values ('$name') on conflict do nothing;"
  applied=$((applied + 1))
done

if [ "$applied" -eq 0 ]; then
  echo "Nothing to apply — the database is already up to date."
else
  echo "Applied $applied migration(s)."
fi

# PostgREST caches the schema; without this the app keeps calling the old shape
run -c "notify pgrst, 'reload schema';"
