#!/usr/bin/env bash
#
# Back up the NeuroPause Postgres database from the production Compose stack.
# Writes a timestamped, gzip-compressed dump to ./backups and prunes old ones.
#
#   scripts/backup-db.sh
#
# Config via environment (all optional):
#   COMPOSE_FILE       compose file to target      (default: docker-compose.prod.yml)
#   POSTGRES_SERVICE   postgres service name        (default: postgres)
#   BACKUP_DIR         output directory             (default: backups)
#   BACKUP_RETENTION   how many dumps to keep       (default: 14)
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
SERVICE="${POSTGRES_SERVICE:-postgres}"
BACKUP_DIR="${BACKUP_DIR:-backups}"
RETENTION="${BACKUP_RETENTION:-14}"

mkdir -p "$BACKUP_DIR"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUTFILE="$BACKUP_DIR/neuropause-db-$TIMESTAMP.sql.gz"

echo "Backing up the database to $OUTFILE ..."
# pg_dump runs inside the container, using its own POSTGRES_USER / POSTGRES_DB
# (set by Compose), so this script needs no database credentials.
docker compose -f "$COMPOSE_FILE" exec -T "$SERVICE" \
  sh -c 'pg_dump --clean --if-exists --no-owner --no-privileges -U "$POSTGRES_USER" "$POSTGRES_DB"' \
  | gzip -c >"$OUTFILE"

echo "Backup complete: $(du -h "$OUTFILE" | cut -f1)"

# Prune old backups, keeping the most recent $RETENTION.
COUNT="$(find "$BACKUP_DIR" -maxdepth 1 -name 'neuropause-db-*.sql.gz' | wc -l | tr -d ' ')"
if [ "$COUNT" -gt "$RETENTION" ]; then
  echo "Pruning old backups (keeping $RETENTION of $COUNT) ..."
  # shellcheck disable=SC2012
  ls -1t "$BACKUP_DIR"/neuropause-db-*.sql.gz | tail -n +"$((RETENTION + 1))" | while read -r old; do
    echo "  removing $old"
    rm -f "$old"
  done
fi
echo "Done."
