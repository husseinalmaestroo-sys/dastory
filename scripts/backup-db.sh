#!/usr/bin/env bash
# Dumps the MySQL database, compresses it, encrypts it at rest (AES-256,
# PBKDF2), prunes old local copies and ships the new one off-host.
# Production entry point: deploy/backup.sh (loads .env, docker mode).
#
# Required:
#   BACKUP_ENCRYPTION_PASSPHRASE a strong passphrase — NOT one of the app's
#                                 other secrets; generate with
#                                 openssl rand -base64 48
#                                 and store it somewhere other than this host
#                                 (a password manager / secrets vault) — if
#                                 this host is lost, you need the passphrase
#                                 from elsewhere to restore.
#   and either BACKUP_DB_SERVICE (docker mode, e.g. "db") or DATABASE_URL
#   (direct mode) — see scripts/lib-backup.sh.
# Optional:
#   BACKUP_DIR                   default: <repo>/backups/db
#   BACKUP_RETENTION_DAYS        default: 14 (local copies)
#   BACKUP_RCLONE_REMOTE         e.g. "b2:my-bucket/dostoori" — encrypted
#                                 copy goes to <remote>/db, verified by size
#   BACKUP_REMOTE_RETENTION_DAYS prune remote copies older than this
#   BACKUP_REQUIRE_OFFHOST=1     treat a missing remote as a failure
#   BACKUP_ALERT_WEBHOOK         POSTed to on any failure
#
# Prints the written file's path as the last line of stdout (deploy.sh
# records it as the pre-migration restore point).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=lib-backup.sh
. "$SCRIPT_DIR/lib-backup.sh"
backup_alert_on_failure "database backup"

BACKUP_DIR="${BACKUP_DIR:-$SCRIPT_DIR/../backups/db}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"

if [ -z "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]; then
  echo "ERROR: BACKUP_ENCRYPTION_PASSPHRASE is not set — refusing to write an unencrypted backup." >&2
  exit 1
fi
backup_db_init

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
OUT_FILE="$BACKUP_DIR/dostoori-db-$TIMESTAMP.sql.gz.enc"
TMP_FILE="$OUT_FILE.tmp"
trap 'rm -f "$TMP_FILE"' ERR

echo "Dumping '$DB_NAME' via $DB_DESC ..." >&2
# pipefail makes a mysqldump failure fail the whole pipeline, so a truncated
# dump is never renamed into place.
db_exec mysqldump --single-transaction --quick --routines --triggers --no-tablespaces "$DB_NAME" \
  | gzip \
  | openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:BACKUP_ENCRYPTION_PASSPHRASE \
  > "$TMP_FILE"

# A dump that decrypts and ends with mysqldump's completion marker is a
# complete dump; anything else is a failed backup.
if ! openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_ENCRYPTION_PASSPHRASE -in "$TMP_FILE" \
     | gunzip | tail -c 200 | grep -q -- '-- Dump completed'; then
  echo "ERROR: the dump did not verify (no completion marker after decrypting)." >&2
  exit 1
fi

mv "$TMP_FILE" "$OUT_FILE"
chmod 600 "$OUT_FILE"
echo "Backup written: $OUT_FILE ($(du -h "$OUT_FILE" | cut -f1))" >&2

find "$BACKUP_DIR" -maxdepth 1 -name 'dostoori-db-*.sql.gz.enc' -mtime "+$RETENTION_DAYS" -print -delete >&2

backup_ship_offhost "$OUT_FILE" db >&2
echo "$OUT_FILE"
