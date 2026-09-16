# SESSION 154 — PRODUCTION UPDATER N→N+1→ROLLBACK CERTIFICATION (FAIL-CLOSED)
### Date: 2026-09-06 · Branch: cert/data-import-cst-integration · HEAD be7f15c · DOCS-ONLY (zero source, zero frozen)
### Verdict: **YELLOW — updater engineered + security posture SOURCE-VERIFIED, but the production feed is not demonstrably published/reachable and no real N/N+1 signed artifacts exist, so the live update run cannot be certified here.** Nothing simulated. No engineering defect found.

---

## A · Environment ground truth
- Repo: HEAD `be7f15c`; tracked tree clean except pre-existing `certification/baseline.json` (M) + untracked
  stray docs (carried from prior sessions; none is desktop source).
- Host: **Linux (Ubuntu, aarch64)** — no packaged Electron GUI runtime; a real electron-updater N→N+1 run
  requires a packaged app on macOS/Windows (neither present — S152/S153 already YELLOW/B).
- **Feed reachability (measured this session, sanctioned `web_fetch` only — no curl/bash fallback per policy):**
  - `https://neuropause033.com/updates/beta-mac.yml` → EMPTY response (no feed content).
  - `https://neuropause033.com/updates/beta.yml` → EMPTY response.
  - `https://neuropause033.com/` → EMPTY response.
  - ⇒ **No published feed content is demonstrable.** (Consistent with prior SEAM-B.10 §48 note that the host was
    DNS-unreachable.) Not converted to GREEN; not converted to a false RED either — recorded as measured.

## B · Updater architecture actually used (single, real — no parallel framework created)
`apps/desktop/src/main/services/appUpdater.ts` over **electron-updater**, wired via
`services/updater/updateChannels.ts` + `updater/index.ts` + `runtimeCore.ts`. Feed = generic HTTPS provider
`https://neuropause033.com/updates`, channel `beta` (`electron-builder.yml`), baked into `app-update.yml` at
package time. Canonical components (all present):
- **Discovery:** `autoUpdater.checkForUpdates()` (renderer-triggered).
- **Feed parse / version compare / artifact select:** electron-updater against the channel yml.
- **Download:** `autoUpdater.downloadUpdate()` (explicit; `autoDownload=false`).
- **Integrity:** electron-updater verifies the downloaded artifact's **sha512** against the feed yml;
  `scripts/verify-release-artifacts.cjs` binds feed sha512 ↔ binaries at build time.
- **Install:** `autoUpdater.quitAndInstall()` (`autoInstallOnAppQuit=false` — never silent).
- **Channels:** stable(latest) / beta / internal, coerced via `resolveChannel` to a fixed enum.
- **Rollback preparation:** `recordVersion()` accrues a dedup version history; `rollbackTarget()` =
  `pickRollbackTarget(current, history)` returns the version a failed update would revert to.
  **There is no automatic in-app DOWNGRADE execution** (`allowDowngrade=false`), by design — see §F.

## C · Feed / hosting reality
Configuration is correct and points at a real HTTPS host, but **no published feed or release artifact is
demonstrable from here** (§A probes empty). No N release and no N+1 release are published to the feed. Prior
context: the newest ever-packaged artifact was `rc.20` (operator-built, pre-B.8, never published to the feed);
S152/S153 produced no signed artifacts. ⇒ There is nothing to update FROM or TO on the live feed.

## D · N→N+1 evidence
**NONE — BLOCKED-B.** No published N, no published N+1, no reachable feed content, no packaged GUI runtime
here. Not run; not simulated. Exact fields (current/target version, metadata, artifact identity, sha512,
verify/download/install/restart results) are all **unavailable** and left blank rather than fabricated.

