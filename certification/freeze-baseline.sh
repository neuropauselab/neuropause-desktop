#!/usr/bin/env bash
# ============================================================================
# 13C §3.1 — freeze a certification baseline.
#
# Writes certification/baseline.json with EVERY value read from a command.
# Nothing is typed from memory and nothing is defaulted silently: a value that
# cannot be read is written as null and listed under "absent", because a
# baseline with holes is worth more than one with plausible numbers in it.
#
# Refuses to freeze a dirty worktree. That is the whole point — a baseline taken
# over uncommitted changes describes a state nobody can return to.
#
# Usage:
#   bash freeze-baseline.sh                 # freeze
#   bash freeze-baseline.sh --allow-dirty   # only for a deliberate dry run
# ============================================================================
set -uo pipefail

ALLOW_DIRTY=0
[ "${1:-}" = "--allow-dirty" ] && ALLOW_DIRTY=1

cd "$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "not a git repository"; exit 1; }

# CLEANLINESS IS MEASURED ON THE SOURCE TREE, EXCLUDING certification/.
#
# Found by running it: the baseline cannot describe a tree that contains it.
# Writing certification/baseline.json dirties the worktree; committing it moves
# HEAD; either way the recorder refuses and the workflow is unrunnable. There is
# no fixed point unless the evidence directory is outside the thing the evidence
# describes.
#
# So certification/ is OUTPUT ABOUT the tree, not part of the tree under test.
# Everything else must be clean.
SRC_DIRTY_SPEC=(-- . ':(exclude)certification')

DIRTY="$(git status --porcelain=v1 "${SRC_DIRTY_SPEC[@]}")"
if [ -n "$DIRTY" ] && [ "$ALLOW_DIRTY" -eq 0 ]; then
  echo "REFUSING TO FREEZE — the source tree is not clean (certification/ excluded):"
  echo "$DIRTY"
  echo
  echo "Decide deliberately, then re-run:"
  echo "  git add <intended>   && git commit -m '…'    # the changes belong in the baseline"
  echo "  git stash push -u -m 'pre-13C-baseline'      # they do not"
  exit 2
fi

COMMIT="$(git rev-parse HEAD)"
BRANCH="$(git branch --show-current)"
CLEAN=$([ -z "$DIRTY" ] && echo true || echo false)

j() { node -e "console.log(JSON.stringify(require('$1').$2 ?? null))" 2>/dev/null || echo null; }

DESKTOP_V=$(j ./apps/desktop/package.json version)
BACKEND_V=$(j ./apps/backend/package.json version)
ELECTRON_V=$(node -e "
const p=require('./apps/desktop/package.json'), r=require('./package.json');
console.log(JSON.stringify((p.devDependencies&&p.devDependencies.electron)||(r.devDependencies&&r.devDependencies.electron)||null))" 2>/dev/null || echo null)
MIGRATIONS=$(ls apps/backend/src/db/migrations/*.sql 2>/dev/null | wc -l | tr -d ' ')
NODE_V=$(node -v 2>/dev/null | tr -d 'v'); NPM_V=$(npm -v 2>/dev/null)
NVMRC=$(cat .nvmrc 2>/dev/null | tr -d '\n')

CH=$(node -e "
const s=require('fs').readFileSync('packages/shared/src/ipc/channels.ts','utf8');
console.log((s.match(/^  [A-Za-z0-9_]+: '/gm)||[]).length)" 2>/dev/null || echo null)
GATED=$(node -e "
const s=require('fs').readFileSync('apps/desktop/src/main/ipc/runtimeAuthz.ts','utf8');
const b=s.slice(s.indexOf('RUNTIME_CHANNEL_PERMISSIONS'), s.indexOf('export const PUBLIC_CHANNELS'));
console.log((b.match(/^\s+\[?IpcChannel\.[A-Za-z0-9_]+\]?:/gm)||[]).length)" 2>/dev/null || echo null)
PUBLIC=$(node -e "
const s=require('fs').readFileSync('apps/desktop/src/main/ipc/runtimeAuthz.ts','utf8');
const i=s.indexOf('export const PUBLIC_CHANNELS');
const b=s.slice(i, s.indexOf(']);', i));
console.log((b.match(/^\s+IpcChannel\.[A-Za-z0-9_]+,/gm)||[]).length)" 2>/dev/null || echo null)

# Patches present as FILES in the tree, with hashes. Recorded because a committed
# .patch is an artifact, not an applied change — Part 1 corollary A.
#
# `reverses_cleanly` is a HEURISTIC, not a verdict, and it is named that way
# deliberately. It reverse-applies the patch as a check: true means every hunk
# is present in the tree. It has a CONFIRMED FALSE NEGATIVE — round19b reports
# false while its F-6 fix is demonstrably in HEAD, because the same patch also
# edits a certification document that has since changed, and one unreversible
# hunk fails the whole check.
#
# So: true is strong evidence the change is in. false is NOT evidence it is out.
# Read the code for anything that matters. A field that could be mistaken for
# proof is exactly the defect class this programme exists to catch.
PATCHES=$(for p in *.patch; do
  [ -e "$p" ] || continue
  h=$( (sha256sum "$p" 2>/dev/null || shasum -a 256 "$p") | awk '{print $1}')
  if git apply --reverse --check "$p" >/dev/null 2>&1; then a=true; else a=false; fi
  printf '{"name":"%s","sha256":"%s","reverses_cleanly":%s},' "$p" "$h" "$a"
done | sed 's/,$//')

mkdir -p certification
cat > certification/baseline.json <<JSON
{
  "program": "13C",
  "certification_id": "CERT-${COMMIT:0:7}",
  "frozen_at_utc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "source": { "commit": "$COMMIT", "branch": "$BRANCH", "worktree_clean": $CLEAN, "clean_excludes": ["certification/"] },
  "versions": {
    "desktop": $DESKTOP_V, "backend": $BACKEND_V, "electron": $ELECTRON_V,
    "node_running": "$NODE_V", "node_pinned": "$NVMRC", "npm": "$NPM_V"
  },
  "schema": { "migration_count": $MIGRATIONS },
  "ipc": { "channels_declared": $CH, "authority_gated": $GATED, "public_allowlist": $PUBLIC },
  "patches": [ $PATCHES ],
  "patches_note": "reverses_cleanly is a heuristic with a known false negative (see script comment). true = the hunks are present; false proves nothing.",
  "toolchain_warning": "node_running vs node_pinned may differ; a suite run under a different major than .nvmrc pins is not a run against this baseline.",
  "absent": ["api_contract_version", "policy_version"],
  "absent_note": "Neither exists in this product. G9 (verdict reproducibility) cannot pass without a policy version to reproduce against. Recorded as absent rather than filled with a plausible value.",
  "tests": { "note": "populate from the run made AGAINST this commit, never from memory" }
}
JSON

H=$( (sha256sum certification/baseline.json 2>/dev/null || shasum -a 256 certification/baseline.json) | awk '{print $1}')
echo "certification/baseline.json written"
echo "BASELINE-$H"
echo
cat certification/baseline.json
echo
echo "From here on: never 'tests passed' — write 'RUN-<id> passed against BASELINE-${H:0:12}'."
