# SESSION 69 — DISTRIBUTION TRUST (GITHUB NOTARIZATION PATH)

## Executive result

**One important CORRECTION and one newly-discovered ENGINEERING blocker — notarization was NOT
executed, and correctly so.** The Apple notarization credentials **ARE configured in GitHub
Secrets** (measured — this corrects S65/S67's "credentials absent", which was true only of the
local shell). But three independent facts block executing notarization against `8079ec7` today,
and none is "missing credentials": (1) the release workflow's `lint:release` gate **FAILS at
`8079ec7`** on two **frozen-surface** errors — the exact step that killed every prior
`macos-release` run — so a trigger would die before Package/notarize; (2) `8079ec7` is **not on
the remote** (5 local commits); (3) triggering requires a `v*` tag that publishes a **public
GitHub Release** + a real Apple submission — standing hard gates. **MAC DISTRIBUTION TRUST = NOT
GREEN**, re-characterized precisely. No push, tag, trigger, or secret-value exposure occurred.

## 1 · Custody

- HEAD `b3b9bf8` (S68) · `8079ec7` in history (commit) · branch `cert/data-import-cst-integration`.
- S68 clean candidate verified: dmg present, **asar sha `997f6f74…d22479` exact**, build-info
  `8079ec7 / dirty:false` (from S68). Application payload NOT modified this session.
- Remote at `fb8f320` (S62); S63–S68 remain local-only.

## 2 · Existing release/notarization workflow (discovered, read-only)

- **`.github/workflows/macos-release.yml`** — runs on `macos-latest`; triggered by
  `workflow_dispatch` (build only) or a **`v*` tag push** (build **+ publish a public GitHub
  Release**). It **REBUILDS** from the checked-out git ref (`npm run package:mac`) — it does NOT
  notarize an existing local artifact. Signing turns on when `APPLE_CSC_LINK` is present;
  `scripts/notarize.cjs` notarizes when `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` +
  `APPLE_TEAM_ID` are present (all read via `env:`, never interpolated into shell source).
