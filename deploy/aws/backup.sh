#!/usr/bin/env bash
# Dumps the Postgres database to /opt/roamr/backups and keeps the last 7.
# Cron runs it nightly (setup-instance.sh); run it by hand before risky changes:
#   sudo /opt/roamr/app/deploy/aws/backup.sh
set -euo pipefail
cd /opt/roamr/app/deploy/aws
out=/opt/roamr/backups/roamr-$(date -u +%Y%m%d-%H%M%S).sql.gz
docker compose exec -T db pg_dump -U roamr --no-owner roamr | gzip > "$out.tmp"
mv "$out.tmp" "$out"
ls -1t /opt/roamr/backups/roamr-*.sql.gz | tail -n +8 | xargs -r rm --
echo "Backup written: $out"
