# SESSION 71 — CONTROLLED GITHUB RELEASE + APPLE NOTARIZATION EXECUTION

## Executive result

**The clean S63–S70 lineage was pushed and the macOS release workflow was executed under explicit
operator authorization. The result is honest and precise: the S70 lint gate is PROVEN cleared in
CI, Developer-ID code signing SUCCEEDED, but Apple notarization FAILED with `HTTP 401 Invalid
credentials`, so the workflow correctly fail-closed and published NOTHING.** This sharpens the
S69 finding one more turn: the Apple secrets are not merely *present* — the *signing* pair is
*valid* (it signed the app), but the *notarization* credentials are *invalid* (401). "Present" ≠
"valid". **MAC DISTRIBUTION TRUST = NOT GREEN**, blocked solely on the notarization credential —
an operator secret fix, not any code, workflow, or signing defect. No un-notarized artifact was
published; no secret value was printed, decoded, or copied.

## 1 · Custody / ancestry (verified before push)

- Source SHA (S70, certified clean): **`11a82cd`** — S70 child of `36332ca` (S69); S63–S70 linear,
  zero merges, all descending from remote base `fb8f320`.
- Production (non-test) source across `fb8f320..11a82cd` = exactly two files: `moduleRegistry.ts`
  (S64 delete-guard) + `contracts.ts` (S70 escape fix). No unexpected changes.
- `baseline.json` custody-protected: unstaged, never pushed (a push transmits only committed
  objects; the working-tree modification stayed local).

## 2 · Push (authorized)

- Explicit operator authorization obtained in-session ("Push + tag (full S71)") — NOT inferred from
  the prompt.
- `git push origin cert/data-import-cst-integration`: **`fb8f320..11a82cd` fast-forward, EXIT 0**,
  no `--force`, no history rewrite.
- **Remote SHA verified = `11a82cd`** (live `ls-remote`) = local HEAD. 9 commits (S63–S70) now on
  the remote.

## 3 · Tag (authorized)

- Version = `1.0.0-rc.24` (root + `apps/desktop`); workflow enforces `tag == apps/desktop version`.
- No `v1.0.0-rc.24` existed (local or remote) — no collision.
- **Tag `v1.0.0-rc.24`** (annotated object `f764b73`) → commit **`11a82cd`**, pushed EXIT 0.
- Tag on remote confirmed: `f764b73  refs/tags/v1.0.0-rc.24`.

## 4 · Workflow run

- **`macos-release.yml` run ID `33753118232`** (event=push, sha `11a82cd`, `macos-latest`).
- Prior rc.19/rc.20 runs (2026-08-15) failed at **Lint**; this is the first run carrying the S70
  fix.

## 5 · Per-step evidence (measured from run logs)

| # | Step | Result | Evidence |
|---|---|---|---|
| — | Verify tag matches package version | **success** | `v1.0.0-rc.24` == `1.0.0-rc.24` |
| — | Install dependencies | success | |
| — | Typecheck | **success** | |
| **1** | **Release Lint** | **✅ SUCCESS** | **The exact step that killed every prior run now passes — S70 objective PROVEN in CI.** |
| — | Test | success | |
| **2** | **Package macOS** | **❌ FAILURE (at notarization)** | electron-vite build + electron-builder ran; failed in the `afterSign` notarize hook. |
| **3** | **Developer-ID signing** | **✅ SUCCESS** | `signing file=dist/mac-arm64/NeuroPause.app platform=darwin type=distribution identityName="Developer ID Application: Dishant Dobariya (***)" identityHash=5D6C38F1539107F7649513683B7E413741F8949F provisioningProfile=none`. The `APPLE_CSC_LINK`/`APPLE_CSC_KEY_PASSWORD` secrets are **valid**. |
| **4** | **Hardened runtime** | **✅ CONFIGURED** | `electron-builder.yml` mac: `hardenedRuntime: true` + `entitlements: resources/entitlements.mac.plist`; the signed app is type=distribution (hardened). |
| **5** | **Apple notarization submission** | **❌ REJECTED AT AUTH** | `notarize.cjs` → `@electron/notarize` notarytool: `[notarize] FAILED after 18s … HTTP status code: 401. Invalid credentials. Username or password is incorrect.` **No submission was accepted; no submission ID was issued.** |
| **6** | **Apple notarization ACCEPTED** | **❌ NO** | 401 invalid credentials — the `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` notarization auth is wrong/expired/malformed (Apple hint: app-specific password must be current + dash-formatted, Apple ID enrolled in the Developer Program, Team ID correct). |
| **7** | **Stapling** | **NOT REACHED** | requires an accepted notarization. |
| **8** | **Gatekeeper acceptance** | **NOT REACHED** | no notarized artifact exists. |
| **9** | **Published release artifact** | **NONE (correct)** | The workflow **fail-closed**: `[notarize] FAILING THE BUILD — A published release must be notarized.` Verify/Upload/Publish/GitHub-Release steps **skipped**. `gh release view v1.0.0-rc.24` → **release not found**; newest release remains rc.17. The tag exists but carries **no release** (tag ≠ release). |

