#!/usr/bin/env bash
#
# One-time: turns backups on for this VPS, and proves they work before
# claiming so. Run after the first successful deploy.
#
#   bash deploy/setup-backups.sh
#
# 1. checks .env has BACKUP_ENCRYPTION_PASSPHRASE (generates one if absent —
#    COPY IT OFF THIS HOST, it is the only key to the backups)
# 2. takes a real backup (DB + files) and ships it off-host if configured
# 3. runs a restore drill on it — setup fails unless the restore passes
# 4. installs the cron schedule in /etc/cron.d/dostoori-backup:
#      nightly 03:17 UTC  database + files  (deploy/backup.sh)
#      monthly 1st 04:37  restore drill     (deploy/backup.sh drill)
#
# Off-host copies need rclone + a configured remote (BACKUP_RCLONE_REMOTE);
# see BACKUP.md. Failures POST to BACKUP_ALERT_WEBHOOK.
set -euo pipefail

say() { echo -e "\n\033[1;33m==> $1\033[0m"; }
cd "$(dirname "$0")/.."
APP_DIR="$PWD"

[[ $EUID -eq 0 ]] || { echo "Run as root (installs /etc/cron.d/dostoori-backup)." >&2; exit 1; }
[[ -f .env ]] || { echo ".env missing." >&2; exit 1; }

say "Encryption passphrase"
if ! grep -qE '^BACKUP_ENCRYPTION_PASSPHRASE=.+' .env; then
  PASS=$(openssl rand -base64 48 | tr -d '\n')
  printf '\nBACKUP_ENCRYPTION_PASSPHRASE="%s"\n' "$PASS" >> .env
  echo "  Generated BACKUP_ENCRYPTION_PASSPHRASE in .env."
  echo "  !! Copy it to your password manager NOW — without it the backups are unreadable."
else
  echo "  BACKUP_ENCRYPTION_PASSPHRASE present."
fi
chmod 600 .env

say "Off-host storage"
if grep -qE '^BACKUP_RCLONE_REMOTE=.+' .env; then
  command -v rclone >/dev/null || { echo "  BACKUP_RCLONE_REMOTE is set but rclone is not installed (see BACKUP.md)." >&2; exit 1; }
  echo "  rclone remote configured."
else
  echo "  WARNING: BACKUP_RCLONE_REMOTE not set — backups will exist only on this host," >&2
  echo "  which does not survive losing the host. Configure it (BACKUP.md) and re-run." >&2
fi
grep -qE '^BACKUP_ALERT_WEBHOOK=.+' .env || echo "  WARNING: BACKUP_ALERT_WEBHOOK not set — backup failures will not notify anyone." >&2

say "Taking a first backup"
bash deploy/backup.sh all

say "Restore drill (must pass)"
bash deploy/backup.sh drill

say "Installing cron schedule"
cat > /etc/cron.d/dostoori-backup <<EOF
# Installed by deploy/setup-backups.sh — Dostoori backups (UTC).
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
17 3 * * * root cd ${APP_DIR} && bash deploy/backup.sh all   >> ${APP_DIR}/backups/backup.log 2>&1
37 4 1 * * root cd ${APP_DIR} && bash deploy/backup.sh drill >> ${APP_DIR}/backups/drill.log 2>&1
EOF
chmod 644 /etc/cron.d/dostoori-backup
echo "  /etc/cron.d/dostoori-backup installed."

say "Backups are on — and the restore drill passed."
