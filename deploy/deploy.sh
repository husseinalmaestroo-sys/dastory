#!/usr/bin/env bash
#
# Build, back up, migrate and switch Dostoori to the current commit.
#
#   bash deploy/deploy.sh
#
# Order of operations, and why:
#   1. preflight     — every required setting present, before any work
#   2. build         — image tagged with the git commit (dostoori-app:<sha>);
#                      the running app is untouched
#   3. backup        — encrypted pre-migration DB backup; no backup, no deploy
#   4. migrate       — `prisma migrate deploy` from the NEW image; on failure
#                      the old app is still running (see "failed migration")
#   5. switch        — recreate the app container on the new image
#   6. health        — wait for the container's HEALTHCHECK and the version
#                      /api/health reports; unhealthy -> automatic rollback
#   7. smoke         — scripts/smoke.sh through the real URL (if node exists)
#
# Failed migration: MySQL DDL is not transactional, so a migration that dies
# half way can leave the schema partly changed; `migrate deploy` then refuses
# to run again until resolved. The old app keeps serving. Recover by
# restoring the pre-migration backup this script printed
# (scripts/restore-db.sh, BACKUP.md), fixing the migration, and redeploying.
#
# Rollback: deploy/rollback.sh [tag] — previous tag recorded in .deploy/.
#
# Assumes deploy/setup-vps.sh has run once and .env is filled in. Deploy
# ailegal_hussein first if the AI features are in use.
set -euo pipefail

say() { echo -e "\n\033[1;33m==> $1\033[0m"; }
die() { echo -e "\n\033[1;31mDEPLOY FAILED: $1\033[0m" >&2; exit 1; }

cd "$(dirname "$0")/.."
mkdir -p .deploy

[[ -f .env ]] || die ".env missing. Run deploy/setup-vps.sh first."

# ---------------------------------------------------------------- preflight
say "Preflight"
# Version of the running app container (the APP_VERSION baked into its image).
running_version() {
  docker inspect dostoori_app --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
    | sed -n 's/^APP_VERSION=//p' | head -1
}
envval() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
for var in JWT_SECRET TWO_FACTOR_ENCRYPTION_KEY MYSQL_PASSWORD MYSQL_ROOT_PASSWORD APP_URL PLATFORM_ADMIN_EMAILS BACKUP_ENCRYPTION_PASSPHRASE; do
  val=$(envval "$var")
  if [[ -z "$val" || "$val" == change-* || "$val" == "..." ]]; then
    die "${var} is not set (or still a placeholder) in .env."
  fi
