# NP-PUBLIC-LAUNCH-003 — FINAL STATE

Recorded 2026-09-13T04:37:51.847Z · branch `pilot/public-launch` @ `6175f3633925b0e7088f85b877563b71d7a3bbc0` · release `NP-OS-1.0.0-rc.30-8a253b6a922f` (source 8331185, evidence 8a253b6)

## FINAL STATE = STATE_3_HUMAN_DECISIONS_REQUIRED

Also true simultaneously: STATE_2 (infrastructure) and STATE_4 (external distribution) conditions are unmet; STATE_3 is assigned because even with infrastructure restored, release version, dependency acceptance, intended use, regulatory review, privacy/legal and the PUBLIC_RELEASE_AUTHORIZATION itself remain human acts. STATE_6/7 are not assignable: no Human Authority release act exists in custody.

## 1. What is actually proven
- Source 6175f3633925 clean; R3 baseline reproduces (f0ba0e8 porcelain=16 digest=27302b8757207bb9 (reproduces)).
- macOS artifact: 15/15 Mach-O objects universal (re-measured with lipo); Developer ID signed, hardened runtime, secure timestamp 13 Sep 2026 09:26:36 (codesign Timestamp=, secure timestamp present); deep/strict verify PASS; DMG app == ZIP app; feed bound to ZIP; no credential patterns; **NOT notarized** (stapler none; Gatekeeper rejects).
- Windows artifacts: built, **unsigned** (Authenticode cert table 0).
- Negative controls 6/6 detected; packaged runtime PASS on the build Mac (8331185).
- Live backend 26/26 and live AI governed loop (local Ollama via gateway) at 8331185; AI authority invariants re-pinned this seam (24 loop tests, 17 (backend src/ai) gateway tests) including 8 adversarial phrases and stale/replayed approvals.
- Version coherent at 1.0.0-rc.30 across package.json, CHANGELOG, feeds, plist, build-info; no tag.

## 2. What is actually production-ready
Engineering artifacts and their verifiers. Nothing user-facing is production-ready: no notarization, no Windows signature, no reachable host, no production AI provider, no deliverable mail.

## 3. What remains technically open
Clean-machine install, update transition, rollback exercise, Intel runtime, observability wiring, mailer, account deletion/export, production AI provider config, CI signing path verification (all NOT_MEASURED or OPEN).

## 4. What requires external infrastructure
Domain renewal (expires 2026-09-15T08:07:40Z), apex/www DNS, api origin/tunnel, Apple notary service access, Windows certificate, mail provider, alert destination.

## 5. What requires the human
RELEASE_VERSION · push decision · dependency acceptance · intended use · regulatory review · privacy/legal · PUBLIC_RELEASE_AUTHORIZATION · notarytool credential step · certificate procurement.

## 6. What can be done immediately without human authority
Done this seam: envelope invariant widening, single-use decisions, adversarial tests, full re-measurement. Remaining machine work needs a human input first (see 03_CLOSURE_PLAN §B).

## 7. Exact evidence required to move each blocker
See 01_RELEASE_BLOCKER_REGISTER.json → verification_command per blocker.

## 8. Smallest next action
Renew neuropause033.com (expires 2026-09-15T08:07:40Z); then store the notarytool keychain profile on this Mac so a session can notarize + staple the exact artifacts.

## 9. Has anything been publicly released?
**NO.** Nothing pushed, tagged, uploaded, published, or authorized. STATE_6/STATE_7 not assigned.
