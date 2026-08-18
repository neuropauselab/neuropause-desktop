#!/usr/bin/env bash
# ============================================================================
# Wave-2 Slice-14 — prove the E2E seed seam is STRUCTURALLY ABSENT from a
# normal production build.
#
# The seam in src/main/e2e/e2eSeed.ts can seed a FAKE authenticated principal
# and a FAKE governed connector account, and can redirect Microsoft Graph to a
# mock. It is a security surface. It is gated behind a build-time `define`
# (__NP_E2E__, false unless NP_E2E_BUILD=1) AND a runtime flag (NEUROPAUSE_E2E=1).
# This script is the standing guarantee that the FIRST gate actually strips it:
# a plain `electron-vite build` must contain NONE of it.
#
#   PASS (exit 0) — 0 sentinel files, no e2eSeed chunk, 0 branch refs in main.
#   FAIL (exit 1) — the seam leaked into a release build. Do not ship.
#
# Run from apps/desktop. Belongs in the standing regression list and the
# distribution/release checklist.
# ============================================================================
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

SENTINEL='NEUROPAUSE_E2E_SEED_v1'
echo "verify-e2e-strip: building a RELEASE bundle (no NP_E2E_BUILD)…"
# Deliberately unset the e2e build flag so this is a true release build.
if ! (unset NP_E2E_BUILD; npx electron-vite build) > /tmp/verify-e2e-strip-build.log 2>&1; then
  echo "FAIL — release build errored:"; tail -15 /tmp/verify-e2e-strip-build.log; exit 1
fi

FAIL=0
# grep -c prints "0" AND exits 1 on no matches, so DON'T chain `|| echo 0` (it doubles the output). Take line 1.
SENT_FILES=$(grep -rl "$SENTINEL" out/main/ 2>/dev/null | wc -l | tr -d ' ')
CHUNK=$(ls out/main/chunks/ 2>/dev/null | grep -cE 'e2eSeed|firstRealSendGuard|e2eMode|s16VerifyRun'); CHUNK=$(printf '%s' "$CHUNK" | head -1)
BRANCH=$(grep -c "NEUROPAUSE_E2E\|installE2eSeeds\|e2e-mock-access-token\|runS16Verification\|NEUROPAUSE_VERIFY_S15" out/main/index.js 2>/dev/null); BRANCH=$(printf '%s' "$BRANCH" | head -1)
# Slice-15/16 gated strings must be absent from every release-bundle file too.
GUARD=$(grep -rl "RECIPIENT_NOT_ALLOWLISTED\|first-real-send.latch\|neuropause033@gmail.com\|firstRealSendGuard\|NEUROPAUSE_S16_VERIFY_v1" out/main/ 2>/dev/null | wc -l | tr -d ' ')

echo "  sentinel files in out/main    : $SENT_FILES   (want 0)"
echo "  e2eSeed/guard chunk present   : $CHUNK   (want 0)"
echo "  seam refs in main index.js    : $BRANCH   (want 0)"
echo "  first-real-send guard strings : $GUARD   (want 0)"

[ "$SENT_FILES" = "0" ] || { echo "  -> LEAK: seed sentinel present in the release bundle"; FAIL=1; }
[ "$CHUNK" = "0" ]      || { echo "  -> LEAK: e2eSeed/firstRealSendGuard chunk emitted in the release build"; FAIL=1; }
[ "$BRANCH" = "0" ]     || { echo "  -> LEAK: seam branch references in main index.js"; FAIL=1; }
[ "$GUARD" = "0" ]      || { echo "  -> LEAK: first-real-send guard present in the release bundle"; FAIL=1; }

echo
if [ "$FAIL" -eq 0 ]; then
  echo "PASS — the E2E seed seam is absent from the release build."
  exit 0
fi
echo "FAIL — the E2E seed seam LEAKED into a release build. This build must not ship."
exit 1
