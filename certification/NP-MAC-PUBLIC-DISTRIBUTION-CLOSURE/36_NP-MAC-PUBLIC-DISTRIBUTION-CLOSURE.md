# NP-MAC-PUBLIC-DISTRIBUTION-CLOSURE — RESULT

Recorded 2026-09-13T04:01:05.907Z · COMPUTER_B · source 8331185ba41f9eb1b44eeb3656f005491df8f24d · release NP-OS-1.0.0-rc.30-8331185ba41f

## Executive result — B — SIGNED_BUT_NOT_NOTARIZED

| Dimension | Status |
| --- | --- |
| ARCHITECTURE | PASS — 15/15 Mach-O objects universal (x86_64 + arm64); 0 native modules |
| PACKAGE | PASS — every runtime-required package packaged; exact bundle specifiers resolve; DMG app == ZIP app (bundle digest d4ebea63dd3a045c…) |
| RUNTIME | PASS (arm64) — packaged app launched from the ZIP, isPackaged=true, 5/5 bundle modules loaded in the main process, renderer READY, clean exit 0 · Intel: NOT_MEASURED |
| SECURITY | PASS (artifact) — no credential patterns; baked backend https; endpoint strings classified LEGITIMATE |
| SIGNING | PASS — Developer ID Application (J3G89MY3QG), hardened runtime, deep/strict verify, 14 nested objects |
| NOTARIZATION | FAIL — not notarized; stapler none; spctl: source=Unnotarized Developer ID |
| UPDATE | PASS (feed ↔ artifact) / NOT_MEASURED (live transition) |
| DISTRIBUTION | BLOCKED — not published; host 530 |
| LAST_MILE | NOT_MEASURED — no clean external machine; download bytes not verifiable |
| GOVERNANCE | HUMAN_DECISION_REQUIRED — release authorization, version, architecture confirmation |

## What is technically proven
SOURCE (8331185ba41f) → LOCKFILE (4a29565e59b5…) → CLEAN INSTALL (npm ci) → UNIVERSAL BUILD → COMPLETE APP PAYLOAD (85 packages, 0 missing) → ACTUAL PACKAGED RUNTIME (READY) → SIGNING (Developer ID). The chain stops at NOTARIZATION.

## The prior failure class cannot pass unnoticed
`verify-mac-artifact.controls.cjs`: NEG-DEP, NEG-ENTRY, NEG-ARCH, NEG-BYTE, NEG-NAME, NEG-URL all detected (22_NEGATIVE_CONTROL.json); POSITIVE control on the real bytes (23_POSITIVE_CONTROL.json). `packaged-smoke.cjs` additionally found that a bare `require('@neuropause/cst')` fails in the packaged process (manifest `main` stale) while every specifier the bundle actually uses loads — recorded as C-03/C-04 in 34_CONFLICT_REGISTER.json.

## Known defects
- @neuropause/cst 1.3.0 package.json `main` points to a non-existent file (no runtime impact; kernel not modified).
- CI signing step failed at rc.29 on a Darwin 25 runner; runner pinned to macos-15 in this branch (unverified until pushed).
- dmg artifactName carries no version (stable alias only) — identity is the registered digest.
- download.html shows no SHA-256 values.

## Human decisions
RELEASE_VERSION · MAC_ARCHITECTURE (universal confirm) · minimum macOS support policy (12.0 measured) · push branch · notarization credential path (CI fix or local keychain profile) · PUBLIC_RELEASE_AUTHORIZATION.

## Release classification
**HUMAN DECISION REQUIRED** after **BLOCKED** technical items (notarization, public host). Computer-B built, measured, verified, packaged and blocked; it did not decide.
