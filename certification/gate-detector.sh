#!/usr/bin/env bash
# ============================================================================
# DEV-A2 · GATE DETECTOR — pre-flight classification of target files.
#
# READ-ONLY. Classifies every argument path from AUTHORITATIVE metadata —
# certification/baseline.json (must exist; the certification anchor) +
# certification/frozen-surfaces.json (the machine projection of the CLAUDE.md
# gate registry) — NEVER from memory / assumptions / prior conversation /
# guessed structure / "probably safe":
#
#   FROZEN   → STOP  (FG gate + literal token + choreography; exit 2)
#   GATE     → present the gate to the operator before editing (exit 3)
#   UNKNOWN  → STOP  (metadata cannot establish safety; review/gate; exit 5)
#   PROCEED  → go (exit 0)
#
# UNKNOWN SAFETY DEFAULT (§2.2): when safety cannot be established —
# missing/unparseable metadata, an unresolvable or out-of-repo path — the
# answer is UNKNOWN → STOP. Uncertainty must not silently become permission.
# Fail-closed: missing metadata → REFUSE (exit 4).
#
# SELF-PROTECTION (§2.3): this script and its authority sources are listed as
# GOVERNANCE-SENSITIVE in frozen-surfaces.json — an ordinary task may not
# modify them; changing them requires an explicit governed task + gate.
#
# Usage: bash certification/gate-detector.sh <repo-relative-path>...
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

try:
    surfaces = json.load(open('certification/frozen-surfaces.json'))
    json.load(open('certification/baseline.json'))
    frozen = surfaces['frozen']
    sensitive = surfaces['sensitive']
    effect = surfaces.get('effectBearing', [])
except Exception as e:  # unparseable metadata — safety cannot be established
    print(f'REFUSING — authoritative metadata unreadable ({e}). Fail closed; do not proceed from memory.')
    sys.exit(4)

def classify(path: str):
    # UNKNOWN safety default: a path the metadata cannot be safely applied to.
    if not path.strip() or path.startswith('/') or path.startswith('~') or '..' in path.split('/'):
        return ('UNKNOWN', 'not a plain repo-relative path — safety cannot be established; STOP, review/gate')
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

seen = set()
for path in sys.argv[1:]:
    verdict, why = classify(path)
    seen.add(verdict)
    print(f'{verdict:7s}  {path}  — {why}')

# Exit dominance: FROZEN (2) > UNKNOWN (5) > GATE (3) > PROCEED (0). Every non-zero is a STOP-or-gate.
if 'FROZEN' in seen:
    sys.exit(2)
if 'UNKNOWN' in seen:
    sys.exit(5)
if 'GATE' in seen:
    sys.exit(3)
sys.exit(0)
PYEOF
