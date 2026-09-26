#!/usr/bin/env bash
# Archives and encrypts the uploaded-document storage directory
# (storage/case-documents). Same encryption / retention / off-host / alert
# model as backup-db.sh — see that file and BACKUP.md.
#
# Required:  BACKUP_ENCRYPTION_PASSPHRASE
# Optional:  BACKUP_DIR (default: <repo>/backups/files)
#            BACKUP_RETENTION_DAYS (default: 14)
#            STORAGE_DIR (default: <repo>/storage)
#            BACKUP_RCLONE_REMOTE (copy goes to <remote>/files)
#            BACKUP_REMOTE_RETENTION_DAYS, BACKUP_REQUIRE_OFFHOST, BACKUP_ALERT_WEBHOOK
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=lib-backup.sh
. "$SCRIPT_DIR/lib-backup.sh"
backup_alert_on_failure "files backup"

BACKUP_DIR="${BACKUP_DIR:-$SCRIPT_DIR/../backups/files}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
SOURCE_DIR="${STORAGE_DIR:-$SCRIPT_DIR/../storage}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"

if [ -z "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]; then
  echo "ERROR: BACKUP_ENCRYPTION_PASSPHRASE is not set — refusing to write an unencrypted backup." >&2
  exit 1
fi
if [ ! -d "$SOURCE_DIR" ]; then
  echo "ERROR: storage directory not found: $SOURCE_DIR" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
OUT_FILE="$BACKUP_DIR/dostoori-files-$TIMESTAMP.tar.gz.enc"
TMP_FILE="$OUT_FILE.tmp"
trap 'rm -f "$TMP_FILE"' ERR

echo "Archiving $SOURCE_DIR ..." >&2
tar -C "$(dirname "$SOURCE_DIR")" -czf - "$(basename "$SOURCE_DIR")" \
  | openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:BACKUP_ENCRYPTION_PASSPHRASE \
  > "$TMP_FILE"

# Verify the archive decrypts and lists cleanly before trusting it.
openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_ENCRYPTION_PASSPHRASE -in "$TMP_FILE" \
  | tar -tzf - >/dev/null \
  || { echo "ERROR: the archive did not verify." >&2; exit 1; }

mv "$TMP_FILE" "$OUT_FILE"
chmod 600 "$OUT_FILE"
echo "Backup written: $OUT_FILE ($(du -h "$OUT_FILE" | cut -f1))" >&2

find "$BACKUP_DIR" -maxdepth 1 -name 'dostoori-files-*.tar.gz.enc' -mtime "+$RETENTION_DAYS" -print -delete >&2

backup_ship_offhost "$OUT_FILE" files >&2
echo "$OUT_FILE"
