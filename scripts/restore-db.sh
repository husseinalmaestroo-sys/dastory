#!/usr/bin/env bash
# Decrypts and restores a backup produced by backup-db.sh. OVERWRITES the
# target database's tables. Strongly prefer restoring into a scratch
# database first (second argument) and verifying before ever pointing this
# at production — see BACKUP.md "Restoration procedure".
#
# Usage:
#   ./scripts/restore-db.sh <backup-file.sql.gz.enc> [target-db-name]
#
# Required:  BACKUP_ENCRYPTION_PASSPHRASE, and BACKUP_DB_SERVICE (docker
#            mode) or DATABASE_URL (direct mode) — see lib-backup.sh. The
#            target database name defaults to the app's own database.
# Optional:  RESTORE_DB_DROP_FIRST=1 — drop and recreate the target database
#            before importing, so the result is EXACTLY the backup. Without
#            it, tables the backup doesn't contain (e.g. one created by a
#            migration that failed half way) survive the restore. Use it to
#            return to a pre-migration restore point; stop the app first
#            (docker compose stop app) or it will error while the DB is empty.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=lib-backup.sh
. "$SCRIPT_DIR/lib-backup.sh"
FILE="${1:?Usage: restore-db.sh <backup-file.sql.gz.enc> [target-db-name]}"

if [ ! -f "$FILE" ]; then
  echo "ERROR: backup file not found: $FILE" >&2
  exit 1
fi
if [ -z "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]; then
  echo "ERROR: BACKUP_ENCRYPTION_PASSPHRASE is not set." >&2
  exit 1
fi
backup_db_init
TARGET_DB="${2:-$DB_NAME}"
case "$TARGET_DB" in *[!A-Za-z0-9_]*) echo "ERROR: invalid database name: $TARGET_DB" >&2; exit 1 ;; esac

echo "About to restore '$FILE' into database '$TARGET_DB' via $DB_DESC."
if [ "${RESTORE_DB_NO_PROMPT:-}" = "1" ]; then
  echo "RESTORE_DB_NO_PROMPT=1 — skipping the confirmation pause (used by restore-drill.sh)."
else
  echo "This OVERWRITES matching tables in that database. Ctrl+C now to cancel (5s)..."
  sleep 5
fi

if [ "${RESTORE_DB_DROP_FIRST:-}" = "1" ]; then
  echo "RESTORE_DB_DROP_FIRST=1 — dropping '$TARGET_DB' so it matches the backup exactly ..."
  db_exec mysql -e "DROP DATABASE IF EXISTS \`$TARGET_DB\`;"
fi
echo "Ensuring target database exists ..."
db_exec mysql -e "CREATE DATABASE IF NOT EXISTS \`$TARGET_DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

echo "Decrypting + restoring ..."
openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_ENCRYPTION_PASSPHRASE -in "$FILE" \
  | gunzip \
  | db_exec mysql "$TARGET_DB"

echo "Restore complete. Row counts:"
db_exec mysql "$TARGET_DB" -e "
  SELECT 'Office' AS tbl, COUNT(*) AS cnt FROM Office
  UNION ALL SELECT 'User', COUNT(*) FROM User
  UNION ALL SELECT 'Client', COUNT(*) FROM Client
  UNION ALL SELECT 'Case', COUNT(*) FROM \`Case\`
  UNION ALL SELECT 'Document', COUNT(*) FROM Document
  UNION ALL SELECT 'Invoice', COUNT(*) FROM Invoice;
"
echo "Compare these counts against what you expect from the source environment before trusting this restore."
