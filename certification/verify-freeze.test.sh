#!/usr/bin/env bash
# ============================================================================
# Tests for the certification freeze protection — O-5 and O-7.
#
# Builds throwaway git repositories and drives the real scripts against them.
# No mocks: freeze-baseline.sh, record-gate.sh and verify-freeze.sh are the
# code under test, run exactly as a person runs them.
#
#   bash certification/verify-freeze.test.sh
#
# Exit 0 = every case behaved as required.
# ============================================================================
set -uo pipefail

TOOLS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  FAIL %s\n     expected: %s\n     actual:   %s\n' "$1" "$2" "$3"; }

newrepo() {
  local d; d=$(mktemp -d)
  ( cd "$d" || exit 1
  git init -q
  git config user.name "Test Author"; git config user.email "test@local"
  git config commit.gpgsign false
  mkdir -p src certification apps/desktop packages/shared
  echo '{"version":"1.0.0-rc.1"}' > apps/desktop/package.json
  echo 'export const x = 1;' > src/app.ts
  cat > certification/required-gates.txt <<'GATES'
G0    You   Clean worktree, pinned Node, freezer writes CERT-<sha>
G1    You   Artifact hashes produced from the frozen baseline
GATES
  git add -A && git commit -qm "base" ) >/dev/null 2>&1
  echo "$d"
}

# The scripts are invoked by ABSOLUTE path: each one cd's to the git toplevel
# itself, so this tests the shipped code and survives an orphan checkout that
# removes the repository's own copy.
run() { bash "$TOOLS/$1" "${@:2}" 2>&1; }

echo "== O-5 · the recorder must accept a verdict after evidence is committed =="

D=$(newrepo); cd "$D" || exit 1
# (a) verdict BEFORE any baseline exists -> refused, and says why
out=$(run record-gate.sh G0 PASS --command c --evidence e); rc=$?
[ $rc -ne 0 ] && echo "$out" | grep -q "baseline.json does not exist" \
  && ok "(a) verdict before a baseline is refused" \
  || bad "(a) verdict before a baseline is refused" "non-zero + 'does not exist'" "rc=$rc $out"

# freeze
out=$(run freeze-baseline.sh); rc=$?
[ $rc -eq 0 ] && echo "$out" | grep -q "BASELINE-" \
  && ok "freeze succeeds on a clean tree" \
  || bad "freeze succeeds on a clean tree" "rc=0 + BASELINE-" "rc=$rc $out"

# (c) valid verdict against the fresh baseline
out=$(run record-gate.sh G0 PASS --command "freeze" --evidence "clean"); rc=$?
[ $rc -eq 0 ] && ok "(c) a valid verdict records" || bad "(c) a valid verdict records" "rc=0" "rc=$rc $out"

# (b) EVIDENCE COMMITTED -> HEAD moves, source does not. THE O-5 CASE.
git add -A certification/ >/dev/null 2>&1
git commit -qm "cert: record G0" >/dev/null 2>&1
out=$(run record-gate.sh G1 PASS --command "hash" --evidence "sha256 abc"); rc=$?
[ $rc -eq 0 ] && ok "(b) a verdict is accepted AFTER evidence was committed" \
  || bad "(b) a verdict is accepted AFTER evidence was committed" "rc=0" "rc=$rc $out"

# and the freeze is reported intact, because only evidence moved
out=$(run verify-freeze.sh); rc=$?
[ $rc -eq 0 ] && echo "$out" | grep -q "FREEZE INTACT" \
  && ok "verify-freeze reports INTACT after an evidence-only commit" \
  || bad "verify-freeze reports INTACT after an evidence-only commit" "rc=0 + FREEZE INTACT" "rc=$rc $out"

# (d) invalid mutation: SOURCE changes -> every path must refuse
echo 'export const x = 2;' > src/app.ts
git add -A && git commit -qm "src: a change nobody certified" >/dev/null 2>&1
out=$(run record-gate.sh G1 PASS --command "hash" --evidence "sha256 abc"); rc=$?
[ $rc -ne 0 ] && echo "$out" | grep -q "SOURCE has changed" \
  && ok "(d) a verdict against changed SOURCE is refused" \
  || bad "(d) a verdict against changed SOURCE is refused" "non-zero + 'SOURCE has changed'" "rc=$rc $out"

