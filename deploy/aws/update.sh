#!/usr/bin/env bash
# Deploy the latest code on the instance: sudo /opt/roamr/app/deploy/aws/update.sh
# Expect a few seconds of downtime while the app container restarts.
set -euo pipefail
cd /opt/roamr/app
git pull --ff-only
cd deploy/aws
docker compose up -d --build
docker image prune -f
