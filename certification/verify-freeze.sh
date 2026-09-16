#!/usr/bin/env bash
# ============================================================================
# 13C — O-7. IS THE FREEZE STILL INTACT?
#
# WHY THIS EXISTS
#
# On 2026-08-13 a commit entered the frozen certification branch, bumped the
# product version rc.15 -> rc.16, was tagged `v1.0.0-rc.16`, pushed, and
# triggered five CI workflows including two release builds. Nothing in the
# programme noticed. The recorder would have refused (HEAD had moved), but the
# merge to `main` never went through the recorder, so there was no moment at
# which anything asked the question.
#
# This script is that moment. It is cheap, it takes no arguments, and it is safe
# to run anywhere — including in CI, where it is the only thing standing between
# a frozen baseline and a silent overwrite.
#
# THREE ANSWERS:
#   0  INTACT      — the source matches the baseline; evidence commits are fine
#   1  BROKEN      — source changed since the freeze, or the baseline is not in
#                    this history. The certification describes a tree nobody has.
#   2  NO BASELINE — nothing is frozen; there is nothing to protect yet
#
# IT DOES NOT INVENT ATTRIBUTION. Every commit in this repository is authored by
# the machine's configured git identity, so `%an` names a config, not a person.
# That is printed as what it is. A repository that cannot say who made a change
# should say so out loud rather than print a name and imply it means something.
# ============================================================================
set -uo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "not a git repository"; exit 1; }
BASE=certification/baseline.json

# Same spec as freeze-baseline.sh and record-gate.sh. certification/ is OUTPUT
# ABOUT the tree, not part of the tree under test — see the note in either.
SRC_SPEC=(-- . ':(exclude)certification' ':(exclude)CLAUDE.md' ':(exclude)NP_STATE.md' ':(exclude)BLOCKERS.md' ':(exclude)DECISIONS.md' ':(exclude)ROADMAP-HORIZON.md' ':(exclude)AUTONOMY.md' ':(exclude)WORK_QUEUE.md')

if [ ! -f "$BASE" ]; then
  echo "NO BASELINE — $BASE does not exist. Nothing is frozen."
  exit 2
fi

BASE_COMMIT=$(node -e "console.log(require('./$BASE').source.commit)" 2>/dev/null || echo "")
BASE_BRANCH=$(node -e "console.log(require('./$BASE').source.branch)" 2>/dev/null || echo "")
FROZEN_AT=$(node -e "console.log(require('./$BASE').frozen_at_utc)" 2>/dev/null || echo "")
[ -n "$BASE_COMMIT" ] || { echo "BROKEN — $BASE has no source.commit"; exit 1; }

HEAD_COMMIT=$(git rev-parse HEAD)
NOW_BRANCH=$(git branch --show-current)

echo "baseline commit : $BASE_COMMIT  (branch $BASE_BRANCH, frozen $FROZEN_AT)"
echo "HEAD            : $HEAD_COMMIT  (branch ${NOW_BRANCH:-detached})"
echo

FAIL=0

# ── 1 · the baseline must be IN this history ────────────────────────────────
if git cat-file -e "${BASE_COMMIT}^{commit}" 2>/dev/null; then
  if git merge-base --is-ancestor "$BASE_COMMIT" HEAD 2>/dev/null; then
    echo "ANCESTRY   OK   — the baseline commit is an ancestor of HEAD"
  else
    echo "ANCESTRY   FAIL — the baseline commit is NOT an ancestor of HEAD."
    echo "                  This branch does not contain the certified tree."
    FAIL=1
  fi
else
  echo "ANCESTRY   FAIL — the baseline commit does not exist in this repository."
  FAIL=1
fi

# ── 2 · the SOURCE must be unchanged; evidence may move freely ──────────────
if [ "$FAIL" -eq 0 ]; then
  if git diff --quiet "$BASE_COMMIT" HEAD "${SRC_SPEC[@]}"; then
    echo "SOURCE     OK   — identical to the baseline (certification/ excluded)"
  else
    echo "SOURCE     FAIL — changed since the freeze:"
    git diff --stat "$BASE_COMMIT" HEAD "${SRC_SPEC[@]}" | sed 's/^/                  /' | tail -25
    FAIL=1
  fi
fi

# ── 3 · PROVENANCE — name every commit that entered after the freeze ────────
if git cat-file -e "${BASE_COMMIT}^{commit}" 2>/dev/null; then
  SINCE="$(git log --format='%h  %ad  %an <%ae>  %s' --date=iso-strict "$BASE_COMMIT..HEAD" 2>/dev/null)"
  if [ -n "$SINCE" ]; then
    echo
    echo "COMMITS SINCE THE FREEZE:"
    echo "$SINCE" | sed 's/^/  /'
    echo
    # Which of them touched SOURCE? Those are the ones that break a freeze.
    SRC_COMMITS="$(git log --format='%h  %an <%ae>  %s' "$BASE_COMMIT..HEAD" "${SRC_SPEC[@]}" 2>/dev/null)"
    if [ -n "$SRC_COMMITS" ]; then
      echo "  ^ OF THOSE, THESE TOUCHED SOURCE — the freeze was broken by:"
      echo "$SRC_COMMITS" | sed 's/^/    /'
      FAIL=1
    else
      echo "  (none of them touched source — evidence commits only, which is correct)"
    fi
    echo
    AUTHORS="$(git log --format='%an <%ae>' "$BASE_COMMIT..HEAD" | sort -u | wc -l | tr -d ' ')"
    if [ "$AUTHORS" = "1" ]; then
      echo "ATTRIBUTION: every commit above carries ONE identity —"
      echo "             $(git log -1 --format='%an <%ae>' HEAD)"
      echo "             That is the machine's git config, not a person. This"
      echo "             repository CANNOT attribute a change to a human. Stated,"
      echo "             not fixed: per-user identity or signed commits close it."
    fi
  fi
fi

echo
if [ "$FAIL" -eq 0 ]; then
  echo "FREEZE INTACT — evidence recorded against this baseline still describes HEAD's source."
  exit 0
fi
echo "FREEZE BROKEN — re-freeze before recording anything further."
exit 1
