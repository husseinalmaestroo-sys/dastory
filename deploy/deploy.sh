#!/usr/bin/env bash
#
# Build, migrate, restart Dostoori. Run after every code change.
#
#   bash deploy/deploy.sh
#
# Assumes deploy/setup-vps.sh has run once and .env is filled in. Deploy
# ailegal_hussein FIRST (cd ../ailegal_hussein && bash deploy/deploy.sh) so
# legal_app is up before Dostoori's health check probes the AI path.
set -euo pipefail

say() { echo -e "\n\033[1;33m==> $1\033[0m"; }

cd "$(dirname "$0")/.."

[[ -f .env ]] || { echo ".env missing. Run deploy/setup-vps.sh first." >&2; exit 1; }

# Fail early rather than after a 3-minute build.
for var in JWT_SECRET TWO_FACTOR_ENCRYPTION_KEY MYSQL_PASSWORD AI_LEGAL_SERVICE_KEY; do
  val=$(grep -E "^${var}=" .env | head -1 | cut -d= -f2- | tr -d '"')
  if [[ -z "$val" || "$val" == change-* || "$val" == "..." ]]; then
    echo "${var} is not set (or still a placeholder) in .env." >&2
    exit 1
  fi
done

docker network inspect dostoori_net >/dev/null 2>&1 || {
  echo "dostoori_net missing — run deploy/setup-vps.sh." >&2; exit 1;
}

say "Pulling latest code"
git pull --ff-only || echo "  (not a git checkout or nothing to pull — continuing)"

# The container runs as uid 1000 (`node`); a bind-mounted dir that Docker
# auto-created as root would fail the /api/health storage check.
say "Preparing storage dir"
mkdir -p storage/case-documents
chown -R 1000:1000 storage

say "Starting database"
docker compose up -d db
echo -n "  waiting for mysql"
for i in {1..30}; do
  if docker compose exec -T db mysqladmin ping -h 127.0.0.1 --silent &>/dev/null; then
    echo " — ready"; break
  fi
  echo -n "."; sleep 2
  [[ $i -eq 30 ]] && { echo " — TIMED OUT"; docker compose logs db | tail -20; exit 1; }
done

say "Building app"
docker compose build app

say "Applying migrations"
# The runtime image carries the Prisma CLI + prisma/ for exactly this. Invoke
# its entry point directly — the standalone build prunes node_modules/.bin,
# so `npx prisma` would try to download it.
docker compose run --rm app node node_modules/prisma/build/index.js migrate deploy

say "Starting app"
docker compose up -d app

say "Health check"
sleep 5
code=$(curl -fsS -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health || true)
if [[ "$code" == "200" ]]; then
  echo "  App is serving on 127.0.0.1:3000 (health: 200)"
else
  echo "  Health check returned '${code}'. Recent logs:" >&2
  docker compose logs --tail=40 app >&2
  exit 1
fi

# Full-workflow smoke through the real URL — signup, the CRUD loop, an
# upload + e-signature, and (unless SMOKE_REQUIRE_AI is unset and the AI
# service isn't configured) a contract review + a 2-turn assistant chat.
# A failure here means the deploy is broken even though the container is
# up; it exits non-zero and takes the deploy with it.
SMOKE_URL="${SMOKE_URL:-http://127.0.0.1:3000}"
if command -v node >/dev/null 2>&1; then
  say "Smoke test ($SMOKE_URL)"
  "$(dirname "$0")/../scripts/smoke.sh" "$SMOKE_URL" || {
    echo "  smoke test failed — see output above." >&2
    docker compose logs --tail=40 app >&2
    exit 1
  }
else
  echo "  (node not on PATH — skipping scripts/smoke.sh; run it by hand against the public URL)" >&2
fi

say "Deployed"
docker compose ps
