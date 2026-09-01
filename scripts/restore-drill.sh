#!/usr/bin/env bash
# Disaster-recovery drill: takes a real encrypted backup, restores it into a
# throwaway scratch database, and verifies it is actually usable —
# schema matches the committed migrations, core tables are non-empty, and
# Prisma can connect. Drops the scratch database afterwards, always.
#
# Exit 0 = the backup restores clean. Any non-zero exit is a real signal:
# wire this into cron + your alerting so a broken backup pages you BEFORE
# you need it for real.
#
# Required:
#   BACKUP_ENCRYPTION_PASSPHRASE   same as backup-db.sh
#   DATABASE_URL  (or DRILL_DATABASE_URL to override)  — connection
#     host/port/user/pass; the database NAME is ignored (a scratch name is
#     generated). The user must be able to CREATE/DROP DATABASE.
#     On the VPS: point DRILL_DATABASE_URL at 127.0.0.1:3306 with the root
#     credentials (the db container publishes that port).
#
# Optional:
#   BACKUP_DIR                     default: <repo>/backups/db
#   DRILL_BASELINE_FILE            default: <repo>/backups/drill-baseline.txt
#
# Usage:
#   ./scripts/restore-drill.sh [backup-file.sql.gz.enc]
#     no argument -> the newest backup in BACKUP_DIR
#
# Cron (monthly, first of the month, 04:30 UTC):
#   30 4 1 * * cd /path/to/app && DRILL_DATABASE_URL='mysql://root:PW@127.0.0.1:3306/mysql' \
#     ./scripts/restore-drill.sh >> backups/drill.log 2>&1 || \
#     curl -fsS -m 20 "$DRILL_ALERT_WEBHOOK" -d 'restore drill FAILED'
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$REPO_DIR/backups/db}"
BASELINE_FILE="${DRILL_BASELINE_FILE:-$REPO_DIR/backups/drill-baseline.txt}"
START_TS="$(date +%s)"

fail() { echo "DRILL FAILED: $*" >&2; exit 1; }

[ -n "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ] || fail "BACKUP_ENCRYPTION_PASSPHRASE is not set."
export DATABASE_URL="${DRILL_DATABASE_URL:-${DATABASE_URL:-}}"
[ -n "$DATABASE_URL" ] || fail "Neither DRILL_DATABASE_URL nor DATABASE_URL is set."
command -v mysql >/dev/null 2>&1 || fail "mysql client is not on PATH."
command -v npx   >/dev/null 2>&1 || fail "npx is not on PATH."

# --- pick the backup file ---------------------------------------------------
FILE="${1:-}"
if [ -z "$FILE" ]; then
  FILE="$(find "$BACKUP_DIR" -maxdepth 1 -name 'dostoori-db-*.sql.gz.enc' -type f -printf '%T@ %p\n' 2>/dev/null \
          | sort -rn | head -1 | cut -d' ' -f2-)"
  [ -n "$FILE" ] || fail "no backup found in $BACKUP_DIR (and none given as an argument)."
fi
[ -f "$FILE" ] || fail "backup file not found: $FILE"
echo "==> Drilling backup: $FILE"

# Warn (do not fail) if the newest backup is stale — this is the RPO check.
FILE_AGE_H=$(( ( $(date +%s) - $(date -r "$FILE" +%s) ) / 3600 ))
echo "    backup age: ${FILE_AGE_H}h"
[ "$FILE_AGE_H" -le 26 ] || echo "WARNING: newest backup is ${FILE_AGE_H}h old (> 26h) — the nightly job may not be running." >&2

# --- connection parts + scratch db ---------------------------------------------
mapfile -t P < <(node "$SCRIPT_DIR/lib-db-url.mjs")
DB_HOST="${P[0]}"; DB_PORT="${P[1]}"; DB_USER="${P[2]}"; DB_PASS="${P[3]}"
SCRATCH="dostoori_drill_$(date -u +%Y%m%d%H%M%S)_$$"
myq() { MYSQL_PWD="$DB_PASS" mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -N -B "$@"; }

cleanup() { myq -e "DROP DATABASE IF EXISTS \`$SCRATCH\`;" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "==> Restoring into scratch database: $SCRATCH"
RESTORE_DB_NO_PROMPT=1 "$SCRIPT_DIR/restore-db.sh" "$FILE" "$SCRATCH" \
  || fail "restore-db.sh returned non-zero."

# --- schema matches the committed migrations ------------------------------------
echo "==> Checking schema against prisma/migrations"
SCRATCH_URL="mysql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${SCRATCH}"
if ! DATABASE_URL="$SCRATCH_URL" npx --yes prisma migrate status >/tmp/drill-migrate-$$.txt 2>&1; then
  cat /tmp/drill-migrate-$$.txt >&2; rm -f /tmp/drill-migrate-$$.txt
  fail "prisma migrate status non-zero — the backup's schema does not match prisma/migrations."
fi
rm -f /tmp/drill-migrate-$$.txt
echo "    schema OK"

# --- Prisma can actually bind to the restored data ---------------------------
echo "==> Prisma connectivity check"
echo 'SELECT 1;' | DATABASE_URL="$SCRATCH_URL" npx --yes prisma db execute --stdin >/dev/null 2>&1 \
  || fail "prisma db execute could not run against the restored database."
echo "    connectivity OK"

# --- row counts: non-empty + drift vs the recorded baseline -------------------
echo "==> Row counts"
COUNTS="$(myq "$SCRATCH" -e "
  SELECT 'Office',   COUNT(*) FROM Office
  UNION ALL SELECT 'User',     COUNT(*) FROM User
  UNION ALL SELECT 'Client',   COUNT(*) FROM Client
  UNION ALL SELECT 'Case',     COUNT(*) FROM \`Case\`
  UNION ALL SELECT 'Session',  COUNT(*) FROM Session
  UNION ALL SELECT 'Invoice',  COUNT(*) FROM Invoice
  UNION ALL SELECT 'Document', COUNT(*) FROM Document;")"
echo "$COUNTS" | sed 's/^/    /'

get() { echo "$COUNTS" | awk -v k="$1" '$1==k{print $2}'; }
OFFICES="$(get Office)"; USERS="$(get User)"
[ "${OFFICES:-0}" -ge 1 ] || fail "restored backup has 0 rows in Office — an empty backup is a failed backup."
[ "${USERS:-0}"   -ge 1 ] || fail "restored backup has 0 rows in User."

if [ -f "$BASELINE_FILE" ]; then
  while read -r tbl prev; do
    now="$(get "$tbl")"; now="${now:-0}"
    if [ "$now" -lt "$prev" ]; then
      echo "WARNING: $tbl dropped ${prev} -> ${now} since the last passing drill." >&2
    fi
  done < "$BASELINE_FILE"
fi
mkdir -p "$(dirname "$BASELINE_FILE")"
echo "$COUNTS" > "$BASELINE_FILE"

RTO_S=$(( $(date +%s) - START_TS ))
echo ""
echo "DRILL PASSED — backup restores clean. RTO: ${RTO_S}s. RPO: newest backup ${FILE_AGE_H}h old."
