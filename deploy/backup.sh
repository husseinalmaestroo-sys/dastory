#!/usr/bin/env bash
#
# Backs up the database and the uploaded PDFs.
#
#   bash deploy/backup.sh
#
# Schedule it nightly:
#   crontab -e
#   0 3 * * * cd /opt/ai-legal && bash deploy/backup.sh >> /var/log/legal-backup.log 2>&1
#
# Both halves matter and neither substitutes for the other: the dump alone
# restores rows whose file_path points at PDFs that no longer exist, and a
# re-index would then fail on every source.
set -euo pipefail

cd "$(dirname "$0")/.."

BACKUP_DIR="${BACKUP_DIR:-/var/backups/ai-legal}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP=$(date +%Y%m%d-%H%M%S)

mkdir -p "$BACKUP_DIR"

echo "==> Dumping database"
# -Fc is the custom format: compressed, and restorable selectively with
# pg_restore rather than being one giant SQL replay.
docker compose exec -T db pg_dump -U legal -d ai_legal -Fc \
  >"${BACKUP_DIR}/db-${STAMP}.dump"

echo "==> Archiving uploaded PDFs"
if [[ -d storage ]] && [[ -n "$(ls -A storage 2>/dev/null)" ]]; then
  tar czf "${BACKUP_DIR}/storage-${STAMP}.tar.gz" storage
else
  echo "  storage/ is empty — skipping."
fi

echo "==> Pruning backups older than ${KEEP_DAYS} days"
find "$BACKUP_DIR" -name 'db-*.dump' -mtime +"$KEEP_DAYS" -delete
find "$BACKUP_DIR" -name 'storage-*.tar.gz' -mtime +"$KEEP_DAYS" -delete

echo "==> Done"
du -sh "$BACKUP_DIR"
ls -lh "$BACKUP_DIR" | tail -5

cat <<EOF

  To restore:
    docker compose exec -T db psql -U legal -d postgres -c 'DROP DATABASE ai_legal;'
    docker compose exec -T db psql -U legal -d postgres -c 'CREATE DATABASE ai_legal;'
    docker compose exec -T db pg_restore -U legal -d ai_legal < ${BACKUP_DIR}/db-${STAMP}.dump
    tar xzf ${BACKUP_DIR}/storage-${STAMP}.tar.gz
EOF
