#!/usr/bin/env bash
# Archives and encrypts the uploaded-document storage directory
# (storage/case-documents). Same encryption/retention/off-host model as
# backup-db.sh — see that file and BACKUP.md for the full picture.
#
# Required:  BACKUP_ENCRYPTION_PASSPHRASE
# Optional:  BACKUP_DIR (default: <repo>/backups/files)
#            BACKUP_RETENTION_DAYS (default: 14)
#            STORAGE_DIR (default: <repo>/storage)
#            BACKUP_RCLONE_REMOTE
#
# Usage (cron):  30 3 * * * cd /path/to/app && ./scripts/backup-files.sh >> backups/files/backup.log 2>&1
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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
OUT_FILE="$BACKUP_DIR/dostoori-files-$TIMESTAMP.tar.gz.enc"
TMP_FILE="$OUT_FILE.tmp"

echo "Archiving $SOURCE_DIR ..."
tar -C "$(dirname "$SOURCE_DIR")" -czf - "$(basename "$SOURCE_DIR")" \
  | openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:BACKUP_ENCRYPTION_PASSPHRASE \
  > "$TMP_FILE"

mv "$TMP_FILE" "$OUT_FILE"
echo "Backup written: $OUT_FILE ($(du -h "$OUT_FILE" | cut -f1))"

find "$BACKUP_DIR" -maxdepth 1 -name 'dostoori-files-*.tar.gz.enc' -mtime "+$RETENTION_DAYS" -print -delete

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
