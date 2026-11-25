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

mkdir -p /opt/roamr/data /opt/roamr/caddy
[ -d /opt/roamr/app/.git ] || git clone --branch "$BRANCH" "$REPO" /opt/roamr/app

ip=$(curl -fsS https://checkip.amazonaws.com)
host=${ip//./-}.sslip.io
if [ ! -f /opt/roamr/.env ]; then
  cat > /opt/roamr/.env <<ENV
# Hostname Caddy serves HTTPS for. Change to your domain once DNS points here.
SITE_HOST=$host
PUBLIC_URL=https://$host
ADMIN_EMAILS=
SIGNUP_CODE=
ENV
  chmod 600 /opt/roamr/.env
elif grep -q '^SITE_HOST=.*\.sslip\.io$' /opt/roamr/.env; then
  # First boot runs before the static IP is attached: follow the new IP.
  sed -i -E "s|^SITE_HOST=.*\.sslip\.io$|SITE_HOST=$host|; s|^PUBLIC_URL=https://.*\.sslip\.io$|PUBLIC_URL=https://$host|" /opt/roamr/.env
fi

echo "Edit /opt/roamr/.env, then: cd /opt/roamr/app/deploy/aws && sudo docker compose up -d --build"
