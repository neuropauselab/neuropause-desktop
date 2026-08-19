#!/usr/bin/env bash
# ============================================================================
# DEV-A2 · GATE DETECTOR — pre-flight classification of target files.
#
# READ-ONLY. Classifies every argument path from AUTHORITATIVE metadata —
# certification/baseline.json (must exist; the certification anchor) +
# certification/frozen-surfaces.json (the machine projection of the CLAUDE.md
# gate registry) — NEVER from memory:
#
#   FROZEN         → STOP  (FG gate + literal token + choreography; exit 2)
#   GATE           → present the gate to the operator before editing (exit 3)
#   PROCEED        → go (exit 0)
#
# Fail-closed: missing metadata → REFUSE (exit 4). Wired into every task's
# pre-flight (AUTONOMY.md). Usage:
#   bash certification/gate-detector.sh <repo-relative-path>...
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")/.." || exit 4

BASELINE="certification/baseline.json"
SURFACES="certification/frozen-surfaces.json"
if [ ! -f "$BASELINE" ] || [ ! -f "$SURFACES" ]; then
  echo "REFUSING — authoritative metadata missing ($BASELINE / $SURFACES). Fail closed; do not proceed from memory."
  exit 4
fi
if [ "$#" -eq 0 ]; then
  echo "usage: gate-detector.sh <repo-relative-path>..."
  exit 4
fi

python3 - "$@" << 'PYEOF'
import json, sys

surfaces = json.load(open('certification/frozen-surfaces.json'))
frozen = surfaces['frozen']
sensitive = surfaces['sensitive']
effect = surfaces.get('effectBearing', [])

def classify(path: str):
    p = path.lstrip('./')
    for pre in frozen:
        if p == pre or p.startswith(pre):
            return ('FROZEN', f'matches frozen surface "{pre}" — STOP: FG gate + literal token + choreography (CLAUDE SS2 #1-2)')
    for pre in sensitive:
        if p == pre or p.startswith(pre):
            return ('GATE', f'matches security/governance-sensitive surface "{pre}" — present to the operator before editing')
    for pre in effect:
        if p == pre or p.startswith(pre):
            return ('GATE', f'matches effect-bearing surface "{pre}" — a new/altered external effect requires a gate')
    return ('PROCEED', 'no authoritative match — task author still declares effect-freedom in the task entry')

worst = 0
rank = {'PROCEED': 0, 'GATE': 3, 'FROZEN': 2}
severity = {'PROCEED': 0, 'GATE': 1, 'FROZEN': 2}
for path in sys.argv[1:]:
    verdict, why = classify(path)
    print(f'{verdict:7s}  {path}  — {why}')
    worst = max(worst, severity[verdict])

sys.exit({0: 0, 1: 3, 2: 2}[worst])
PYEOF
