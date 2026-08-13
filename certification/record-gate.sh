#!/usr/bin/env bash
# ============================================================================
# 13C — record one gate verdict into certification/gates.json.
#
# Companion to freeze-baseline.sh. That script answers "which tree";
# this one answers "what was observed against it", in the shape Part 7 requires.
#
# SIX refusals. Every one is a defect this programme actually produced:
#
#   1. No `required-gates.txt`      — the denominator must be enumerated.
#   2. No frozen baseline           — a verdict must name the tree it describes.
#   3. Dirty worktree AT RECORD TIME — a clean freeze does not stay clean.
#   4. HEAD moved since the freeze  — the seven-times-repeated failure.
#   5. PASS without command+evidence — green cells are not evidence.
#   6. BLOCKED missing any of four  — otherwise it is a shrug with a label.
#
# Toolchain mismatch RECORDS rather than refuses: refusing would tempt someone
# to skip recording, and the mismatch is exactly the fact worth keeping.
#
# Usage:
#   bash record-gate.sh G0c PASS --command "npm run typecheck" --evidence "0 errors"
#   bash record-gate.sh G6 BLOCKED --blocker "..." --owner Saurabh \
#        --required-evidence "..." --next "..."
#   bash record-gate.sh --list
# ============================================================================
set -uo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "not a git repository"; exit 1; }
GATES=certification/gates.json
BASE=certification/baseline.json
REQUIRED_FILE=certification/required-gates.txt

# ── Refusal 1 · THE DENOMINATOR MUST BE ENUMERATED, NOT IMPLIED ─────────────
#
# The first version of this script reported on recorded gates and printed a
# prose caveat saying an unrecorded gate is NOT RUN. A caveat is not
# enforcement: three of twenty-four recorded, all three PASS, and the output
# read "every recorded gate is PASS". That is the F22 defect exactly — coverage
# counted against the numerator.
if [ ! -f "$REQUIRED_FILE" ]; then
  echo "REFUSING — $REQUIRED_FILE does not exist."
  echo "The denominator must be enumerated. Without it, coverage is counted"
  echo "against the numerator, which is the defect this programme is named for."
  exit 6
fi

if [ "${1:-}" = "--list" ]; then
  CUR_BASE_SHA=""
  [ -f "$BASE" ] && CUR_BASE_SHA=$( (sha256sum "$BASE" 2>/dev/null || shasum -a 256 "$BASE") | awk '{print $1}')
  node - "$GATES" "$REQUIRED_FILE" "$CUR_BASE_SHA" <<'LISTNODE'
const fs = require('fs');
const [file, requiredFile, curBaseSha] = process.argv.slice(2);

const required = fs.readFileSync(requiredFile, 'utf8').split('\n')
  .filter((l) => l.trim() && !l.trim().startsWith('#'))
  .map((l) => { const m = l.trim().split(/\s+/); return { gate: m[0], owner: m[1], closes: m.slice(2).join(' ') }; });

const doc = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { gates: [] };
const byGate = new Map(doc.gates.map((r) => [r.gate, r]));

// THE THIRD HOLE, found while fixing the first two: --list read gates.json and
// never checked that it still belongs to the CURRENT baseline. After a
// re-freeze it reported confidently about a tree nobody is on.
if (doc.baseline_sha256 && curBaseSha && doc.baseline_sha256 !== curBaseSha) {
  console.log('STALE — gates.json belongs to baseline ' + doc.baseline_sha256.slice(0, 12));
  console.log('        current baseline.json hashes to ' + curBaseSha.slice(0, 12));
  console.log('        every row below describes a tree nobody is on. Re-record.\n');
} else if (doc.baseline_sha256) {
  console.log('baseline ' + doc.baseline_sha256.slice(0, 12) + '  commit ' + String(doc.source_commit).slice(0, 7) + '\n');
} else {
  console.log('no gates recorded yet — every required gate below is NOT RUN\n');
}

const order = { FAIL: 0, BLOCKED: 1, 'NOT RUN': 2, PASS: 3 };
const rows = required.map((r) => byGate.get(r.gate) ?? { gate: r.gate, status: 'NOT RUN', note: r.closes });
rows.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.gate.localeCompare(b.gate));
for (const r of rows) {
  console.log(String(r.gate).padEnd(5), String(r.status).padEnd(8),
    String(r.command || r.blocker || r.note || '').slice(0, 60));
}

const unexpected = doc.gates.filter((r) => !required.some((q) => q.gate === r.gate));
if (unexpected.length) {
  console.log('\nRECORDED BUT NOT REQUIRED: ' + unexpected.map((r) => r.gate).join(', '));
  console.log('Add them to the denominator or remove the rows. Neither silently.');
}

const pass = rows.filter((r) => r.status === 'PASS').length;
console.log('\n' + pass + '/' + rows.length + ' required gates PASS');
console.log(pass === rows.length ? 'CERTIFIED' : 'NOT CERTIFIED — ' + (rows.length - pass) + ' required gate(s) not PASS');
LISTNODE
  exit 0
fi

