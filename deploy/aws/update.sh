#!/usr/bin/env bash
# Deploy the latest code on the instance: sudo /opt/roamr/app/deploy/aws/update.sh
# Expect a few seconds of downtime while the app container restarts.
set -euo pipefail
cd /opt/roamr/app
git pull --ff-only
cd deploy/aws
# The Postgres version needs a one-time data move; don't start it without one.
if ! grep -q '^DATABASE_URL=' /opt/roamr/.env; then
  echo "This version runs on Postgres. Move the data first: sudo /opt/roamr/app/deploy/aws/switch-to-postgres.sh"
  exit 1
fi
docker compose up -d --build
docker image prune -f
