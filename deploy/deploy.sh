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
#
# Phase 2.4: migrate.ts refuses production unless told it is production. This
# script deploys production by definition, so the operator confirms it — after
# the same migration and corpus preparation were run and reviewed on a Neon
# branch (PHASE2_CORPUS_REPAIR_REPORT.md §10).
if [[ "${CONFIRM_PRODUCTION:-}" != "yes" ]]; then
  echo "Set CONFIRM_PRODUCTION=yes to migrate PRODUCTION — only after the same commands ran on a Neon branch." >&2
  exit 1
fi
docker compose run --rm app npx tsx scripts/migrate.ts --confirm-production

say "Preparing the corpus"
# Since the corpus repair (2026-10) nothing is served until it has passed the
# integrity check, and the first migration to that schema leaves every older
# text 'unchecked' — the app still running serves nothing until this step has
# run. Same decisions as the reviewed dry run on the branch (same data); a
# no-op on later deploys except for texts not yet checked.
docker compose run --rm app npm run -s corpus:integrity -- prepare --apply --confirm-production

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
