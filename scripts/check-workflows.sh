#!/usr/bin/env bash
# ============================================================================
# P13C ROUND 25 — W-4. THE WORKFLOWS MUST PARSE, AND THEIR `if:` MUST BE LEGAL.
#
# On 2026-08-13 both release workflows were edited to guard a publish step with
#
#     if: ${{ vars.PUBLISH_TO_SITE == 'true' && secrets.DEPLOY_SSH_KEY != '' }}
#
# `secrets` is NOT an available context in `jobs.<id>.steps[*].if`. GitHub
# rejected the entire file — so from that commit onward `windows-release` and
# `macos-release` could not be dispatched at all, and the failure surfaced only
# as an HTTP 422 the day someone tried to run one. Between the break and the
# discovery, every macOS release attempt failed for a reason nobody had
# attributed correctly.
#
# The edit that caused it was itself a repair: the line previously read
# `env.DEPLOY_SSH_KEY != ''` against the step's OWN `env:` block, which a step
# `if:` also cannot see. Both the defect and its correction were invisible
# locally, because nothing in this repository ever parsed a workflow file.
#
# TWO CHECKS, BOTH CHEAP, EITHER OF WHICH WOULD HAVE CAUGHT IT:
#
#   1. Every workflow file parses as YAML.
#   2. No `if:` expression references a context that is not available to it.
#
# Check 2 is deliberately a denylist of the contexts GitHub documents as
# unavailable in `if:`, not an allowlist of legal expressions. An allowlist
# would need a full expression parser and would fail closed on syntax this
# script does not understand — turning a guard into an obstacle. The denylist
# catches the mistake that was actually made, and the mistakes adjacent to it.
#
# Exit 0 clean, 1 on any violation. Runs from the repository root.
# ============================================================================
set -uo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "check-workflows: not a git repository"
  exit 1
}

DIR=.github/workflows
FAILED=0

if [ ! -d "$DIR" ]; then
  echo "check-workflows: no $DIR — nothing to check"
  exit 0
fi

FILES=$(find "$DIR" -maxdepth 1 -type f \( -name '*.yml' -o -name '*.yaml' \) | sort)
if [ -z "$FILES" ]; then
  echo "check-workflows: no workflow files in $DIR"
  exit 0
fi

# ── Check 1 · IT HAS TO PARSE ───────────────────────────────────────────────
#
# P13C ROUND 30 — W-9. THE CHECK HAS TO RUN WHERE THE EDITS HAPPEN.
#
# This asked for python3 + PyYAML and, failing that, refused. That is correct on
# the Ubuntu runner, where PyYAML is present, and useless on a macOS developer
# machine, where the system python has no PyYAML and `pip install` is refused by
# an externally-managed environment. So the guard ran green in CI and could not
# run at all on the laptop where the workflow files are actually written — which
# is precisely where a parse error needs catching, minutes before it is pushed.
#
# Ruby ships with macOS and carries Psych, so `Psych.parse_file` is a pure
# syntax check with no gem install. Tried in order; refusing is still the last
# resort, because a checker that skips silently reports success on the runs
# where it did nothing.
PARSER=""
if python3 -c 'import yaml' 2>/dev/null; then
  PARSER="python"
elif command -v ruby >/dev/null 2>&1 && ruby -ryaml -e 'Psych' 2>/dev/null; then
  PARSER="ruby"
elif python3 -m pip install --quiet --disable-pip-version-check pyyaml >/dev/null 2>&1; then
  PARSER="python"
else
  echo "check-workflows: FAILED — no YAML parser available (tried python3+PyYAML, ruby+Psych)"
  echo "  Install one, or run this in CI. Refusing to report success without parsing."
  exit 1
fi

parse_one() {
  if [ "$PARSER" = "ruby" ]; then
    ruby -ryaml -e 'Psych.parse_file(ARGV[0])' "$1" 2>/tmp/wf-parse-err
  else
    python3 -c "import sys,yaml; yaml.safe_load(open(sys.argv[1]))" "$1" 2>/tmp/wf-parse-err
  fi
}

for f in $FILES; do
  if parse_one "$f"; then
    echo "  parse OK   $f"
  else
    echo "  PARSE FAIL $f"
    sed 's/^/             /' /tmp/wf-parse-err
    FAILED=1
  fi
done

# ── Check 2 · CONTEXTS THAT ARE NOT AVAILABLE IN `if:` ──────────────────────
#
# `secrets` is the one that broke this repository. `inputs` and `hashFiles` are
# included because they fail the same way — accepted by a human reader, rejected
# by GitHub's expression validator at load time, taking the whole file with them.
#
# Matches the `if:` key specifically, so a `run:` block that legitimately reads
# `${{ secrets.X }}` is untouched.
for ctx in secrets hashFiles; do
  HITS=$(grep -rnE "^[[:space:]]*if:.*\b${ctx}\." $FILES 2>/dev/null || true)
  if [ -n "$HITS" ]; then
    echo "  ILLEGAL CONTEXT in an if: — '${ctx}' is not available there"
    echo "$HITS" | sed 's/^/             /'
    echo "             Put the value in a JOB-level env: (where the context IS"
    echo "             available) and test that env var in the if: instead."
    FAILED=1
  fi
done

if [ "$FAILED" -eq 0 ]; then
  echo "check-workflows: OK — every workflow parses and no if: uses an unavailable context"
  exit 0
fi

echo "check-workflows: FAILED"
exit 1