GATE="${1:-}"; STATUS="${2:-}"; shift 2 2>/dev/null || true
case "$STATUS" in
  PASS|FAIL|BLOCKED|"NOT RUN") ;;
  *) echo "verdict must be exactly one of: PASS · FAIL · BLOCKED · NOT RUN"; exit 2 ;;
esac
[ -n "$GATE" ] || { echo "gate id required"; exit 2; }

# NOTE: the BLOCKED field is REQ_EVIDENCE, not REQUIRED — an earlier draft named
# it REQUIRED and silently shadowed the denominator path above. Same class of
# defect as everything else here: two things sharing one name, one of them
# quietly winning.
CMD=""; EV=""; BLOCKER=""; OWNER=""; REQ_EVIDENCE=""; NEXT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --command)           CMD="$2"; shift 2 ;;
    --evidence)          EV="$2"; shift 2 ;;
    --blocker)           BLOCKER="$2"; shift 2 ;;
    --owner)             OWNER="$2"; shift 2 ;;
    --required-evidence) REQ_EVIDENCE="$2"; shift 2 ;;
    --next)              NEXT="$2"; shift 2 ;;
    *) echo "unknown argument: $1"; exit 2 ;;
  esac
done

grep -qE "^${GATE}[[:space:]]" "$REQUIRED_FILE" || {
  echo "REFUSING — '$GATE' is not in $REQUIRED_FILE."
  echo "A gate outside the denominator cannot count toward it. Add it there first."
  exit 6
}

# ── Refusal 2 · no baseline, no verdict ─────────────────────────────────────
if [ ! -f "$BASE" ]; then
  echo "REFUSING — $BASE does not exist."
  echo "Run: bash freeze-baseline.sh"
  echo "A verdict that cannot name the tree it was observed against is not evidence."
  exit 3
fi
BASE_SHA=$( (sha256sum "$BASE" 2>/dev/null || shasum -a 256 "$BASE") | awk '{print $1}')
BASE_CLEAN=$(node -e "console.log(require('./$BASE').source.worktree_clean)")
BASE_COMMIT=$(node -e "console.log(require('./$BASE').source.commit)")
if [ "$BASE_CLEAN" != "true" ]; then
  echo "REFUSING — the frozen baseline records worktree_clean: false."
  echo "Commit or stash, re-run freeze-baseline.sh, then record verdicts."
  exit 3
fi

# ── Refusal 3 · A CLEAN FREEZE DOES NOT STAY CLEAN ──────────────────────────
#
# The check above reads `worktree_clean` from baseline.json — a fact about the
# PAST — and the check below compares HEAD. Neither notices an edit made AFTER
# the freeze. So: freeze clean, edit a file, record a PASS, and every check
# passes while the verdict describes a tree that no longer exists. Same failure
# as a moved HEAD, just quieter.
#
# certification/ is excluded: the baseline cannot describe a tree that contains
# it. Writing baseline.json dirties the worktree and committing it moves HEAD,
# so without this exclusion the workflow has no fixed point and cannot run at
# all. Found by running it, not by reading it.
SRC_DIRTY_SPEC=(-- . ':(exclude)certification')
NOW_DIRTY="$(git status --porcelain=v1 "${SRC_DIRTY_SPEC[@]}")"
if [ -n "$NOW_DIRTY" ]; then
  echo "REFUSING — the SOURCE tree is dirty NOW (certification/ excluded):"
  echo "$NOW_DIRTY" | head -20
  echo
  echo "A verdict recorded against an edited tree describes a tree nobody has."
  echo "Revert the edit, or commit and re-freeze."
  exit 3
fi

# ── Refusal 4 · THE SOURCE MOVED — not merely HEAD ──────────────────────────
#
# O-5. This compared `git rev-parse HEAD` to the baseline commit, so COMMITTING
# THE EVIDENCE closed the baseline: certification/ moves HEAD without changing a
# line of source, and every later verdict was refused. Storing evidence and
# recording evidence were mutually exclusive, which is not a policy anyone chose.
#
# The dirty-tree check above already excluded certification/ for exactly this
# reason — the fix was applied to one of two adjacent checks and missed the
# other. So: compare the SOURCE, on the same spec.
NOW_COMMIT=$(git rev-parse HEAD)

# O-7 · ANCESTRY. A source diff of zero is not enough on its own: HEAD could sit
# on a branch that never contained the baseline and happen to match. The baseline
# must be IN this history, or the verdict describes a tree that merely resembles
# the certified one.
if ! git merge-base --is-ancestor "$BASE_COMMIT" HEAD 2>/dev/null; then
  echo "REFUSING — the baseline commit is not an ancestor of HEAD."
  echo "  baseline: $BASE_COMMIT"
  echo "  HEAD:     $NOW_COMMIT"
  echo "This branch does not contain the tree the evidence describes."
  exit 3
fi

