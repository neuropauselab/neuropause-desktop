#!/usr/bin/env bash
# NP-PILOT-FIRST-014 §22 — ENV-05 recovery scenarios R1, R2, R6, R7 out of process.
# R3/R4/R5 are in-process lifecycle properties and live in pilotEvidenceReconstruction.test.ts.
#
# Usage: tools/np014-recovery.sh <pg-container> <database-url>
set -uo pipefail
PGC="${1:?container}"; export DATABASE_URL="${2:?database url}"
# The app logger writes to STDOUT, so the probe line must be matched by its prefix.
# `tail -1` picked up a pino DEBUG line and made every scenario report FAIL.
probe () { npx tsx tools/np014-recovery-probe.ts "$1" 2>/dev/null | grep -E "^$1=" | tail -1; }
wait_pg () { for _ in $(seq 1 60); do docker exec "$PGC" pg_isready -q && return 0; sleep 1; done; return 1; }

echo "== seed =="; probe seed
D0=$(probe digest); echo "baseline      : $D0"

echo "== R1: application restart (a genuinely new OS process) =="
D1=$(probe digest); echo "after restart : $D1"
[ "$D1" = "$D0" ] && echo "R1 = PASS (reconstruction identical across processes)" || echo "R1 = FAIL"

echo "== R2: PostgreSQL restart =="
docker restart "$PGC" >/dev/null; wait_pg || { echo "R2 = INCONCLUSIVE (postgres did not come back)"; exit 1; }
D2=$(probe digest); echo "after pg      : $D2"
[ "$D2" = "$D0" ] && echo "R2 = PASS (evidence survived the database restart)" || echo "R2 = FAIL"

echo "== R7: export reproducible across processes =="
E1=$(probe export); E2=$(probe export); echo "export a      : $E1"; echo "export b      : $E2"
[ "$E1" = "$E2" ] && echo "R7 = PASS" || echo "R7 = FAIL"

echo "== R6: partial ledger loss must DEVIATE, not answer confidently =="
# POSITIVE CONTROL FIRST. A fresh seed writes ZERO lifecycle rows - enrolment records no ledger
# entry, only EXIT transitions do - so deleting the ledger of an active participation destroys
# nothing and "no deviation" would mean nothing. The participant must exit first, and the ledger
# must be observed non-empty, before the loss can be said to have been detectable at all.
probe exit >/dev/null
N=$(probe ledger | cut -d= -f2)
echo "ledger rows before damage : $N"
if [ "${N:-0}" -lt 1 ]; then echo "R6 = INCONCLUSIVE (nothing to lose; positive control failed)"; exit 1; fi
DE=$(probe digest); echo "after exit    : $DE"
probe damage >/dev/null
D6=$(probe digest); echo "after damage  : $D6"
case "$D6" in
  *DEVIATION*|*DEVIATIONS=*) echo "R6 = PASS (loss is visible)" ;;
  *) echo "R6 = FAIL (reconstruction answered without flagging the loss)" ;;
esac
