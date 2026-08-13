#!/usr/bin/env bash
# ============================================================================
# NeuroPause — STEP 1: start the cluster, then survey what survived.
#
# The cluster create is slow (~6-9 min) and is needed on every path, so it runs
# FIRST and in the background. Everything after it is read-only survey work you
# do while it provisions. Nothing here destroys or overwrites anything.
#
# Run:  bash step1-fresh-build.sh 2>&1 | tee step1.txt
# ============================================================================
set -uo pipefail
hr() { printf '\n═══ %s ═══\n' "$1"; }

doctl account get >/dev/null || { echo "NOT AUTHENTICATED — run: doctl auth init"; exit 1; }

hr "1. CREATE CLUSTER (background — needed on every path)"
if doctl kubernetes cluster get nems-prod-cluster >/dev/null 2>&1; then
  echo "nems-prod-cluster ALREADY EXISTS — skipping create."
else
  echo "creating nems-prod-cluster (nyc3, 3x s-2vcpu-4gb) in the background…"
  nohup doctl kubernetes cluster create nems-prod-cluster \
    --region nyc3 \
    --node-pool "name=nems-prod-pool-1;size=s-2vcpu-4gb;count=3" \
    --wait > /tmp/cluster-create.log 2>&1 &
  echo "  -> log: tail -f /tmp/cluster-create.log"
fi

hr "2. MANAGED DATABASES — did they survive?"
# Separate DigitalOcean resources from DOKS. Their absence is the difference
# between 'rebuild the infrastructure' and 'rebuild it AND lose the data'.
doctl databases list --format ID,Name,Engine,Version,Status,Region,NumNodes

hr "3. CONTAINER REGISTRY — is the backend image still there?"
doctl registry list 2>/dev/null || echo "NO REGISTRY — the pinned image digest is gone."
doctl registry repository list-tags backend 2>/dev/null \
  || echo "NO 'backend' REPOSITORY — you must rebuild from apps/backend/Dockerfile."

hr "4. SPACES BACKUPS — THE TIME-CRITICAL ONE"
# deploy/backup/pg-backup-cronjob.yaml dumps Postgres to Spaces daily at
# 02:15 UTC, bucket 'neuropause-nems-backups', prefix 'pg/nems-prod-pg'.
# Spaces is INDEPENDENT of the cluster and of the managed databases — it can
# still hold dumps even though both are gone.
#
# spaces-lifecycle.json expires objects under pg/ after 30 DAYS. Backups stopped
# the day the cluster died. Every dump is aging toward deletion right now.
if command -v aws >/dev/null && [ -n "${AWS_ACCESS_KEY_ID:-}" ]; then
  aws s3 ls s3://neuropause-nems-backups/pg/nems-prod-pg/ --recursive \
    --endpoint-url https://nyc3.digitaloceanspaces.com | tail -20 \
    || echo "could not list — check Spaces keys / bucket name"
else
  cat <<'EOF'
aws CLI or Spaces keys not set. Fastest check needs NO keys — use the console:

  https://cloud.digitalocean.com/spaces
    -> bucket:  neuropause-nems-backups
    -> folder:  pg/nems-prod-pg/

Look for the NEWEST .dump file and note its date. That date + 30 days is your
deadline to recover production data.

To check from this terminal instead:
  brew install awscli
  # DO console -> API -> Spaces Keys -> Generate New Key
  export AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=...
  aws s3 ls s3://neuropause-nems-backups/pg/nems-prod-pg/ --recursive \
    --endpoint-url https://nyc3.digitaloceanspaces.com | tail -20
EOF
fi

hr "5. CLUSTER PROGRESS"
echo "tail -f /tmp/cluster-create.log     # then:"
echo "doctl kubernetes cluster get nems-prod-cluster --format ID,Name,Status"

hr "WHAT YOUR ANSWERS MEAN"
cat <<'EOF'
databases present  -> DATA PRESERVED. Reuse them. You only rebuild compute.
databases gone
  + Spaces dump    -> DATA RESTORABLE. Create new managed PG, restore the dump
                      with deploy/backup/pg-restore-job.yaml. Do this BEFORE the
                      30-day lifecycle deletes it.
  + no dump        -> PRODUCTION DATA IS NOT RECOVERABLE. Say so plainly; do not
                      quietly stand up an empty database and call it restored.

registry gone      -> add an image rebuild + push before any deploy step.
EOF
