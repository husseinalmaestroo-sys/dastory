#!/usr/bin/env bash
#
# One-time bootstrap for a fresh Hostinger VPS (Ubuntu 22.04/24.04).
# Installs Docker, sets up swap and the firewall, and creates .env.
#
#   ssh root@YOUR_VPS_IP
#   cd /opt && git clone <your-repo> ai-legal && cd ai-legal
#   bash deploy/setup-vps.sh
#
# Safe to re-run: every step checks before acting.

set -euo pipefail

say() { echo -e "\n\033[1;33m==> $1\033[0m"; }

if [[ $EUID -ne 0 ]]; then
  echo "Run as root (Hostinger gives you root by default)." >&2
  exit 1
fi

# ---------------------------------------------------------------- packages
say "Updating packages"
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg git ufw nginx

# ---------------------------------------------------------------- swap
# The 4GB plan is the tight one: `next build` peaks around 1.5GB while
# Postgres already holds ~700MB. Without swap the build gets OOM-killed and
# Docker reports a confusing "exit code 137" instead of "out of memory".
say "Configuring swap"
if ! swapon --show | grep -q '/swapfile'; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
  # Default 60 swaps too eagerly for a DB box and costs latency; 10 keeps swap
  # as the emergency reserve it is meant to be.
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

# -------------------------------------------------------------- network
# Shared with Dostoori's compose so the two apps resolve each other by
# container name. Idempotent — dostoori/deploy/setup-vps.sh creates the same
# one; whichever runs first wins.
say "Ensuring shared Docker network"
docker network create --driver bridge dostoori_net 2>/dev/null && echo "  Created dostoori_net." || echo "  dostoori_net already exists, skipping."

# ---------------------------------------------------------------- firewall
say "Configuring firewall"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
# 4000 is deliberately NOT opened — it binds to 127.0.0.1 in
# docker-compose.yml; nginx (legal.<domain>) is the only public entrance,
# and Dostoori reaches this app over the dostoori_net network, not the host.
ufw --force enable >/dev/null
echo "  Only SSH + HTTP/HTTPS are open."

# ---------------------------------------------------------------- .env
say "Creating .env"
if [[ ! -f .env ]]; then
  cp .env.example .env

  # Generated, not typed: a human-chosen salt or session secret on a public
  # box is a guessable one.
  IP_SALT=$(openssl rand -hex 32)
  SESSION_SECRET=$(openssl rand -hex 32)
  ADMIN_PASS=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)

  sed -i "s|^IP_HASH_SALT=.*|IP_HASH_SALT=${IP_SALT}|" .env
  sed -i "s|^LAWYER_SESSION_SECRET=.*|LAWYER_SESSION_SECRET=${SESSION_SECRET}|" .env
  sed -i "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=${ADMIN_PASS}|" .env

  echo ""
  echo "  ┌────────────────────────────────────────────────┐"
  echo "  │  ADMIN PASSWORD — save this now:               │"
  echo "  │  ${ADMIN_PASS}"
  echo "  └────────────────────────────────────────────────┘"
  echo ""
  echo "  Still required in .env (by hand):"
  echo "    DATABASE_URL          — the Neon Postgres URL (with ?sslmode=require)"
  echo "    OPENAI_API_KEY        — sk-..."
  echo "    INTERNAL_SERVICE_KEY  — must EQUAL Dostoori's AI_LEGAL_SERVICE_KEY"
else
  echo "  .env already exists — left untouched."
fi

say "Bootstrap complete"
cat <<'EOF'
  Next:
    1. nano .env                  # DATABASE_URL (Neon), OPENAI_API_KEY, INTERNAL_SERVICE_KEY
    2. bash deploy/deploy.sh      # build, migrate, start (publishes 127.0.0.1:4000)

  nginx for this app is handled by dostoori/deploy/setup-nginx.sh (one config,
  both subdomains) — do NOT run a separate one here.
EOF