## E · State-continuity evidence
**BLOCKED-B this session.** Restart durability + at-most-once + durable-journal/outbox/audit coherence are
TEST-PROVEN in prior sessions (S37/S38/S40/S41 crash-recovery + intent-first journal; B.10/B.13 packaged
restart on the operator's macOS build), but continuity **across a real feed update** requires a live N→N+1 run
on real hardware — not reproducible here.

## F · Rollback evidence
**Rollback PREPARATION is implemented; automatic in-app rollback EXECUTION is NOT (deliberate design).**
`rollbackTarget()` exposes the known-good prior version from recorded history, but `allowDowngrade=false` means
electron-updater will not auto-install an older version. The supported recovery is operator/feed-driven
(re-publish or re-install the prior signed artifact), and the app carries the target to make that deterministic.
This is a **roll-forward-with-recorded-target design decision**, not an engineering defect and not a fabricated
"uninstall = rollback" claim. **Certifying a rollback RUN requires a published prior signed artifact + real
hardware → BLOCKED-B.** Whether an automatic in-app downgrade path is desired is an
**architecture/policy decision (C)** — recorded, not invented.

## G · Security / integrity evidence (SOURCE-VERIFIED here; runtime not exercised)
Verified from source this session (these are code facts, honestly labelled as source-verified, not
runtime-observed):
- **HTTPS feed** — generic provider, `https://…` (electron-builder.yml). ✓
- **Artifact integrity** — electron-updater sha512 check against the feed yml; `verify:release` binds feed↔bin. ✓
- **No silent update** — `autoDownload=false`, `autoInstallOnAppQuit=false`. ✓
- **No downgrade bypass** — `allowDowngrade=false`. ✓
- **No renderer-controlled target** — no `setFeedURL`/renderer-supplied URL anywhere (grep 0); feed baked at
  build; channel coerced to a fixed enum (default stable) ⇒ no arbitrary URL acceptance. ✓
- **RBAC** — `update:checkNow/download/installOnQuit/setChannel` = `cloud:operate`; `update:getStatus` =
  `operations:read` (`runtimeAuthz.ts`). ✓
- **No credential leakage** — feed is a public generic provider; no secrets in the updater path. ✓
Signature verification of the payload is provided by the OS installer layer (Authenticode/notarized dmg) at
install time — that half is the S152/S153 signing gates (BLOCKED-B), not the feed path.

## H · Failures + classification
**No A/C/D engineering defect discovered in the updater.** Blockers:
- **B (operator/infrastructure):** production feed not published/reachable; no real N/N+1 signed artifacts; no
  packaged GUI runtime on real macOS/Windows for a live run.
- **C (architecture/policy, recorded not decided):** whether to add an automatic in-app rollback/downgrade
  path (today: roll-forward + recorded target). No code without a ruling.

## I · Remaining release gates
Publish real signed N and N+1 artifacts + feed metadata to a reachable HTTPS host; run the live N→N+1 on real
hardware; decide the rollback-execution policy. All B (plus one C), none A.

## J · GREEN / YELLOW / RED / GRAY ledger
| # | Gate | Status | Note |
|---|---|---|---|
| 1 | Feed reachable | **YELLOW** | 3 web_fetch probes empty; not demonstrably published |
| 2 | N metadata valid | **YELLOW** | no published N |
| 3 | N+1 metadata valid | **YELLOW** | no published N+1 |
| 4 | Artifact available | **YELLOW** | no published/signed artifact (S152/S153) |
| 5 | Artifact integrity verified | **YELLOW** (mechanism SOURCE-VERIFIED) | electron-updater sha512 + verify:release exist; not run on a real artifact |
| 6 | Update discovery | **YELLOW** | needs feed + packaged app |
| 7 | Download | **YELLOW** | needs feed + packaged app |
| 8 | Verification | **YELLOW** (mechanism SOURCE-VERIFIED) | sha512 + installer signature; not exercised |
| 9 | Install/update | **YELLOW** | needs packaged app on real OS |
| 10 | Restart | **YELLOW** | needs packaged app |
| 11 | State continuity | **YELLOW** (test-proven historically) | not across a real feed update |
| 12 | Governed transaction continuity | **YELLOW** (test/runtime-proven historically) | not across a real update |
| 13 | No duplicate economic effect | **YELLOW** (at-most-once test-proven) | not across a real update |
| 14 | Rollback/recovery | **YELLOW** (preparation implemented; execution roll-forward by design) | run BLOCKED-B; auto-downgrade = C decision |
| 15 | Return to known-good state | **YELLOW** | needs prior artifact + hardware |
| 16 | Release evidence | **YELLOW** | no published release |
| — | Updater security posture | **GREEN (SOURCE-VERIFIED)** | HTTPS, sha512 integrity, no downgrade/silent/renderer-URL bypass, RBAC — code facts, runtime not exercised |
| — | Updater engineering defect | **none (not RED)** | no A-class defect found |

No row is GREEN on the *live-run* axis; the only GREEN is the source-verified security posture, explicitly
labelled as such. Absence of evidence was NOT converted to GREEN.

## K · Final verdict
**YELLOW.** The updater is a single, real, security-sound electron-updater implementation (source-verified),
but the production feed is not demonstrably published/reachable, no real N/N+1 signed artifacts exist, and no
packaged GUI runtime is available here — so the live N→N+1→rollback run cannot be certified. **No engineering
defect. No source change. Nothing simulated. No macOS/Windows/GA claim.**

## L · Exact next operator action (feed-publish runbook)
On a machine with the release artifacts (produced by the S152/S153 signed-build runbooks) and access to the
`neuropause033.com` host:
```
# 1. Build + sign N (and later N+1) per S152 (mac) / S153 (win); each `package:*` emits the feed yml:
#    dist/beta-mac.yml (mac) / dist/beta.yml (win) + the update payloads (*.zip/*.dmg/*.exe blockmap).
# 2. Publish to the host document root served at https://neuropause033.com/updates/ :
scp dist/beta-mac.yml dist/*-mac.zip dist/*.dmg* <host>:/opt/neuropause-site/website/updates/
#    alias latest*.yml -> beta*.yml so the 'stable' channel resolves (per electron-builder.yml comment).
# 3. Confirm reachable + correct:
curl -fsSL https://neuropause033.com/updates/beta-mac.yml   # must return the yml with version + sha512
# 4. Install N on real hardware; publish N+1; in the app: check → download → install → relaunch on N+1;
#    verify state/tenant/journal/outbox/audit continuity + no duplicate economic effect.
# 5. Recovery: re-publish/re-install N (the app's rollbackTarget() names the known-good version); verify N.
# 6. Capture every command's real output into certification/SESSION-154-UPDATER-RUN-EVIDENCE.md and flip
#    the ledger rows to GREEN only where the output supports it.
```
Then decide the **rollback-execution policy (C):** keep roll-forward + operator re-install (current design), or
authorize an automatic in-app downgrade path (would be a scoped engineering slice, not done here).

**BLOCKED-B at the feed-publication gate: the production feed is not demonstrably published/reachable and no
real N/N+1 signed artifacts exist. Updater implementation + security posture are source-verified and sound; no
engineering defect. Verdict YELLOW — nothing simulated, no live-run gate claimed GREEN, no GA.**