## 6 · Payload provenance (directive)

- **NOT REACHED / not verifiable this run.** The Package step failed at notarization *after* signing
  but *before* artifact retention (`Upload build artifacts` skipped), so no dmg/asar was published
  or retained from the runner; there are no CI bytes to hash.
- **Expected relationship, recorded for the next successful build:** a build from `11a82cd` will
  produce an asar equal to the S68/S70 certified `997f6f74…d22479` **plus exactly the S70
  `contracts.ts` one-character escape normalization** (`\/`→`/`, semantics-proven identical over
  12,288 codepoints), since that contract is bundled. That is an *explained, certified* difference —
  the byte-identity expectation must be updated to "997f6f74 + the S70 one-char fix", not treated as
  unexplained drift. Verifiable only once notarization passes and an artifact is retained.

## 7 · Mac smoke

**NOT REACHED** — no published/notarized artifact to download and launch. Onboarding → reversal →
procurement → restart smoke is deferred to a successful notarized build. (The packaged runtime for
this exact ERP state was already accepted on rc.24 in S64/S68 by asar byte-identity; this session
adds the *distribution-trust* dimension, which is where it stopped.)

## 8 · Windows (reported separately, not blocking Apple)

- **Windows Authenticode = OPERATOR-BLOCKED (unchanged).** No `WIN_CSC_*` secret is configured;
  `windows-release.yml` was not triggered this session (mac-only tag path exercised). Windows
  signing remains blocked on an Authenticode certificate secret.

## 9 · Updater (kept separate; not invented, not activated)

- The `Publish installer/update feed to neuropause033.com` steps were **skipped** (gated; and the
  run failed before them). No endpoint was invented or activated. `neuropause033.com` remains an
  unproven feed host (S54/S56). **Updater = GRAY**, unchanged.

## 10 · Classification

- **RED: 0** — no product/code defect. Lint, typecheck, test, build, and signing all succeeded; the
  block is an external Apple credential, not code.
- **YELLOW: 0 new** — the S69 release-lint YELLOW is **RESOLVED** (cleared in CI, step 1).
- **GRAY: 3** — updater (dead host + publish gated) · Windows SmartScreen · native Windows x64
  (carried).
- **OPERATOR-BLOCKED: 2**
  1. **Apple NOTARIZATION credentials invalid (401)** — regenerate/repair the GitHub Secrets
     `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` (and confirm `APPLE_TEAM_ID`): a current
     app-specific password (dash-formatted) for an Apple ID enrolled in the Developer Program, Team
     ID matching the signing cert `J3G89MY3QG`. **The SIGNING secrets are valid and need no change.**
  2. **Windows Authenticode certificate secret** absent (`WIN_CSC_LINK`).
- **POLICY-BLOCKED:** carried from S67 (SO approval · cleared-reversal/partial-notes/reopen-paid ·
  deep Finance/HR authority · PO approve/send) — out of S71 scope, untouched.

## 11 · Final decision

- **MAC DISTRIBUTION TRUST = NOT GREEN** — Apple notarization was not accepted (401). Per the
  directive, MAC PILOT DISTRIBUTION TRUST is therefore also NOT GREEN this run.
- **But the gate moved materially:** engineering + lint + Developer-ID signing + hardened runtime
  are all GREEN in CI, and the workflow's fail-closed publish gate is proven working. The **sole
  remaining macOS blocker is the notarization credential** — an operator secret fix, after which the
  release can be re-run with **no code, tag, or workflow change**.
- **GA is NOT claimed** (notarization did not even succeed; Windows + updater + business-policy
  blockers remain independent).

## 12 · Exact retry path (operator, after fixing the secret)

1. In GitHub → Settings → Secrets, update `APPLE_APP_SPECIFIC_PASSWORD` (and `APPLE_ID` /
   `APPLE_TEAM_ID` if wrong) with valid notarization credentials. **Do not touch the working
   `APPLE_CSC_*` signing secrets.**
2. **Re-run the existing run — no new tag needed:** `gh run rerun 33753118232` (re-executes from the
   `v1.0.0-rc.24` tag ref with the corrected secrets). The tag is already at the certified clean
   `11a82cd`.
3. On success: verify notarization submission ID + ACCEPTED + staple + Gatekeeper `accepted`, then
   the payload-provenance asar check (§6) and the packaged Mac smoke (§7).

Nothing further was pushed this session beyond the authorized chain + tag. This certification is
committed locally only (no additional push authorized).