out=$(run verify-freeze.sh); rc=$?
[ $rc -eq 1 ] && echo "$out" | grep -q "FREEZE BROKEN" \
  && ok "verify-freeze reports BROKEN when source moved" \
  || bad "verify-freeze reports BROKEN when source moved" "rc=1 + FREEZE BROKEN" "rc=$rc $out"

# the breaking commit is NAMED, with its author — the O-7 requirement
echo "$out" | grep -q "THESE TOUCHED SOURCE" && echo "$out" | grep -q "Test Author" \
  && ok "the commit that broke the freeze is named, with its author" \
  || bad "the commit that broke the freeze is named, with its author" "'THESE TOUCHED SOURCE' + author" "$out"

# already-recorded evidence must NOT have been silently altered
node -e "
const d=require('$D/certification/gates.json');
const g0=d.gates.find(r=>r.gate==='G0');
if(!g0||g0.status!=='PASS') { console.log('MUTATED'); process.exit(1) }
" >/dev/null 2>&1 \
  && ok "historical evidence is unchanged by a later refusal" \
  || bad "historical evidence is unchanged by a later refusal" "G0 still PASS" "altered or missing"
cd / && rm -rf "$D"

echo
echo "== O-7 · a commit must not enter a frozen branch unnoticed =="

D=$(newrepo); cd "$D" || exit 1
run freeze-baseline.sh >/dev/null 2>&1

# a commit that only touches certification/ is allowed and reported
echo "note" > certification/NOTES.md
git add -A && git commit -qm "cert: a note" >/dev/null 2>&1
out=$(run verify-freeze.sh); rc=$?
[ $rc -eq 0 ] && echo "$out" | grep -q "COMMITS SINCE THE FREEZE" \
  && ok "evidence commits are ALLOWED and still listed" \
  || bad "evidence commits are ALLOWED and still listed" "rc=0 + listed" "rc=$rc $out"

# the attribution limit is stated rather than papered over
echo "$out" | grep -q "CANNOT attribute a change to a human" \
  && ok "single-identity attribution limit is stated, not implied" \
  || bad "single-identity attribution limit is stated, not implied" "explicit statement" "$out"

# a version bump — the exact shape of c25052d — breaks the freeze
echo '{"version":"1.0.0-rc.2"}' > apps/desktop/package.json
git add -A && git commit -qm "Founder Test Build: 1.0.0-rc.2" >/dev/null 2>&1
out=$(run verify-freeze.sh); rc=$?
[ $rc -eq 1 ] && echo "$out" | grep -q "Founder Test Build" \
  && ok "a version-bump commit breaks the freeze and is named (the c25052d case)" \
  || bad "a version-bump commit breaks the freeze and is named" "rc=1 + commit named" "rc=$rc $out"
cd / && rm -rf "$D"

# ancestry: a baseline that is not in this history must be refused
D=$(newrepo); cd "$D" || exit 1
run freeze-baseline.sh >/dev/null 2>&1
git add -A certification/ >/dev/null 2>&1 && git commit -qm "cert" >/dev/null 2>&1
git checkout -q --orphan elsewhere && git rm -rq --cached . 2>/dev/null
echo 'export const x = 1;' > src/app.ts
git add -A && git commit -qm "unrelated history" >/dev/null 2>&1
out=$(run verify-freeze.sh); rc=$?
[ $rc -eq 2 ] && ok "an orphan branch has no baseline to verify (correctly reported)" \
  || { [ $rc -eq 1 ] && echo "$out" | grep -q "ANCESTRY   FAIL" \
       && ok "a baseline outside this history is refused" \
       || bad "a baseline outside this history is refused" "rc=1 + ANCESTRY FAIL, or rc=2" "rc=$rc $out"; }
cd / && rm -rf "$D"

echo
echo "-------------------------------------------"
printf 'PASS %d   FAIL %d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
