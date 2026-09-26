#!/usr/bin/env bash
#
# Switch the app back to an earlier image.
#
#   bash deploy/rollback.sh            # the version before the current one
#   bash deploy/rollback.sh <tag>      # any kept tag: docker images dostoori-app
#
# Rolls back CODE only. Migrations are not reverted: every migration in
# this repo is additive/compatible with the previous release unless its
# own comment says otherwise. If a release's migration was not, restore the
# pre-migration backup recorded in .deploy/last_backup (BACKUP.md).
set -euo pipefail

say() { echo -e "\n\033[1;33m==> $1\033[0m"; }
cd "$(dirname "$0")/.."

TARGET="${1:-$(cat .deploy/previous 2>/dev/null || true)}"
[[ -n "$TARGET" ]] || { echo "No previous version recorded in .deploy/previous — pass a tag (docker images dostoori-app)." >&2; exit 1; }
docker image inspect "dostoori-app:${TARGET}" >/dev/null 2>&1 \
  || { echo "Image dostoori-app:${TARGET} not found. Available:" >&2; docker images dostoori-app >&2; exit 1; }

CURRENT="$(docker inspect dostoori_app --format '{{.Config.Image}}' 2>/dev/null | sed 's/^dostoori-app://' || true)"
say "Rolling back ${CURRENT:-?} -> ${TARGET}"
APP_VERSION="$TARGET" docker compose up -d --no-deps app

for _ in {1..60}; do
  status="$(docker inspect dostoori_app --format '{{.State.Health.Status}}' 2>/dev/null || echo missing)"
  body="$(curl -fsS -m 5 http://127.0.0.1:3000/api/health 2>/dev/null || true)"
  if [[ "$status" == "healthy" && "$body" == *"\"version\":\"${TARGET}\""* ]]; then
    mkdir -p .deploy
    echo "$TARGET" > .deploy/current
    [[ -n "$CURRENT" ]] && echo "$CURRENT" > .deploy/previous
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) rollback ${CURRENT:-?} -> ${TARGET}" >> .deploy/history
    say "Rolled back to ${TARGET} (healthy)"
    exit 0
  fi
  [[ "$status" == "unhealthy" ]] && break
  sleep 3
done
docker compose logs --tail=60 app >&2
echo "Rollback target ${TARGET} did not become healthy." >&2
exit 1
