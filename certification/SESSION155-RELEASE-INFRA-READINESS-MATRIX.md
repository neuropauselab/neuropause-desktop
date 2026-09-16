# SESSION 155 — RELEASE INFRASTRUCTURE + FEED PUBLICATION READINESS (discovery-only)
### Date: 2026-09-06 · Branch: cert/data-import-cst-integration · HEAD 4bc0e37 · DOCS-ONLY (zero source, zero frozen)
### Verdict: **RELEASE-INFRASTRUCTURE PARTIALLY READY** — engineering-complete; publication is operator-certification-pending (secrets + tag + host). No engineering defect. Nothing simulated.

---

## A · Environment ground truth
- HEAD `4bc0e37`, branch `cert/data-import-cst-integration`; tracked tree clean except pre-existing
  `certification/baseline.json` (M) + untracked stray docs (carried from prior sessions; none is source).
- Execution host: Linux/aarch64 (S152/S153) — cannot build/sign a mac or win artifact, cannot read GitHub
  secrets, cannot reach the droplet. Every OS/host/secret fact below is therefore evidenced from repository
  configuration, and credential *values* are never read.
- Version: `apps/desktop/package.json` = **`1.0.0-rc.25`** (source = the N+1 candidate);
  `resources/build-info.json` records the last actually-built artifact = **`1.0.0-rc.24`** (N), channel `beta`,
  commit `8079ec7`, buildTime 2026-09-03.

## B · Release pipeline (canonical, single — no parallel scripts)
`SOURCE → VERSION → BUILD → SIGN → PACKAGE → FEED METADATA → ARTIFACT STORAGE → HTTPS HOST → UPDATE DISCOVERY`
each has one canonical implementation:
- VERSION: `package.json` version + `scripts/generate-build-info.cjs` → `resources/build-info.json`.
- BUILD/PACKAGE: `npm run package:mac` / `package:win` (`electron-vite build` + `electron-builder`,
  `--publish never`).
- SIGN: electron-builder env-driven (mac `CSC_LINK`/`CSC_KEY_PASSWORD`; win `WIN_CSC_LINK`/
  `WIN_CSC_KEY_PASSWORD`); notarize afterSign hook `scripts/notarize.cjs`.
- FEED METADATA: emitted by electron-builder as `beta-mac.yml` (mac) / `beta.yml` (win) per
  `electron-builder.yml publish{ provider: generic, url: https://neuropause033.com/updates, channel: beta }`.
- VERIFY: `scripts/verify-release-artifacts.cjs` (see §D) runs BEFORE publish.
- STORAGE/HOST: `.github/workflows/{macos,windows}-release.yml` `scp` to
  `root@64.227.128.218:/opt/neuropause-site/website/updates/` (feed + payloads + blockmap) and `/downloads/`
  (installer), served at `https://neuropause033.com/updates`.
- DISCOVERY: electron-updater in the app reads the baked feed URL (S154 — engineered, security-sound).

## C · Feed hosting
Deployment IS configured in the release workflows (not just the app):
- Host: droplet `64.227.128.218`; document root `/opt/neuropause-site/website/updates`; served at
  `https://neuropause033.com/updates`.
- Method: `scp` over SSH using `secrets.DEPLOY_SSH_KEY`, gated by `vars.PUBLISH_TO_SITE == 'true'` +
  `env.HAS_DEPLOY_KEY == 'true'` + a tag push (`refs/tags/…`).
- Feed handling: `scp apps/desktop/dist/beta*.yml … *-mac.zip … *.blockmap` (mac) / `beta*.yml + NeuroPause-Setup.exe + *.blockmap` (win); the workflow comments describe aliasing `beta*.yml → latest*.yml` so the
  `stable` channel resolves, and a trailing HTTPS `curl` proving `/updates/` is reachable.
- **Reachability (measured S154, sanctioned web_fetch): `/updates/beta-mac.yml`, `/updates/beta.yml`, and the
  base host all returned EMPTY — the host is NOT demonstrably serving a published feed today (B).**
