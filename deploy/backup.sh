#!/usr/bin/env bash
#
# Backup entry point on the VPS (cron + deploy.sh). Loads .env and runs the
# scripts in scripts/ in docker mode: mysqldump/mysql run inside the `db`
# container, so the host needs no MySQL client or Node.
#
#   bash deploy/backup.sh          # database + uploaded files (nightly cron)
#   bash deploy/backup.sh db       # database only (deploy.sh, pre-migration)
#   bash deploy/backup.sh drill    # restore the newest DB backup into a scratch
#                                  # database and verify it (monthly cron)
#
# Settings (in .env): BACKUP_ENCRYPTION_PASSPHRASE (required),
# BACKUP_RCLONE_REMOTE, BACKUP_REQUIRE_OFFHOST, BACKUP_RETENTION_DAYS,
# BACKUP_REMOTE_RETENTION_DAYS, BACKUP_ALERT_WEBHOOK. See BACKUP.md.
set -euo pipefail

cd "$(dirname "$0")/.."
[[ -f .env ]] || { echo ".env missing." >&2; exit 1; }
set -a
# shellcheck disable=SC1091
. ./.env
set +a
export BACKUP_DB_SERVICE="${BACKUP_DB_SERVICE:-db}"
export STORAGE_DIR="${STORAGE_DIR:-$PWD/storage}"

case "${1:-all}" in
  db)    scripts/backup-db.sh ;;
  files) scripts/backup-files.sh ;;
  all)   scripts/backup-db.sh && scripts/backup-files.sh ;;
  drill) scripts/restore-drill.sh "${2:-}" ;;
  *) echo "usage: deploy/backup.sh [all|db|files|drill [file]]" >&2; exit 2 ;;
esac
