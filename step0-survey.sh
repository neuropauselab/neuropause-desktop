#!/usr/bin/env bash
# NeuroPause production rebuild — STEP 0: what survived.
# Read-only. Creates nothing, changes nothing.
# Run:  bash step0-survey.sh 2>&1 | tee step0.txt
set -uo pipefail

hr() { printf '\n═══ %s ═══\n' "$1"; }

hr "doctl present and authenticated?"
command -v doctl >/dev/null || { echo "doctl NOT INSTALLED  ->  brew install doctl && doctl auth init"; exit 1; }
doctl version | head -1
doctl account get || { echo "NOT AUTHENTICATED  ->  doctl auth init"; exit 1; }

hr "clusters"
doctl kubernetes cluster list

hr "MANAGED DATABASES  <-- THE DECISION POINT"
# Names alone are not enough: the firewall commands in step 2 take the UUID,
# not the name, so capture IDs now.
doctl databases list --format ID,Name,Engine,Version,Status,Region

hr "load balancers"
doctl compute load-balancer list --format ID,Name,IP,Status,Created

hr "container registry"
doctl registry list || echo "(no registry)"
doctl registry repository list-tags backend 2>/dev/null || echo "(no 'backend' repository / not readable)"

hr "current DNS for the API hostname"
dig +short api.neuropause033.com
echo "(expected today: 134.199.250.188 — the dead load balancer)"

hr "READ THIS"
cat <<'EOF'
nems-prod-pg AND nems-prod-cache present   -> DATA PRESERVED. Do NOT create databases.
                                              Capture their IDs from the table above.
either one missing                         -> STOP. Report:
                                              DATABASES DESTROYED — REPOSITORY CANNOT RESTORE PRODUCTION DATA
registry 'backend' tags gone               -> the pinned image digest is gone; the backend
                                              must be rebuilt from apps/backend/Dockerfile
                                              before any deploy step will work.
EOF
