#!/usr/bin/env bash
#
# Restore the NeuroPause Postgres database from a backup produced by backup-db.sh.
#
#   scripts/restore-db.sh backups/neuropause-db-YYYYMMDD-HHMMSS.sql.gz
#
# The dump is created with --clean --if-exists, so it drops and recreates objects.
# This OVERWRITES the current database and asks for confirmation first.
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
SERVICE="${POSTGRES_SERVICE:-postgres}"
BACKUP_FILE="${1:-}"

if [ -z "$BACKUP_FILE" ] || [ ! -f "$BACKUP_FILE" ]; then
  echo "Usage: $0 <backup-file.sql.gz>" >&2
  echo "Available backups:" >&2
  find backups -maxdepth 1 -name '*.sql.gz' 2>/dev/null | sort -r >&2 || echo "  (none found in ./backups)" >&2
  exit 1
fi

echo "WARNING: this overwrites the current database with:"
echo "  $BACKUP_FILE"
printf "Type 'yes' to continue: "
read -r CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Aborted."
  exit 1
fi

echo "Restoring ..."
gunzip -c "$BACKUP_FILE" | docker compose -f "$COMPOSE_FILE" exec -T "$SERVICE" \
  sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" "$POSTGRES_DB"'

echo "Restore complete."
