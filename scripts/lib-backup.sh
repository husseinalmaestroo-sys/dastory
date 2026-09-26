# shellcheck shell=bash disable=SC2034
# Shared helpers for backup-db.sh / restore-db.sh / restore-drill.sh.
# Sourced, not executed.
#
# Two ways to reach MySQL:
#   docker mode  (BACKUP_DB_SERVICE=db, what deploy/backup.sh uses on the VPS)
#                mysqldump/mysql run INSIDE the compose db container as root,
#                using that container's own MYSQL_ROOT_PASSWORD — the host
#                needs neither a MySQL client nor Node.
#   direct mode  (BACKUP_DB_SERVICE unset) host mysqldump/mysql against
#                DATABASE_URL, parsed by lib-db-url.mjs.
#
# Failure alerts: if BACKUP_ALERT_WEBHOOK is set, any non-zero exit POSTs a
# one-line message to it (Slack/Discord/ntfy/healthchecks-style webhook).

backup_alert_on_failure() {
  local job="$1"
  # shellcheck disable=SC2064
  trap "rc=\$?; if [ \$rc -ne 0 ]; then backup_send_alert '$job' \"\$rc\"; fi" EXIT
}

backup_send_alert() {
  local job="$1" rc="$2"
  local msg
  msg="dostoori ${job} FAILED (exit ${rc}) on $(hostname) at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "ALERT: $msg" >&2
  if [ -n "${BACKUP_ALERT_WEBHOOK:-}" ]; then
    curl -fsS -m 20 -X POST -H 'Content-Type: application/json' \
      --data "{\"text\":\"${msg}\"}" "$BACKUP_ALERT_WEBHOOK" >/dev/null \
      || echo "WARNING: could not deliver the alert to BACKUP_ALERT_WEBHOOK" >&2
  else
    echo "WARNING: BACKUP_ALERT_WEBHOOK is not set — nobody was notified of this failure." >&2
  fi
}

# Loads connection settings for the chosen mode. Sets DB_NAME (the app's
# database) and defines db_* functions.
backup_db_init() {
  if [ -n "${BACKUP_DB_SERVICE:-}" ]; then
    command -v docker >/dev/null 2>&1 || { echo "ERROR: BACKUP_DB_SERVICE is set but docker is not on PATH." >&2; return 1; }
    DB_NAME="${MYSQL_DATABASE:-dostoori}"
    DB_DESC="compose service '${BACKUP_DB_SERVICE}'"
  else
    [ -n "${DATABASE_URL:-}" ] || { echo "ERROR: DATABASE_URL is not set (or set BACKUP_DB_SERVICE for docker mode)." >&2; return 1; }
    command -v node >/dev/null 2>&1 || { echo "ERROR: node is not on PATH (needed to parse DATABASE_URL)." >&2; return 1; }
    local parts
    mapfile -t parts < <(node "$(dirname "${BASH_SOURCE[0]}")/lib-db-url.mjs")
    DB_HOST="${parts[0]}"; DB_PORT="${parts[1]}"; DB_USER="${parts[2]}"; DB_PASS="${parts[3]}"; DB_NAME="${parts[4]}"
    DB_DESC="$DB_HOST:$DB_PORT"
  fi
}

# db_exec <mysql|mysqldump> [args...] — stdin/stdout pass through.
db_exec() {
  local tool="$1"; shift
  if [ -n "${BACKUP_DB_SERVICE:-}" ]; then
    # Password from the container's own environment, never on a command line.
    docker compose exec -T "$BACKUP_DB_SERVICE" sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec "$0" -uroot "$@"' "$tool" "$@"
  else
    command -v "$tool" >/dev/null 2>&1 || { echo "ERROR: $tool is not on PATH." >&2; return 1; }
    MYSQL_PWD="$DB_PASS" "$tool" -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "$@"
  fi
}

# Runs `prisma migrate status` against database <name> on the same server.
db_migrate_status() {
  local name="$1"
  if [ -n "${BACKUP_DB_SERVICE:-}" ]; then
    [ -n "${MYSQL_ROOT_PASSWORD:-}" ] || { echo "ERROR: MYSQL_ROOT_PASSWORD not in the environment (source .env)." >&2; return 1; }
    local pw; pw="$(node_urlencode "$MYSQL_ROOT_PASSWORD")"
    docker compose run --rm --no-deps -T -e "DATABASE_URL=mysql://root:${pw}@${BACKUP_DB_SERVICE}:3306/${name}" app \
      node node_modules/prisma/build/index.js migrate status --schema prisma/schema.prisma
  else
    local repo; repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    local pw; pw="$(node_urlencode "$DB_PASS")"
    DATABASE_URL="mysql://${DB_USER}:${pw}@${DB_HOST}:${DB_PORT}/${name}" \
      node "$repo/node_modules/prisma/build/index.js" migrate status --schema "$repo/prisma/schema.prisma"
  fi
}

# Percent-encodes a URL userinfo component without needing node on the host.
node_urlencode() {
  local s="$1" out="" c i
  for (( i=0; i<${#s}; i++ )); do
    c="${s:i:1}"
    case "$c" in [a-zA-Z0-9.~_-]) out+="$c" ;; *) out+="$(printf '%%%02X' "'$c")" ;; esac
  done
  printf '%s' "$out"
}

# Off-host copy + remote retention + verification that the copy landed.
backup_ship_offhost() {
  local file="$1" subdir="$2"
  if [ -z "${BACKUP_RCLONE_REMOTE:-}" ]; then
    if [ "${BACKUP_REQUIRE_OFFHOST:-0}" = "1" ]; then
      echo "ERROR: BACKUP_REQUIRE_OFFHOST=1 but BACKUP_RCLONE_REMOTE is not set." >&2; return 1
    fi
    echo "NOTE: BACKUP_RCLONE_REMOTE not set — this backup exists only on this host. See BACKUP.md." >&2
    return 0
  fi
  command -v rclone >/dev/null 2>&1 || { echo "ERROR: BACKUP_RCLONE_REMOTE is set but rclone is not installed." >&2; return 1; }
  local dest="${BACKUP_RCLONE_REMOTE%/}/${subdir}"
  rclone copy "$file" "$dest"
  # Don't trust the copy's exit code alone: confirm the object is there with the same size.
  local local_size remote_size
  local_size="$(stat -c %s "$file")"
  remote_size="$(rclone lsl "$dest" --include "/$(basename "$file")" | awk 'NR==1{print $1}')"
  [ "$local_size" = "$remote_size" ] || { echo "ERROR: off-host copy verification failed ($local_size vs ${remote_size:-missing} bytes)." >&2; return 1; }
  echo "Off-host copy verified: $dest/$(basename "$file") ($remote_size bytes)"
  if [ -n "${BACKUP_REMOTE_RETENTION_DAYS:-}" ]; then
    rclone delete --min-age "${BACKUP_REMOTE_RETENTION_DAYS}d" "$dest"
  fi
}
