#!/usr/bin/env bash
# NP governed release bundle — verify BEFORE committing (run from the repository root after copying the bundle in).
# Proves: every script the workflow invokes exists; the installed workflow is byte-identical to the verified golden;
# both gate-consumption analyzers PASS on the installed file; every escape fixture is DENY/UNKNOWN (never PASS).
set -euo pipefail
WF=.github/workflows/neuropause-release.yml; TV=tools/release-verify
export JS_YAML_PATH="${JS_YAML_PATH:-$PWD/node_modules/js-yaml}"; test -d "$JS_YAML_PATH" || { echo "js-yaml not found at $JS_YAML_PATH (run npm ci)"; exit 2; }
for s in $(grep -oE '(^|[^/A-Za-z0-9_.-])scripts/[A-Za-z0-9_.-]+\.cjs' "$WF" | sed -E 's/^[^s]//' | sort -u); do test -f "$s" || { echo "MISSING $s (referenced by workflow)"; exit 1; }; done  # repo-root scripts only (apps/*/scripts are workspace-local)
cmp -s "$WF" "$TV/golden.yml" || { echo "workflow differs from verified golden — re-verify or restore"; exit 1; }
node "$TV/gate-consumption-ast.cjs" "$WF" >/dev/null || { echo "gate-consumption-ast: NOT PASS"; exit 1; }
node "$TV/gate-consumption-ast2.cjs" "$WF" >/dev/null || { echo "gate-consumption-ast2: NOT PASS"; exit 1; }
for f in "$TV"/fixtures/e*.yml; do if node "$TV/gate-consumption-ast.cjs" "$f" >/dev/null 2>&1; then echo "ESCAPE FIXTURE PASSED: $f"; exit 1; fi; done
for w in .github/workflows/*.yml; do [ "$w" = "$WF" ] && continue; if grep -qE 'softprops/action-gh-release|scp |DEPLOY_SSH_KEY|aws s3|wrangler' "$w"; then echo "LEGACY PUBLISHER STILL PRESENT: $w (decommission before installing the governed path)"; exit 1; fi; done
echo "BUNDLE_OK: workflow == golden; analyzers PASS; $(ls "$TV"/fixtures/e*.yml | wc -l | tr -d ' ') escape fixtures non-PASS; no legacy publishers"
