# SESSION 152 — macOS RELEASE-CANDIDATE CERTIFICATION (FAIL-CLOSED)
### Date: 2026-09-06 · Branch: cert/data-import-cst-integration · HEAD f6c4ee9 · DOCS-ONLY (zero source, zero frozen)
### Verdict: **YELLOW — engineered + package-capable, but macOS operator evidence CANNOT be produced in this environment.** No macOS gate is claimed GREEN. Nothing simulated.

---

## 0 · Environment ground truth (why this session stops)
The certification execution environment is **Linux, not macOS** — measured this session:
- `uname -a` → `Linux … 6.8.0 … aarch64 GNU/Linux`; `sw_vers` → NOT PRESENT.
- macOS release toolchain: `codesign`, `xcrun`, `spctl`, `security`, `notarytool`, `stapler`, `productsign`,
  `pkgutil` → **ALL ABSENT**.
- Apple/signing credentials: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `CSC_LINK`,
  `CSC_KEY_PASSWORD`, `NEUROPAUSE_REQUIRE_NOTARIZATION` → **ALL UNSET**.

The mission states explicitly: *"Linux CI evidence is NOT sufficient for macOS Developer ID signing,
notarization, Gatekeeper, real macOS Keychain, packaged Electron runtime behavior. Only claim these GREEN
after executing them on real macOS hardware."* and *"If credentials, certificates, Apple account access,
hardware, or another operator prerequisite is unavailable: STOP at that exact gate. Do not simulate success.
Do not mark it GREEN."*

**Therefore this session STOPS at the first macOS-hardware gate. Every macOS gate below is BLOCKED-B
(operator/environment), not RED (no engineering defect was found), and none is marked GREEN.**