if ! git diff --quiet "$BASE_COMMIT" HEAD "${SRC_DIRTY_SPEC[@]}"; then
  echo "REFUSING — the SOURCE has changed since the baseline was frozen:"
  git diff --stat "$BASE_COMMIT" HEAD "${SRC_DIRTY_SPEC[@]}" | tail -20
  echo
  echo "  baseline: $BASE_COMMIT"
  echo "  HEAD:     $NOW_COMMIT"
  echo "Re-freeze. Committing evidence is fine; committing source is not."
  exit 3
fi

# O-7 · PROVENANCE. Name every commit that entered the branch after the freeze,
# with its author. These are ALLOWED (the source is unchanged, checked above) but
# they must not be invisible: c25052d entered a frozen branch, bumped the product
# version, was tagged and pushed, and nothing in this programme noticed.
SINCE_FREEZE="$(git log --format='%h %an <%ae> %s' "$BASE_COMMIT..HEAD" 2>/dev/null)"
if [ -n "$SINCE_FREEZE" ]; then
  echo "NOTE — commits added since the freeze (source unchanged):"
  echo "$SINCE_FREEZE" | sed 's/^/  /'
  echo
fi

# ── Refusal 5 · a PASS needs a command and evidence ─────────────────────────
if [ "$STATUS" = "PASS" ] && { [ -z "$CMD" ] || [ -z "$EV" ]; }; then
  echo "REFUSING — a PASS requires --command and --evidence."
  echo "Green cells in a spreadsheet are not evidence."
  exit 4
fi

# ── Refusal 6 · a BLOCKED names all four, or it is a shrug ──────────────────
if [ "$STATUS" = "BLOCKED" ] && { [ -z "$BLOCKER" ] || [ -z "$OWNER" ] || [ -z "$REQ_EVIDENCE" ] || [ -z "$NEXT" ]; }; then
  echo "REFUSING — a BLOCKED requires --blocker, --owner, --required-evidence and --next."
  exit 5
fi

NODE_RUNNING=$(node -v | tr -d 'v'); NODE_PIN=$(cat .nvmrc 2>/dev/null | tr -d '\n')
RUN_ID="RUN-$(date -u +%Y%m%dT%H%M%SZ)-$GATE"

HEAD_AUTHOR=$(git log -1 --format='%an <%ae>' HEAD)
RECORDED_BY="$(git config user.name 2>/dev/null) <$(git config user.email 2>/dev/null)>"
BRANCH_NAME=$(git branch --show-current)

node - "$GATES" "$GATE" "$STATUS" "$CMD" "$EV" "$BLOCKER" "$OWNER" "$REQ_EVIDENCE" "$NEXT" \
       "$RUN_ID" "$BASE_SHA" "$BASE_COMMIT" "$NODE_RUNNING" "$NODE_PIN" \
       "$NOW_COMMIT" "$HEAD_AUTHOR" "$RECORDED_BY" "$BRANCH_NAME" <<'RECNODE'
const fs = require('fs');
const [file, gate, status, cmd, ev, blocker, owner, required, next,
       runId, baseSha, commit, nodeRunning, nodePin,
       headCommit, headAuthor, recordedBy, branchName] = process.argv.slice(2);

let doc = { program: '13C', baseline_sha256: baseSha, source_commit: commit, gates: [] };
if (fs.existsSync(file)) {
  const prev = JSON.parse(fs.readFileSync(file, 'utf8'));
  // A gates file belongs to exactly ONE baseline. A different baseline starts a
  // new file rather than silently mixing verdicts from two trees.
  if (prev.baseline_sha256 === baseSha) {
    doc = prev;
  } else {
    const arch = file.replace(/\.json$/, '.' + String(prev.baseline_sha256).slice(0, 12) + '.json');
    fs.renameSync(file, arch);
    console.log('previous gates file belonged to another baseline; archived as ' + arch);
  }
}

const row = {
  gate, status, run_id: runId,
  source_sha: commit, baseline_sha256: baseSha,
  // O-7. WHO and WHERE, recorded rather than assumed. `recorded_by` is the git
  // identity configured on the machine — which in this repository is the same
  // for every author, and that is itself the finding. It is written as what it
  // is, not dressed up as attribution it cannot provide.
  head_commit: headCommit,
  head_author: headAuthor,
  recorded_by: recordedBy,
  branch: branchName,
  environment: 'node ' + nodeRunning + ' (pin ' + nodePin + ')',
  toolchain_matches_pin: nodeRunning.split('.')[0] === String(nodePin).split('.')[0],
  recorded_at: new Date().toISOString(),
};
if (cmd) row.command = cmd;
if (ev) row.evidence = [ev];
if (blocker) Object.assign(row, { blocker, owner, required_evidence: required, next_action: next });

doc.gates = doc.gates.filter((r) => r.gate !== gate);
doc.gates.push(row);
fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');

console.log(JSON.stringify(row, null, 2));
if (!row.toolchain_matches_pin) {
  console.log('\nWARNING: node ' + nodeRunning + ' does not match the pin (' + nodePin + ').');
  console.log('Recorded, and recorded as mismatched. It is not a run against this baseline.');
}
RECNODE

echo
echo "$RUN_ID recorded against BASELINE-${BASE_SHA:0:12}"