done
[[ "$(envval APP_URL)" == https://* ]] || die "APP_URL must be the public https:// origin (it is used in every emailed link)."
if [[ -z "$(envval AI_LEGAL_SERVICE_KEY)" ]]; then
  echo "  NOTE: AI_LEGAL_SERVICE_KEY not set — AI features will answer 503 (the rest of the app is unaffected)."
fi
docker network inspect dostoori_net >/dev/null 2>&1 || die "dostoori_net missing — run deploy/setup-vps.sh."

if [[ "${DEPLOY_SKIP_PULL:-0}" != "1" ]] && git rev-parse --git-dir >/dev/null 2>&1; then
  git pull --ff-only || die "git pull --ff-only failed (offline, or the checkout has diverged).
  Fix the checkout, or set DEPLOY_SKIP_PULL=1 to deploy exactly what is checked out."
fi
VERSION="$(git rev-parse --short=12 HEAD 2>/dev/null || date -u +%Y%m%d%H%M%S)"
if [[ -n "$(git status --porcelain --untracked-files=no 2>/dev/null)" ]]; then
  VERSION="${VERSION}-dirty"
  echo "  WARNING: working tree has local changes — tagging as ${VERSION}."
fi
export APP_VERSION="$VERSION"
PREVIOUS="$(running_version || true)"
echo "  deploying ${VERSION} (currently running: ${PREVIOUS:-nothing})"

# The container runs as uid 1000 (`node`); a bind-mounted dir that Docker
# auto-created as root would fail the /api/health storage check.
mkdir -p storage/case-documents backups
chown -R 1000:1000 storage

# ---------------------------------------------------------------- database
say "Starting database"
docker compose up -d db
echo -n "  waiting for mysql"
for i in {1..60}; do
  if [[ "$(docker inspect dostoori_db --format '{{.State.Health.Status}}' 2>/dev/null)" == "healthy" ]]; then
    echo " — ready"; break
  fi
  echo -n "."; sleep 2
  [[ $i -eq 60 ]] && { echo; docker compose logs --tail=20 db; die "database did not become healthy."; }
done

# ---------------------------------------------------------------- build
# Re-running a deploy of the same commit reuses its image (also lets an
# image built elsewhere, e.g. in CI, be `docker load`ed and deployed).
# DEPLOY_REBUILD=1 forces a fresh build.
if docker image inspect "dostoori-app:${VERSION}" >/dev/null 2>&1 && [[ "${DEPLOY_REBUILD:-0}" != "1" ]]; then
  say "Image dostoori-app:${VERSION} already built — reusing it"
else
  say "Building dostoori-app:${VERSION}"
  docker compose build app
fi

# ---------------------------------------------------------------- backup
say "Pre-migration backup"
BACKUP_FILE="$(bash deploy/backup.sh db | tail -1)" || die "backup failed — nothing was changed."
[[ -f "$BACKUP_FILE" ]] || die "backup did not produce a file — nothing was changed."
echo "$BACKUP_FILE" > .deploy/last_backup
echo "  restore point: $BACKUP_FILE"

# ---------------------------------------------------------------- migrate
say "Applying migrations (new image, old app still serving)"
if ! docker compose run --rm --no-deps -T app node node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma; then
  docker compose run --rm --no-deps -T app node node_modules/prisma/build/index.js migrate status --schema prisma/schema.prisma || true
  die "migration failed. The previous version (${PREVIOUS:-none}) is still running.
  Restore point: ${BACKUP_FILE}
  See BACKUP.md 'Restoration procedure', fix the migration, then redeploy."
fi

# ---------------------------------------------------------------- switch
say "Switching app to ${VERSION}"
docker compose up -d --no-deps app

wait_healthy() {
  local want="$1"
  for i in {1..60}; do
    local status
    status="$(docker inspect dostoori_app --format '{{.State.Health.Status}}' 2>/dev/null || echo missing)"
    if [[ "$status" == "healthy" ]]; then
      local body
      body="$(curl -fsS -m 5 http://127.0.0.1:3000/api/health || true)"
      if [[ "$body" == *"\"version\":\"${want}\""* ]]; then return 0; fi
    fi
    [[ "$status" == "unhealthy" ]] && return 1
    sleep 3
  done
  return 1
}

say "Waiting for health"
if ! wait_healthy "$VERSION"; then
  echo "  ${VERSION} did not become healthy. Recent logs:" >&2
  docker compose logs --tail=60 app >&2
  if [[ -n "$PREVIOUS" && "$PREVIOUS" != "$VERSION" ]]; then
    say "Rolling back to ${PREVIOUS}"
    APP_VERSION="$PREVIOUS" docker compose up -d --no-deps app
    if wait_healthy "$PREVIOUS"; then
      docker tag "dostoori-app:${PREVIOUS}" dostoori-app:current
      die "${VERSION} was unhealthy; rolled back to ${PREVIOUS} (healthy). Migrations stay applied —
  if they were not backward compatible, restore ${BACKUP_FILE}."
    fi
    die "${VERSION} unhealthy AND rollback to ${PREVIOUS} unhealthy. Restore point: ${BACKUP_FILE}"
  fi
  die "${VERSION} unhealthy and there is no previous version to roll back to."
fi
echo "  healthy: $(curl -fsS http://127.0.0.1:3000/api/health)"
docker tag "dostoori-app:${VERSION}" dostoori-app:current

[[ -n "$PREVIOUS" && "$PREVIOUS" != "$VERSION" ]] && echo "$PREVIOUS" > .deploy/previous
echo "$VERSION" > .deploy/current
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) ${VERSION} (from ${PREVIOUS:-none}) backup=${BACKUP_FILE}" >> .deploy/history

# ---------------------------------------------------------------- smoke
# Full-workflow smoke through the real URL — signup, the CRUD loop, an
# upload + e-signature, and (when configured) the AI path. A failure here
# means the deploy is broken even though the container is healthy.
SMOKE_URL="${SMOKE_URL:-http://127.0.0.1:3000}"
if command -v node >/dev/null 2>&1; then
  say "Smoke test ($SMOKE_URL)"
  scripts/smoke.sh "$SMOKE_URL" || {
    docker compose logs --tail=40 app >&2
    die "smoke test failed on ${VERSION}. Roll back with: bash deploy/rollback.sh"
  }
else
  echo "  (node not on PATH — skipping scripts/smoke.sh; run it by hand against the public URL)" >&2
fi

# Keep the five most recent images for rollback; drop older ones.
docker images dostoori-app --format '{{.CreatedAt}}\t{{.Repository}}:{{.Tag}}' | grep -v ':current$' | sort -r | tail -n +6 | cut -f2 \
  | grep -v -e ":${VERSION}\$" -e ":${PREVIOUS:-__none__}\$" | xargs -r docker rmi >/dev/null 2>&1 || true

say "Deployed ${VERSION}"
docker compose ps
