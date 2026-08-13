#!/usr/bin/env bash
# ============================================================================
# NeuroPause — RESCUE the only surviving copy of production data.
#
# neuropause-nems-backups holds 11 objects / 543 KiB and was scheduled for
# deletion on 18 Aug 2026. The cluster and both managed databases are gone.
# These dumps are the whole of production.
#
# Read-only against Spaces. Copies down; deletes nothing.
#
# Needs Spaces keys (NOT the API token):
#   DO console -> API -> Spaces Keys -> Generate New Key
#   export AWS_ACCESS_KEY_ID=...  AWS_SECRET_ACCESS_KEY=...
#
# Run:  bash rescue-backups.sh 2>&1 | tee rescue.txt
# ============================================================================
set -uo pipefail

BUCKET=neuropause-nems-backups
ENDPOINT=https://nyc3.digitaloceanspaces.com
DEST="$HOME/neuropause-prod-backups-$(date -u +%Y%m%d)"

command -v aws >/dev/null || { echo "aws CLI missing -> brew install awscli"; exit 1; }
: "${AWS_ACCESS_KEY_ID:?set Spaces keys first}"
: "${AWS_SECRET_ACCESS_KEY:?set Spaces keys first}"
export AWS_DEFAULT_REGION=us-east-1 AWS_EC2_METADATA_DISABLED=true

printf '\n═══ 1. WHAT IS IN THE BUCKET ═══\n'
aws s3 ls "s3://$BUCKET/" --recursive --human-readable --endpoint-url "$ENDPOINT"

printf '\n═══ 2. COPY EVERYTHING DOWN ═══\n'
mkdir -p "$DEST"
aws s3 sync "s3://$BUCKET/" "$DEST/" --endpoint-url "$ENDPOINT"
echo "local copy -> $DEST"
find "$DEST" -type f -exec ls -lh {} \;

printf '\n═══ 3. IS THE NEWEST DUMP ACTUALLY RESTORABLE? ═══\n'
# Their own integrity design: a dump that fails `pg_restore --list` is corrupt.
NEWEST=$(find "$DEST" -name '*.dump' -type f | sort | tail -1)
if [ -z "$NEWEST" ]; then
  echo "NO .dump FILE FOUND — inspect the listing above before concluding anything."
else
  echo "newest: $NEWEST"
  if command -v pg_restore >/dev/null; then
    pg_restore --list "$NEWEST" > "$DEST/toc.txt" 2>&1 \
      && { echo "PASS — archive parses. Table of contents:"; grep -cE 'TABLE DATA' "$DEST/toc.txt" \
           | xargs -I{} echo "  {} tables with data"; head -25 "$DEST/toc.txt"; } \
      || { echo "FAIL — pg_restore could not read it:"; head -5 "$DEST/toc.txt"; }
  else
    echo "pg_restore missing -> brew install libpq && brew link --force libpq"
  fi
fi

printf '\n═══ 4. THEIR OWN CHECKER, WITH THE FRESHNESS RULE RELAXED ═══\n'
# verify-backup.sh defaults to MAX_AGE_HOURS=26. The newest dump is ~13 days
# old because backups stopped when the cluster died, so the default WILL report
# FAIL (stale). That is correct behaviour, not corruption. Widen the window so
# the check reports on existence and integrity instead.
if [ -x deploy/backup/verify-backup.sh ]; then
  BUCKET="$BUCKET" ENDPOINT="$ENDPOINT" MAX_AGE_HOURS=720 \
    deploy/backup/verify-backup.sh --deep
  echo "exit=$?   (0 PASS · 1 FAIL · 2 UNREADABLE)"
else
  bash deploy/backup/verify-backup.sh --selftest || true
fi

printf '\n═══ DONE ═══\n'
echo "Production data now exists in a second place: $DEST"
echo "Back it up somewhere off this laptop before you touch DigitalOcean again."