- **Consumed secrets (NAMES only, never values):** `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
  `APPLE_TEAM_ID`, `APPLE_CSC_LINK`, `APPLE_CSC_KEY_PASSWORD`, `DEPLOY_SSH_KEY`.
- **Secret presence measured (`gh secret list`, names+dates only):** all five `APPLE_*` secrets
  are configured (dates 2026-08-07/08-13) + `DEPLOY_SSH_KEY`. **The notarization credentials
  exist — S65/S67 "OPERATOR-BLOCKED, credentials absent" is CORRECTED: absent locally, present
  in CI.**

## 3 · The "notarized before" claim vs the run history (§2 #22)

The operator fact "NeuroPause has been notarized successfully before" is **NOT EVIDENCED** in the
measured history: **every visible `macos-release` run is `failure`** (rc.17/19/20), the newest
GitHub Release is **rc.17** (Pre-release), and there is no rc.22/rc.23/rc.24 release. Diagnosed:
the recent runs (rc.19 run `31865365814`, rc.20 run `31865365466`) failed at the **Lint step** —
`✓ Typecheck → ✗ Lint → (Package/notarize never ran)`. **Notarization has never been reached in
visible history**, let alone succeeded. Recorded as measurement, not accepted as claim.

## 4 · THE ENGINEERING BLOCKER — `lint:release` fails at `8079ec7` on frozen surfaces

`npm run lint:release` (root: `eslint apps/desktop apps/backend packages/shared … --max-warnings 0`)
**FAILS with 2 errors at `8079ec7`:**
1. `apps/desktop/src/main/cst/sendTransition.negative.test.ts:16` — unused `WriteActionResult`
   (the long-logged frozen-path defect, CLAUDE.md §1).
2. `packages/shared/src/ipc/contracts.ts:2482` — `no-useless-escape` (the same frozen escape
   class logged in §1, line drifted from 2418).

**Both files are FROZEN** (gate-detector: FROZEN for both). Under `--max-warnings 0` these are
release-fatal, and they are the exact reason the workflow dies at Lint. **Fixing them requires an
FG gate** (frozen `cst/` + `packages/shared/`) — an explicit, gated engineering step, OUT OF S69
SCOPE (S69 is distribution trust, not frozen-source modification). Until fixed, the release
workflow CANNOT reach Package or notarization from `8079ec7`.

## 5 · Why notarization was NOT executed (correct restraint)

Executing the GitHub notarization path against `8079ec7` would require ALL of:
- **A push of 5 local commits** (S63–S68) to the remote — standing NEVER-PUSH hard gate; `8079ec7`
  is on no remote branch.
- **A `v*` tag** → the workflow **publishes a PUBLIC GitHub Release** (softprops attaches the dmg)
  + submits to **Apple's notarization service** with real credentials — public deploy + external
  effect + signing, all standing hard stops.
- …and it would **fail at Lint anyway** (§4), leaving a stray public tag/failed release.

The directive authorizes "use the notarization path," but does not explicitly authorize pushing
the unpushed chain or the public-release side effect, and the Lint gate makes a trigger futile.
**No push, no tag, no dispatch, no secret exposure.** This is the disciplined outcome, not a
capability gap.

## 6–7 · Notarization result / Gatekeeper / payload integrity / smoke

**NOT PERFORMED** — the notarized artifact does not exist (workflow not triggered, §5). No
submission ID, no staple, no Gatekeeper re-assessment on a notarized dmg. The S68 dmg's
Gatekeeper state remains `rejected / Unnotarized Developer ID` (measured S65). Payload integrity
is unchanged (asar `997f6f74…`, S68); no functional smoke was re-run (no new artifact to smoke).

## 8 · Windows Authenticode

**OPERATOR-BLOCKED.** `windows-release.yml` consumes `WIN_CSC_LINK`, but **no Windows signing
secret is configured** (`gh secret list` shows only `APPLE_*` + `DEPLOY_SSH_KEY`; no
`WIN_CSC_*`/cert). No certificate to sign with; none fabricated.

## 9 · Updater

**NOT OPERATOR-AUTHORIZED / GRAY.** The publish + updater-feed steps are gated on repo variable
`PUBLISH_TO_SITE == 'true'`, which is **not set (defaults off)**, and the feed host
`neuropause033.com` has no A record (S54/S56, PRIOR). No endpoint invented; nothing published.

## 10 · Classification

- **RED: 0** (no product defect).
- **YELLOW: 1** — the two frozen-surface `lint:release` errors block the release workflow's Lint
  gate; they are pre-existing/logged and FG-gate-bound, but they are now a **release blocker**,
  not just a hygiene note (upgraded from S67's YELLOW to a release-path blocker).
- **GRAY: 3** — updater (host dead + publish off) · SmartScreen · native-x64 (carried).
- **OPERATOR-BLOCKED: 2** — (a) push the clean S63–S68 chain + tag to trigger notarization
  (authorization for push + public release); (b) Windows Authenticode certificate secret.
- **POLICY-BLOCKED:** carried from S67 (SO approval, reversal residuals, deep Finance/HR, PO
  approve/send) — unchanged, out of S69 scope.

## Final decision

**MAC DISTRIBUTION TRUST = NOT GREEN** — credentials present (corrected), but blocked by the
frozen-path `lint:release` gate (FG-gate engineering) + the push/public-release authorization.
**WINDOWS DISTRIBUTION TRUST = NOT GREEN** — OPERATOR-BLOCKED (no Authenticode cert secret).
**UNRESTRICTED RELEASE = HOLD.** (GA is not claimed; notarization did not even run.)

## Exact unblock path (for the operator, in order)

1. **FG gate** to clear the two frozen-surface lint errors (`cst/sendTransition.negative.test.ts`
   unused import; `packages/shared/contracts.ts:2482` escape) so `lint:release` passes — the
   single engineering prerequisite; small, but must go through the frozen-surface change-control.
2. **Authorize the push** of the clean S63–S68 chain to `origin` so `8079ec7`+ is on GitHub.
3. **Tag `v1.0.0-rc.24`** at the clean commit (tag == package version, enforced by the workflow) →
   `macos-release` builds, signs, **notarizes**, and publishes the Release; then verify the Apple
   **submission ID + accepted status + staple + Gatekeeper accept** on the produced dmg.
4. **Windows:** configure `WIN_CSC_LINK` (+ password) with a real Authenticode cert, then the
   `windows-release` path.
5. Updater: rule mandatory-vs-optional and stand up a live feed host before setting
   `PUBLISH_TO_SITE`.
