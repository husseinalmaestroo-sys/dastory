#!/usr/bin/env bash
# Dumps the MySQL database (from DATABASE_URL), compresses, and encrypts it
# at rest with AES-256. Intended to run from cron on the production host.
#
# Required:
#   DATABASE_URL                 same value the app itself uses
#   BACKUP_ENCRYPTION_PASSPHRASE a strong passphrase — NOT one of the app's
#                                 other secrets; generate with e.g.
#                                 node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
#                                 and store it somewhere other than this host
#                                 (a password manager / secrets vault) — if
#                                 this host is lost, you need the passphrase
#                                 from elsewhere to restore.
# Optional:
#   BACKUP_DIR                   default: <repo>/backups/db
#   BACKUP_RETENTION_DAYS         default: 14
#   BACKUP_RCLONE_REMOTE         e.g. "b2:my-bucket/dostoori/db" — if set and
#                                 `rclone` is installed and configured, the
#                                 encrypted backup is also copied off-host.
#                                 See BACKUP.md for setup — this is the one
#                                 piece that requires manual, one-time setup
#                                 outside this repo.
#
# Usage (manual):   ./scripts/backup-db.sh
# Usage (cron):      0 3 * * * cd /path/to/app && ./scripts/backup-db.sh >> backups/db/backup.log 2>&1
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$SCRIPT_DIR/../backups/db}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set." >&2
  exit 1
fi
if [ -z "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]; then
  echo "ERROR: BACKUP_ENCRYPTION_PASSPHRASE is not set — refusing to write an unencrypted backup." >&2
  exit 1
fi
if ! command -v mysqldump >/dev/null 2>&1; then
  echo "ERROR: mysqldump is not on PATH." >&2
  exit 1
fi

mapfile -t DB_PARTS < <(node "$SCRIPT_DIR/lib-db-url.mjs")
DB_HOST="${DB_PARTS[0]}"
DB_PORT="${DB_PARTS[1]}"
DB_USER="${DB_PARTS[2]}"
DB_PASS="${DB_PARTS[3]}"
DB_NAME="${DB_PARTS[4]}"

mkdir -p "$BACKUP_DIR"
OUT_FILE="$BACKUP_DIR/dostoori-db-$TIMESTAMP.sql.gz.enc"
TMP_FILE="$OUT_FILE.tmp"

echo "Dumping '$DB_NAME' from $DB_HOST:$DB_PORT ..."
MYSQL_PWD="$DB_PASS" mysqldump \
  --single-transaction --quick --routines --triggers \
  -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "$DB_NAME" \
  | gzip \
  | openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:BACKUP_ENCRYPTION_PASSPHRASE \
  > "$TMP_FILE"

mv "$TMP_FILE" "$OUT_FILE"
echo "Backup written: $OUT_FILE ($(du -h "$OUT_FILE" | cut -f1))"

# Retention: drop local encrypted backups older than N days. Off-host copies
# (if BACKUP_RCLONE_REMOTE is set) are not touched by this — manage their
# retention in the remote/provider if needed.
find "$BACKUP_DIR" -maxdepth 1 -name 'dostoori-db-*.sql.gz.enc' -mtime "+$RETENTION_DAYS" -print -delete

if [ -n "${BACKUP_RCLONE_REMOTE:-}" ]; then
  if command -v rclone >/dev/null 2>&1; then
    rclone copy "$OUT_FILE" "$BACKUP_RCLONE_REMOTE"
    echo "Uploaded to $BACKUP_RCLONE_REMOTE"
  else
    echo "WARNING: BACKUP_RCLONE_REMOTE is set but rclone is not installed — backup stayed local only. See BACKUP.md." >&2
  fi
else
  echo "NOTE: BACKUP_RCLONE_REMOTE not set — this backup exists only on this host. See BACKUP.md for off-host storage setup." >&2
fi