- **Recorded observation (not a defect to fix without authorization):** the feed-publish step is
  `continue-on-error: true`, so a failed feed upload does not fail the release — the operator must confirm the
  feed actually published (the HTTPS curl check mitigates but the step can still be skipped/soft-fail).

## D · Release artifact contract (verify:release binding)
`verify-release-artifacts.cjs` parses the feed yml (`version`, `path`, top-level `sha512`, and each
`files:[{url, sha512, size}]`), recomputes the file's **base64 sha512**, and FAILS on: a missing installer, a
missing update payload, a missing channel feed, or a feed digest/size that does not match the file on disk.
Required set:
- **macOS:** `beta-mac.yml` (feed) · `NeuroPause-arm64.dmg` (installer) · `*-mac.zip` (update payload) ·
  `*.blockmap`.
- **Windows:** `beta.yml` (feed) · `NeuroPause-Setup.exe` (nsis installer) · `*.zip` (payload) ·
  portable `.exe` · `*.blockmap`.
Binding proven present in source; not exercised on real artifacts here (none exist).

## E · macOS signing readiness
- Developer ID signing: CI wired (`APPLE_CSC_LINK`→`CSC_LINK`; else `CSC_IDENTITY_AUTO_DISCOVERY=false`).
  Cert/secret presence in GitHub: **UNKNOWN** (not readable here).
- Notarization: `notarize.cjs` afterSign; expects `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID`.
  Presence: **UNKNOWN**.
- Real signing/notarization requires a `macos-latest` runner with the secrets set (S152 = YELLOW/B).

## F · Windows signing readiness
- Authenticode: CI wired (`WIN_CSC_LINK`→`WIN_CSC_LINK`; `WIN_CSC_KEY_PASSWORD`). Presence: **UNKNOWN**.
- Timestamp/cert config: electron-builder default; no explicit timestamp URL override observed.
- Requires a `windows-latest` runner with the cert secret set (S153 = YELLOW/B). SmartScreen reputation is a
  separate post-publish accrual (never claimed from signing).

## G · Deployment readiness
- SSH deploy key: `secrets.DEPLOY_SSH_KEY` referenced; `HAS_DEPLOY_KEY` job-env boolean gate. Presence:
  **UNKNOWN**. Publish additionally requires `vars.PUBLISH_TO_SITE == 'true'` (a repo variable) — presence
  **UNKNOWN**.
- Host `64.227.128.218` / `/opt/neuropause-site/website/updates`: not reachable from here (B).

## H · Version / release readiness
- Scheme (existing, not invented): `1.0.0-rc.N`, channel `beta` (stable→latest / beta / internal).
- **Minimum legitimate N→N+1 sequence:** N = `1.0.0-rc.24` (last built) — build+sign+publish; install N;
  N+1 = `1.0.0-rc.25` (current source) — bump if needed, build+sign+publish; in-app update N→N+1; verify.
  (Both are real repo versions; no fabricated version introduced.)

## I · Rollback policy — DECISION MEMO (operator chooses; not selected here)
Existing behavior: `rollbackTarget()` names a known-good prior version from accrued history, while
`allowDowngrade=false` prevents any automatic downgrade. Two choices, exactly:
- **A. Keep roll-forward + operator/feed-driven recovery** (current). Recovery = re-publish/re-install the
  prior signed artifact; the app already surfaces the target. Zero code.
- **B. Authorize a future automatic in-app downgrade capability.** Would be a scoped engineering slice
  (enable + gate a controlled downgrade path) — NOT implemented without explicit authorization.
Recommendation stance: none — this is the operator's decision.

## J · Security
Updater + release security is source-verified sound (S154 + this session): HTTPS feed; base64-sha512
feed↔artifact binding enforced pre-publish; `allowDowngrade=false`; `autoDownload=false`/
`autoInstallOnAppQuit=false`; channel coerced to a fixed enum; no renderer-controlled feed URL; RBAC
`cloud:operate`/`operations:read`; deploy secret held only in the step that needs it (job-env exposes just a
boolean); `--publish never` on local builds (no accidental publish). No insecure fallback introduced.

