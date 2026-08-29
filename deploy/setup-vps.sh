#!/usr/bin/env bash
#
# One-time bootstrap for a fresh Hostinger KVM VPS (Ubuntu 22.04/24.04) that
# will run BOTH Dostoori and ailegal_hussein in Docker. Installs Docker, sets
# up swap + the firewall, creates the shared network, and scaffolds .env.
#
#   ssh root@YOUR_VPS_IP
#   cd /opt
#   git clone <repo> dostoori && cd dostoori
#   git clone <repo> ailegal_hussein
#   (cd ailegal_hussein && git checkout ailegal-hussein)
#   bash deploy/setup-vps.sh
#
# Safe to re-run: every step checks before acting. See HOSTINGER_DEPLOY.md.

set -euo pipefail

say() { echo -e "\n\033[1;33m==> $1\033[0m"; }

if [[ $EUID -ne 0 ]]; then
  echo "Run as root (Hostinger gives you root by default)." >&2
  exit 1
fi

# ---------------------------------------------------------------- packages
say "Updating packages"
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg git ufw nginx openssl

# ---------------------------------------------------------------- swap
# `next build` peaks near 1.5GB and runs for BOTH apps. On the 4GB plan,
# with MySQL already resident, a build without swap gets OOM-killed and
# Docker reports a bare "exit code 137".
say "Configuring swap"
if ! swapon --show | grep -q '/swapfile'; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
  sysctl -w vm.swappiness=10 >/dev/null
  grep -q 'vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >>/etc/sysctl.conf
  echo "  2GB swap enabled."
else
  echo "  Swap already present, skipping."
fi

# ---------------------------------------------------------------- docker
say "Installing Docker"
if ! command -v docker &>/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg |
    gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
  echo "  Docker installed."
else
  echo "  Docker already present, skipping."
fi

# ---------------------------------------------------------------- network
# The two compose stacks join this so `dostoori_app` can reach `legal_app`
# by name. Declared `external` in both docker-compose.yml files.
say "Creating shared Docker network"
docker network create --driver bridge dostoori_net 2>/dev/null && echo "  Created dostoori_net." || echo "  dostoori_net already exists, skipping."

# ---------------------------------------------------------------- firewall
say "Configuring firewall"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
# 3000, 4000 and 3306 are deliberately NOT opened — all bind to 127.0.0.1 in
# the compose files, and nginx is the only public entrance.
ufw --force enable >/dev/null
echo "  Only SSH + HTTP/HTTPS are open."

# ---------------------------------------------------------------- .env
say "Scaffolding .env"
if [[ ! -f .env ]]; then
  cp .env.example .env

  JWT=$(openssl rand -base64 48 | tr -d '\n')
  TFA=$(openssl rand -base64 48 | tr -d '\n')
  MYSQL_PW=$(openssl rand -hex 24)
  MYSQL_ROOT_PW=$(openssl rand -hex 24)

  # `|` delimiter: base64 secrets contain `/` and `+`.
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=\"${JWT}\"|" .env
  sed -i "s|^TWO_FACTOR_ENCRYPTION_KEY=.*|TWO_FACTOR_ENCRYPTION_KEY=\"${TFA}\"|" .env
  sed -i "s|^MYSQL_PASSWORD=.*|MYSQL_PASSWORD=\"${MYSQL_PW}\"|" .env
  sed -i "s|^MYSQL_ROOT_PASSWORD=.*|MYSQL_ROOT_PASSWORD=\"${MYSQL_ROOT_PW}\"|" .env
  # In Docker the app builds DATABASE_URL from MYSQL_* — leave the example
  # line out of the way so it is not mistaken for the effective value.
  sed -i "s|^DATABASE_URL=.*|# DATABASE_URL is assembled by docker-compose.yml from MYSQL_* above|" .env

  echo "  Generated JWT_SECRET, TWO_FACTOR_ENCRYPTION_KEY, MYSQL_PASSWORD, MYSQL_ROOT_PASSWORD."
else
  echo "  .env already exists — left untouched."
fi

say "Bootstrap complete"
cat <<'EOF'
  Still to do by hand in dostoori/.env:
    - AI_LEGAL_SERVICE_URL="http://legal_app:3000"
    - AI_LEGAL_SERVICE_KEY=...   (must EQUAL ailegal_hussein/.env's INTERNAL_SERVICE_KEY)
    - SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM   (optional)
    - APP_URL="https://app.YOURDOMAIN.com"
    - PLATFORM_ADMIN_EMAILS=...

  And in ailegal_hussein/.env: DATABASE_URL (Neon), OPENAI_API_KEY,
  INTERNAL_SERVICE_KEY, ADMIN_PASSWORD, IP_HASH_SALT, LAWYER_SESSION_SECRET.

  Then:
    1. (cd ../ailegal_hussein && bash deploy/deploy.sh)
    2. bash deploy/deploy.sh
    3. bash deploy/setup-nginx.sh YOURDOMAIN.com
EOF
