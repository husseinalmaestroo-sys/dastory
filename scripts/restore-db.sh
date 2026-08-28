#!/usr/bin/env bash
# Decrypts and restores a backup produced by backup-db.sh. OVERWRITES the
# target database's tables. Strongly prefer restoring into a scratch
# database first (second argument) and verifying before ever pointing this
# at production — see BACKUP.md "Restoration procedure".
#
# Usage:
#   ./scripts/restore-db.sh <backup-file.sql.gz.enc> [target-db-name]
#
# Required:  BACKUP_ENCRYPTION_PASSPHRASE, DATABASE_URL (for connection
#            host/user/pass — the database *name* is overridden by the
#            optional second argument)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FILE="${1:?Usage: restore-db.sh <backup-file.sql.gz.enc> [target-db-name]}"

if [ ! -f "$FILE" ]; then
  echo "ERROR: backup file not found: $FILE" >&2
  exit 1
fi
if [ -z "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]; then
  echo "ERROR: BACKUP_ENCRYPTION_PASSPHRASE is not set." >&2
  exit 1
fi
if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set." >&2
  exit 1
fi
if ! command -v mysql >/dev/null 2>&1; then
  echo "ERROR: mysql client is not on PATH." >&2
  exit 1
fi

mapfile -t DB_PARTS < <(node "$SCRIPT_DIR/lib-db-url.mjs")
DB_HOST="${DB_PARTS[0]}"
DB_PORT="${DB_PARTS[1]}"
DB_USER="${DB_PARTS[2]}"
DB_PASS="${DB_PARTS[3]}"
TARGET_DB="${2:-${DB_PARTS[4]}}"

echo "About to restore '$FILE' into database '$TARGET_DB' on $DB_HOST:$DB_PORT."
echo "This OVERWRITES matching tables in that database. Ctrl+C now to cancel (5s)..."
sleep 5

# Verified by actually running this script against a database that did not
# exist yet: without this, the restore below fails outright with "Unknown
# database" — CREATE DATABASE IF NOT EXISTS makes restoring into a fresh
# scratch database (the documented, recommended-first workflow in
# BACKUP.md) work without a manual "create the empty DB" step the docs
# never actually told you to do.
echo "Ensuring target database exists ..."
MYSQL_PWD="$DB_PASS" mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" \
  -e "CREATE DATABASE IF NOT EXISTS \`$TARGET_DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

echo "Decrypting + restoring ..."
openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_ENCRYPTION_PASSPHRASE -in "$FILE" \
  | gunzip \
  | MYSQL_PWD="$DB_PASS" mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "$TARGET_DB"

echo "Restore complete. Verifying row counts:"
MYSQL_PWD="$DB_PASS" mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "$TARGET_DB" -e "
  SELECT 'Office' AS tbl, COUNT(*) AS cnt FROM Office
  UNION ALL SELECT 'User', COUNT(*) FROM User
  UNION ALL SELECT 'Client', COUNT(*) FROM Client
  UNION ALL SELECT 'Case', COUNT(*) FROM \`Case\`
  UNION ALL SELECT 'Document', COUNT(*) FROM Document
  UNION ALL SELECT 'Invoice', COUNT(*) FROM Invoice;
"
echo "Compare these counts against what you expect from the source environment before trusting this restore."