## K · Exact blockers (all B / GRAY — none A)
1. GitHub secrets actually set: `APPLE_*`, `APPLE_CSC_*`, `WIN_CSC_*`, `DEPLOY_SSH_KEY` — **UNKNOWN** (GRAY).
2. Repo variable `PUBLISH_TO_SITE == 'true'` — **UNKNOWN** (GRAY).
3. A tag push (`v1.0.0-rc.25`) to trigger build+publish — **operator action** (B).
4. Signing-capable runners exercised (macos-latest / windows-latest) with real certs — **B** (S152/S153).
5. Host `neuropause033.com/updates` actually serving the published feed — **B** (S154 empty).

## Final readiness matrix
| Item | Status | Evidence |
|---|---|---|
| A Environment | GREEN (measured) | HEAD/branch/version read; Linux/aarch64 host |
| B Release pipeline | **GREEN (engineering-complete)** | canonical package:mac/win + verify:release + CI publish, single impl |
| C Feed hosting config | **GREEN (configured)** / feed live **YELLOW** | scp deploy wired; host not serving today (S154) |
| D Artifact contract / verify:release | **GREEN (source-verified)** | sha512 feed↔artifact binding + missing-file failure |
| E macOS signing | **YELLOW** (wired) / secrets **GRAY** | CI env-driven; presence unknown; needs mac runner |
| F Windows signing | **YELLOW** (wired) / secrets **GRAY** | CI env-driven; presence unknown; needs win runner |
| G Deployment | **YELLOW** (wired) / secrets+var **GRAY** | scp + DEPLOY_SSH_KEY + PUBLISH_TO_SITE gates |
| H Version/release | **GREEN** | rc.25 (N+1) over rc.24 (N), channel beta; scheme exists |
| I Rollback policy | **GREEN (documented)** — decision **PENDING (C)** | roll-forward + rollbackTarget(); memo above |
| J Security | **GREEN (source-verified)** | HTTPS/sha512/no-downgrade/no-silent/no-renderer-URL/RBAC |
| K Blockers | **YELLOW/GRAY** | secrets/var presence unknown; tag+runner+host operator actions |
| — Engineering defect | **none (not RED)** | no release-infra defect found; no source change |

## Separation
- **ENGINEERING-COMPLETE:** release pipeline, feed metadata + integrity binding, signing/notarization
  automation, deploy automation, updater client + security, versioning scheme, rollback preparation. (No code
  change needed; none made.)
- **OPERATOR-CERTIFICATION-PENDING:** set/confirm the GitHub secrets + `PUBLISH_TO_SITE` var; run the
  signing-capable release on real runners; confirm the host serves `/updates/`; execute the real
  macOS/Windows RC (S152/S153) and the live N→N+1→rollback (S154); rule the rollback policy (I).

## Final verdict + next operator action
**RELEASE-INFRASTRUCTURE PARTIALLY READY.** The pipeline is engineering-complete and security-sound; the only
things standing between it and a live trusted release are operator-held credentials, one repo variable, a tag
push on signing-capable runners, and the host actually serving the feed — all category B/GRAY, none an
engineering defect.

**Exact next operator action (single next gate):** in GitHub → set repo variable `PUBLISH_TO_SITE=true` and
confirm secrets `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `APPLE_CSC_LINK`,
`APPLE_CSC_KEY_PASSWORD`, `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`, `DEPLOY_SSH_KEY` are present; then push tag
`v1.0.0-rc.25`. The macos/windows release workflows build → sign → `verify:release` → `scp` to
`/opt/neuropause-site/website/updates` → HTTPS-reachability check. Confirm
`https://neuropause033.com/updates/beta-mac.yml` returns the feed, then proceed to S152/S153 install
certification and the S154 N→N+1 run.

**No source modified. No frozen surface touched. No feature work. No fabricated feed/artifact/hash/signature.
No macOS/Windows/GA claim. Credential values never read; presence reported PRESENT/ABSENT/UNKNOWN only.**
