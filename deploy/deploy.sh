#!/usr/bin/env bash
#
# Build, migrate, restart. Run after every code change.
#
#   bash deploy/deploy.sh
#
set -euo pipefail

say() { echo -e "\n\033[1;33m==> $1\033[0m"; }

cd "$(dirname "$0")/.."

[[ -f .env ]] || { echo ".env missing. Run deploy/setup-vps.sh first." >&2; exit 1; }

# Fail loudly and early rather than building for three minutes and dying at
# the first request with a confusing runtime error.
if grep -q '^OPENAI_API_KEY=sk-replace-me' .env || ! grep -q '^OPENAI_API_KEY=sk-' .env; then
  echo "OPENAI_API_KEY is not set in .env." >&2
  exit 1
fi

say "Pulling latest code"
git pull --ff-only || echo "  (not a git checkout or nothing to pull — continuing)"

say "Building app"
docker compose build app

say "Applying migrations"
# Postgres is on Neon now (see docker-compose.yml) — no local db container to
# start first. scripts/migrate.ts applies db/schema.sql idempotently, so this
# is a no-op when the corpus DB is already provisioned.
docker compose run --rm app npx tsx scripts/migrate.ts

say "Starting app"
docker compose up -d app

say "Health check"
sleep 5
if curl -fsS -o /dev/null -w '%{http_code}' http://127.0.0.1:4000/ | grep -q '200'; then
  echo "  App is serving on 127.0.0.1:4000"
else
  echo "  App did not answer. Logs:" >&2
  docker compose logs --tail=40 app >&2
  exit 1
fi

say "Deployed"
docker compose ps
