#!/usr/bin/env bash
# Sets up a fresh Ubuntu 24.04 Lightsail instance (safe to run again). As root:
#   curl -fsSL https://raw.githubusercontent.com/fadilaisy/testingagent/main/deploy/aws/setup-instance.sh | sudo bash
set -euo pipefail

REPO=${REPO:-https://github.com/fadilaisy/testingagent.git}
BRANCH=${BRANCH:-main}

# 1 GB of swap so `npm ci` and the Vite build fit on the 1 GB plan.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh

mkdir -p /opt/roamr/data /opt/roamr/caddy /opt/roamr/postgres /opt/roamr/backups
[ -d /opt/roamr/app/.git ] || git clone --branch "$BRANCH" "$REPO" /opt/roamr/app

# Database password, made once. Postgres reads postgres.env; the app reads
# the same password in DATABASE_URL from .env.
if [ ! -f /opt/roamr/postgres.env ]; then
  pw=$(openssl rand -hex 24)
  echo "POSTGRES_PASSWORD=$pw" > /opt/roamr/postgres.env
  chmod 600 /opt/roamr/postgres.env
  if [ -f /opt/roamr/.env ] && ! grep -q '^DATABASE_URL=' /opt/roamr/.env; then
    echo "DATABASE_URL=postgres://roamr:$pw@db:5432/roamr" >> /opt/roamr/.env
  fi
fi
pw=$(sed -n 's/^POSTGRES_PASSWORD=//p' /opt/roamr/postgres.env)

# Nightly database dump at 00:30 WIB (17:30 UTC), half an hour before the
# Lightsail snapshot, so every snapshot also holds a plain SQL backup.
cat > /etc/cron.d/roamr-backup <<'CRON'
30 17 * * * root /opt/roamr/app/deploy/aws/backup.sh >> /var/log/roamr-backup.log 2>&1
CRON

ip=$(curl -fsS https://checkip.amazonaws.com)
host=${ip//./-}.sslip.io
if [ ! -f /opt/roamr/.env ]; then
  cat > /opt/roamr/.env <<ENV
# Hostname Caddy serves HTTPS for. Change to your domain once DNS points here.
SITE_HOST=$host
PUBLIC_URL=https://$host
ADMIN_EMAILS=
SIGNUP_CODE=
DATABASE_URL=postgres://roamr:$pw@db:5432/roamr
ENV
  chmod 600 /opt/roamr/.env
elif grep -q '^SITE_HOST=.*\.sslip\.io$' /opt/roamr/.env; then
  # First boot runs before the static IP is attached: follow the new IP.
  sed -i -E "s|^SITE_HOST=.*\.sslip\.io$|SITE_HOST=$host|; s|^PUBLIC_URL=https://.*\.sslip\.io$|PUBLIC_URL=https://$host|" /opt/roamr/.env
fi

echo "Edit /opt/roamr/.env, then: cd /opt/roamr/app/deploy/aws && sudo docker compose up -d --build"
