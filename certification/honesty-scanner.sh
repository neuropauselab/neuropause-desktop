#!/usr/bin/env bash
# ============================================================================
# DEV-A3 · HONESTY SCANNER — scan a working diff for green-faking patterns.
#
# READ-ONLY, REPORT-ONLY: every hit becomes a REVIEW ITEM for the task report
# (AUTONOMY.md post-flight) — never silently green, and the scanner itself
# never blocks (a justified hit is EXPLAINED in the report, not hidden).
#
# Patterns (added lines unless noted):
#   test.skip / describe.skip / it.skip     — skipped tests
#   .only(                                  — focused tests (suite narrowing)
#   as any                                  — type-system escape
#   eslint-disable                          — lint escape
#   empty catch / no-op promise catch       — swallowed / suppressed failures
#   timeout inflation                       — 5+ digit timeouts introduced
#   removed/weakened assertions             — expect( lines removed in excess
#   removed failure checks                  — throw lines removed in excess
#   disabled validation                     — validate/parse calls removed in excess
#   expected-output-only change             — ONLY test files changed (the
#                                             implementation was not)
#
# Usage:
#   bash certification/honesty-scanner.sh                  # scans `git diff HEAD`
#   bash certification/honesty-scanner.sh --diff-file F    # scans a provided unified diff (self-test seam)
# Exit: 0 always when the scan ran (findings are review items, not failures);
#       5 when the scanner itself could not run.
# ============================================================================
set -uo pipefail
cd "$(dirname "$0")/.." || exit 5

DIFF_SRC="git"
DIFF_FILE=""
if [ "${1:-}" = "--diff-file" ]; then
  DIFF_SRC="file"
  DIFF_FILE="${2:-}"
  [ -f "$DIFF_FILE" ] || { echo "SCANNER ERROR — diff file not found: $DIFF_FILE"; exit 5; }
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
if [ "$DIFF_SRC" = "git" ]; then
  git diff HEAD -- . ':(exclude)certification' > "$TMP" 2>/dev/null || { echo "SCANNER ERROR — git diff failed"; exit 5; }
else
  cp "$DIFF_FILE" "$TMP"
fi

python3 - "$TMP" << 'PYEOF'
import re, sys

diff = open(sys.argv[1], encoding='utf-8', errors='replace').read()
items = []
current = None
removed_expects = {}
added_expects = {}
removed_throws = {}
added_throws = {}
removed_validations = {}
added_validations = {}
changed_files = []

CODE_EXT = ('.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs')

for line in diff.splitlines():
    if line.startswith('+++ b/'):
        current = line[6:]
        changed_files.append(current)
        continue
    # The scan targets are CODE constructs — documentation that MENTIONS the patterns is not a finding.
    if current is None or not current.endswith(CODE_EXT):
        continue
    if line.startswith('+') and not line.startswith('+++'):
        text = line[1:]
        if re.search(r'\b(?:test|it|describe)\.skip\b', text):
            items.append((current, 'skipped test introduced', text.strip()))
        if re.search(r'\.only\(', text):
            items.append((current, 'focused test (.only) introduced — narrows the suite', text.strip()))
        if re.search(r'\bas any\b', text):
            items.append((current, 'type escape (as any) introduced', text.strip()))
        if 'eslint-disable' in text:
            items.append((current, 'lint escape (eslint-disable) introduced', text.strip()))
        if re.search(r'catch[^{]*\{\s*\}', text) or re.search(r'catch\s*\{\s*$', text):
            items.append((current, 'empty catch introduced (swallowed failure?)', text.strip()))
        if re.search(r'timeout[^0-9]{0,12}\d{5,}', text, re.IGNORECASE):
            items.append((current, 'large timeout introduced (inflation?)', text.strip()))
        if re.search(r'\.catch\(\s*\(\s*\)\s*=>\s*(\{\s*\}|null|undefined)\s*\)', text):
            items.append((current, 'no-op promise catch introduced (suppressed error?)', text.strip()))
        if 'expect(' in text:
            added_expects[current] = added_expects.get(current, 0) + 1
        if re.search(r'\bthrow\b', text):
            added_throws[current] = added_throws.get(current, 0) + 1
        if re.search(r'\.(?:safeP|p)arse\(|\bvalidate\w*\(', text):
            added_validations[current] = added_validations.get(current, 0) + 1
    elif line.startswith('-') and not line.startswith('---'):
        if 'expect(' in line:
            removed_expects[current] = removed_expects.get(current, 0) + 1
        if re.search(r'\bthrow\b', line):
            removed_throws[current] = removed_throws.get(current, 0) + 1
        if re.search(r'\.(?:safeP|p)arse\(|\bvalidate\w*\(', line):
            removed_validations[current] = removed_validations.get(current, 0) + 1

for f, removed in removed_expects.items():
    added = added_expects.get(f, 0)
    if removed > added:
        items.append((f, f'assertions removed in excess ({removed} removed vs {added} added) — weakened test?', ''))
for f, removed in removed_throws.items():
    added = added_throws.get(f, 0)
    if removed > added:
        items.append((f, f'failure checks (throw) removed in excess ({removed} removed vs {added} added) — suppressed error path?', ''))
for f, removed in removed_validations.items():
    added = added_validations.get(f, 0)
    if removed > added:
        items.append((f, f'validation/parse calls removed in excess ({removed} removed vs {added} added) — disabled validation?', ''))

real_files = [f for f in changed_files if f and f != '/dev/null']
if real_files and all(re.search(r'\.test\.|__tests__|ui-tests/', f) for f in real_files):
    items.append(('(diff-wide)', 'ONLY test files changed — expected-output edited instead of the implementation?', ', '.join(real_files[:5])))

if not items:
    print('HONESTY SCAN — no findings (0 review items).')
else:
    print(f'HONESTY SCAN — {len(items)} REVIEW ITEM(S) for the task report (explain each; never silently green):')
    for f, what, snippet in items:
        loc = f or '(unknown file)'
        line = f'  REVIEW ITEM · {loc} — {what}'
        if snippet:
            line += f'  [{snippet[:90]}]'
        print(line)
PYEOF
exit 0
