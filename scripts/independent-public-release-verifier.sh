#!/usr/bin/env bash
# NP-R34.2-B.32 — INDEPENDENT PUBLIC RELEASE VERIFIER (read-only; curl + openssl + sed only)
# Usage: bash independent-public-release-verifier.sh [--full]   (--full downloads the installer and checks sha512 against the feed)
# Any second principal can run this from any machine. It performs HTTP HEAD/GET only. Exit 0 = coherent, 1 = incoherent/unknown.
set -u; H="${NP_HOST:-https://neuropause033.com}"; FULL="${1:-}"; rc=0
hd(){ curl -sS -I -L "$H/$1" 2>/dev/null | tr -d '\r'; }
for o in updates/latest.yml updates/beta.yml updates/latest-mac.yml updates/beta-mac.yml downloads/NeuroPause-Setup.exe downloads/NeuroPause.dmg; do
  h=$(hd "$o"); st=$(printf '%s\n' "$h" | awk 'toupper($1) ~ /^HTTP/{s=$2} END{print s}'); et=$(printf '%s\n' "$h" | sed -n 's/^[Ee][Tt]ag: *//p' | tail -1); ln=$(printf '%s\n' "$h" | sed -n 's/^[Cc]ontent-[Ll]ength: *//p' | tail -1); cf=$(printf '%s\n' "$h" | sed -n 's/^cf-cache-status: *//Ip' | tail -1)
  printf '%-32s http=%s etag=%s len=%s cf-cache=%s\n' "$o" "${st:-?}" "${et:-"-"}" "${ln:-"-"}" "${cf:-"-"}"
done
L=$(curl -fsSL "$H/updates/latest.yml"); B=$(curl -fsSL "$H/updates/beta.yml" 2>/dev/null || true)
V=$(printf '%s\n' "$L" | sed -n 's/^[[:space:]]*version:[[:space:]]*//p' | head -1); S=$(printf '%s\n' "$L" | sed -n 's/^[[:space:]]*sha512:[[:space:]]*//p' | head -1); P=$(printf '%s\n' "$L" | sed -n 's/^[[:space:]]*path:[[:space:]]*//p' | head -1)
echo "latest.yml version=$V path=$P sha512(b64)=${S:0:16}…"; [ "$L" = "$B" ] && echo "latest.yml == beta.yml (byte-identical)" || echo "latest.yml != beta.yml"
if [ -n "${EXPECT_VERSION:-}" ]; then [ "$V" = "$EXPECT_VERSION" ] && echo "COHERENT: served version == expected $EXPECT_VERSION" || { echo "INCOHERENT: served $V != expected $EXPECT_VERSION"; rc=1; }; else echo "EXPECT_VERSION unset — coherence vs candidate NOT evaluated (set EXPECT_VERSION=1.0.0-rc.29 to evaluate)"; rc=1; fi
if [ "$FULL" = "--full" ]; then T="${TMPDIR:-/tmp}/np-verify-$$.exe"; curl -fsSL "$H/downloads/NeuroPause-Setup.exe" -o "$T" && D=$(openssl dgst -sha512 -binary "$T" | openssl base64 -A); [ "$D" = "$S" ] && echo "INSTALLER sha512 MATCHES feed" || { echo "INSTALLER sha512 MISMATCH vs feed"; rc=1; }; rm -f "$T"; fi
exit $rc
