#!/usr/bin/env bash
# One-time move of the live site from SQLite to Postgres. Run on the instance
# after pulling the Postgres version of the code:
#   sudo /opt/roamr/app/deploy/aws/switch-to-postgres.sh
# Takes a minute or two of downtime. The SQLite file is left in place, so
# going back is: check out the previous commit and `docker compose up -d --build`.
set -euo pipefail
cd /opt/roamr/app/deploy/aws

if [ ! -f /opt/roamr/data/roamr.db ]; then
  echo "No /opt/roamr/data/roamr.db: nothing to migrate. Start normally with: docker compose up -d --build"
  exit 1
fi

# Password and DATABASE_URL (setup-instance.sh only adds what is missing).
/opt/roamr/app/deploy/aws/setup-instance.sh

echo "Building the new app image..."
docker compose build app

echo "Stopping the old app so no one writes during the copy..."
docker compose stop app
# A copy of the SQLite files (with any -wal/-shm) as they were at the switch.
keep=/opt/roamr/data/before-postgres-$(date -u +%Y%m%d-%H%M%S)
mkdir -p "$keep" && cp -p /opt/roamr/data/roamr.db* "$keep/"

docker compose up -d db
until docker compose exec -T db pg_isready -U roamr -d roamr >/dev/null 2>&1; do sleep 2; done
echo "Copying SQLite -> Postgres..."
docker compose run --rm --no-deps app node --disable-warning=ExperimentalWarning server/src/migrate-sqlite.js /data/roamr.db

docker compose up -d
echo "Done. Open the site, check /api/health and log in."