## 1 · Release-path gate ledger (SOURCE → … → VERIFY)
| # | Gate | Status | Class | Evidence / blocker |
|---|---|---|---|---|
| 1 | SOURCE (commit + cleanliness) | **VERIFIABLE HERE** | — | HEAD `f6c4ee9`; tracked tree clean except pre-existing `certification/baseline.json` (M) + untracked stray docs (`.claude/`, SLSA audit, two NP-* evidence docs) carried since prior sessions — none is desktop source. Desktop + frozen contracts byte-identical to S150 (S151 measurement). |
| 2 | BUILD (electron-vite bundle) | NOT RUN | B | Buildable on Linux, but a Linux JS bundle proves nothing about the signed mac `.app`; deliberately not run to avoid conflating with the mac claim. |
| 3 | PACKAGE (mac dmg/zip) | **BLOCKED** | B | `electron-builder --mac` requires macOS. Cannot execute on Linux. |
| 4 | SIGN (Developer ID) | **BLOCKED** | B | No macOS, no `codesign`, no Developer ID cert in keychain. |
| 5 | HARDENED RUNTIME + ENTITLEMENTS | CONFIG-VERIFIED, RUNTIME BLOCKED | B | `electron-builder.yml`: `hardenedRuntime: true`, `entitlements: resources/entitlements.mac.plist`, `entitlementsInherit: …inherit.plist` (S151). Runtime verification (`codesign -d --entitlements`) needs the signed `.app`. |
| 6 | NOTARIZE | **BLOCKED** | B | `notarize.cjs` afterSign hook exists; needs `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` + `notarytool` + Apple account. All absent. |
| 7 | STAPLE | **BLOCKED** | B | `stapler` absent; requires a notarized artifact. |
| 8 | GATEKEEPER | **BLOCKED** | B | `spctl -a -vv` absent; requires the installed, stapled `.app` on macOS. |
| 9 | INSTALL (fresh profile) | **BLOCKED** | B | Requires the dmg on macOS. |
| 10 | FIRST RUN / ONBOARDING / LOCAL-FIRST | **BLOCKED** | B | Requires the packaged mac app; behavior is in-app-proven on prior sessions but not on a signed mac artifact here. |
| 11 | AUTHENTICATE | **BLOCKED** | B | Operator-at-keyboard on the mac app. |
| 12 | OPERATE / TRANSACT (governed) | **BLOCKED** (mac) | B | Governed path is RUNTIME-PROVEN in prior sessions (B.10 journal-post, B.13 packaged-runtime on macOS build) — but that was the operator's prior mac run, not this session; not re-provable from Linux. |
| 13 | macOS KEYCHAIN (packaged Electron) | **BLOCKED** | B | `security` absent; requires the packaged app on macOS (S116-O1 harness). |
| 14 | RESTART / RECOVER | **BLOCKED** (mac) | B | Durable-journal recovery is test-proven; a packaged-mac restart run needs the mac artifact. |
| 15 | PACKAGED-CONTENT / no test seeds | **BLOCKED** (on the mac asar) | B | `verify-e2e-strip.sh` + `verify-packaged-content.cjs` verify the asar; they need the packaged mac artifact. (Prior B.13 run verified 0 sentinels in the asar on the operator's mac build — not reproducible here.) |
| 16 | SBOM / provenance | PARTIALLY VERIFIABLE HERE | B | `npm run sbom` / `verify:sbom` are Node scripts (Linux-runnable), but the release SBOM must be generated against the actual packaged artifact; deferred to the mac run for a single coherent evidence set. |
| 17 | RELEASE HASHES / FEED | **BLOCKED** | B | `verify:release` compares the feed (`beta*.yml`) sha512 to the packaged binaries — needs the mac artifacts. |

## 2 · A–N final report
- **A · Exact commit:** `f6c4ee9` (HEAD; desktop + frozen contracts identical to S150 `d4d6cc6`).
- **B · Artifact names + hashes:** **NONE PRODUCED THIS SESSION** (no macOS build). Expected on the mac run:
  `NeuroPause-arm64.dmg`, `NeuroPause-arm64.zip`, `app.asar`, `beta-mac.yml` — hashes recorded by
  `verify:release` at build time.
- **C · Signing evidence:** **BLOCKED-B** — no Developer ID cert / `codesign` in this environment.
- **D · Notarization evidence:** **BLOCKED-B** — no Apple credentials / `notarytool`.
- **E · Gatekeeper evidence:** **BLOCKED-B** — no `spctl` / no macOS.
- **F · Keychain evidence:** **BLOCKED-B** — no `security` / no packaged mac app.
- **G · Fresh-install evidence:** **BLOCKED-B** — no dmg / no macOS.
- **H · First-user acceptance evidence:** **BLOCKED-B** — needs the packaged mac app.
- **I · Governed transaction evidence:** **BLOCKED-B this session** (RUNTIME-PROVEN historically on the
  operator's mac build; not reproducible from Linux).
- **J · Restart/recovery evidence:** **BLOCKED-B this session** (test-proven; mac-packaged run pending).
- **K · Packaged-content / SBOM evidence:** **BLOCKED-B** on the mac asar (prior B.13: 0 sentinels — operator
  build, not this session).
- **L · Failures + classification:** **No A/C/D defect discovered.** The sole blocker is **B
  (operator/environment): macOS Apple-Silicon hardware + Developer ID certificate + Apple notarization
  credentials are absent from this Linux execution environment.** The release infrastructure itself was
  verified present and engineered in S151 (package:mac, notarize.cjs, hardened-runtime/entitlements config,
  verify:release/sbom/packaged, verify-e2e-strip, macos-release CI).
- **M · Remaining release gates:** all of §1 rows 3–17 — every one gated by macOS hardware + Apple
  credentials, none by code.
- **N · Final verdict:** **YELLOW.** Engineered + package-capable; macOS RC operator evidence is missing
  because the required hardware/credentials are unavailable here. **NOT GREEN. NOT GA. Nothing simulated.**

## 3 · Exact operator runbook (execute on real Apple-Silicon macOS)
Prereqs: macOS 12+ Apple Silicon + Xcode CLT; **Developer ID Application** cert in the login keychain;
`export APPLE_ID=… APPLE_APP_SPECIFIC_PASSWORD=… APPLE_TEAM_ID=… NEUROPAUSE_REQUIRE_NOTARIZATION=true`.
```
cd apps/desktop
security find-identity -v -p codesigning            # (C) confirm Developer ID Application identity
npm ci
npm run package:mac                                  # (3)(4)(5)(6)(7) build → sign → notarize(afterSign) → staple; verify:release runs
cat dist/notarization-status.json                    # (D) notarization result recorded by notarize.cjs
codesign -dv --verbose=4 "dist/mac-arm64/NeuroPause.app"   # (C)(4) signature + Team ID
codesign -d --entitlements :- "dist/mac-arm64/NeuroPause.app"  # (5) entitlements
xcrun stapler validate "dist/mac-arm64/NeuroPause.app"     # (7) staple
spctl -a -vv "dist/mac-arm64/NeuroPause.app"         # (8) Gatekeeper: "accepted, source=Notarized Developer ID"
# INSTALL from dist/NeuroPause-arm64.dmg to /Applications on a FRESH user profile, then:
#   (9)(10)(11) launch → onboarding (Skip setup → Skip tour) → local-first shell → optional connect
#   (12) run a governed transaction (create Sales Order / post a journal) → proposal→confirm→verified→evidence
#   (13) S116-O1 keychain live-check harness on the packaged app
#   (14) quit + relaunch → durable state recovers, no duplicate effect
npm run verify:packaged -- --dir "dist/mac-arm64/NeuroPause.app/Contents/Resources"  # (15) no seeds/sentinels
bash scripts/verify-e2e-strip.sh                     # (15) strip check
npm run verify:sbom                                  # (16) SBOM/provenance
npm run verify:release                               # (17) feed sha512 ↔ binaries
```
Capture each command's output into `certification/SESSION-152-MAC-RUN-EVIDENCE.md` and flip the §1 rows to
GREEN only where the real output supports it.

## 4 · Scope discipline honored
No Windows claim made. No updater N→N+1 claim made (host not exercised). No source modified, no frozen surface
touched, no FG requested (none needed — the blocker is environment, not contract). No feature work, no
deferred architecture reopened, no policy-open capability activated. No GA claim.

## 5 · Recommended next step (S153)
This macOS RC track is **operator-executed** and cannot be advanced from this environment. The operator runs §3
on Apple-Silicon hardware and captures evidence; the verdict then moves YELLOW→GREEN per real output. If the
operator prefers a track that is *also* blocked only by environment, the alternatives are identical in kind:
Windows real-hardware certification (Authenticode + SmartScreen) or updater N→N+1→rollback (needs the
`neuropause033.com/updates` host). All three are category-B operator gates; none is engineering.
```
```

**BLOCKED-B at the macOS packaging gate: no Apple-Silicon hardware, no Developer ID certificate, no Apple
notarization credentials in this Linux environment. No engineering defect found; release infrastructure is
present and engineered. Verdict YELLOW — nothing simulated, no macOS gate claimed GREEN, no GA.**
