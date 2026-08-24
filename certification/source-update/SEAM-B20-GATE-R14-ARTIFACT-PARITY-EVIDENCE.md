# SEAM-B.20 / GATE-R.14 — ARTIFACT PARITY / GOVERNED BUILD ENVELOPE

**VERDICT: `ARTIFACT_PARITY_ESTABLISHED`**
**BUILD_COUNT = 1 (the one authorized build) · EXTERNAL_EFFECT = 0 · NETWORK_CALLS = 0 · no credential,
no browser, no consent, no token, no Graph call.**

## 1–8 · Identity and custody
Gate SEAM-B.20 / GATE-R.14 · 24 Aug 2026 · HEAD **`eccb5da`** (unchanged across the build) · branch
`cert/data-import-cst-integration` · baseline `CERT-40616b9` carried, not re-frozen · frozen surfaces
and `cst/` **untouched** (gate-detector PROCEED on both new paths before creating them) · NP-008
**ARMED throughout**.

**Pre-build custody record (immutable identities captured BEFORE anything ran):**
| Preserved artifact | Identity |
|---|---|
| armed `out/main/index.js` | sha256 `e40a47a2051b6e2e8aa90450c04a917c98d6a3189188455ed53cb0ebbb5f27d8`, 6,616,360 B, mtime `Aug 24 17:18:22`, 86 files, seed chunk present |
| B.13 `NeuroPause-arm64.dmg` | sha256 `d4d5802f9f77b1a486f5e3bf94de9f8be403620d289c7e7f68bcc333fc1e186c`, 135,529,165 B |
| B.13 `app.asar` | sha256 `4add8d3fcc0104bac83c7b2a54be4d800dfd72dfd18f8221934984dbb92bed2c`, 58,969,724 B |

**Post-build re-measurement: armed `out/` is byte-identical** — same sha256, same mtime, same 86 files.
Preservation was achieved structurally (the build never wrote to `out/`), not by copying and hoping.

## 9 · Pre-build measurements
Source at HEAD carries the B.18 partition; **no existing artifact did** (B.19's finding, re-confirmed
here by the verifier itself — see §26).

## 10–14 · Build envelope (the B.12 five points, answered)
**A · ARMED-OUT FATE: PRESERVED, untouched.** The build targeted an alternate output directory, so the
armed ceremony build was never a write target. It is not the new artifact and was not consumed.
**B · COMMAND (exact):** `env -u NP_E2E_BUILD npx electron-vite build --outDir "$PWD/out-seam-b20"`
run from `apps/desktop`. **`--publish` not used** (electron-builder was not invoked at all).
`NP_E2E_BUILD` explicitly unset ⇒ a plain release build.
**C · SIDE-WRITES:** exactly one new directory, `apps/desktop/out-seam-b20/{main,preload,renderer}`.
`out/` unchanged (proven above); `dist/` and `dist-seam-b13/` untouched; no packaging, no caches
written into the repo; nothing else appeared in `git status`.
**D · DIRTY TREE / VERSION PROVENANCE:** before and after the build the tree carried only the
pre-existing protected ` M certification/baseline.json` and the untracked artifact directories. HEAD
`eccb5da` before and after. No version metadata was generated or changed (`generate-build-info.cjs`
runs only in the `package:*` chains, which were not used).
**E · SIGNING POSTURE:** **no signing occurred** — electron-vite emits bundles; codesigning belongs to
electron-builder, which was not run. No signing authority, certificate, or secret was introduced.
**BUILD_COUNT: 0 → 1**, one controlled build, first attempt, exit 0 in 2.88 s. No exploratory rebuilds.

## 15–19 · The new artifact
| Field | Value |
|---|---|
| ARTIFACT_ID | `apps/desktop/out-seam-b20/main/index.js` (Electron main bundle) |
| ARTIFACT_SHA256 | `c357a426a2822e56dcb2f26a0cc91417dd0e01eda5b9fdaaa5f3ab1996412e00` |
| ARTIFACT_SIZE | 6,617,224 bytes |
| BUILD_TIMESTAMP | 2026-08-24T16:29:22Z (build window 16:29:19Z → 16:29:25Z) |
| SOURCE_COMMIT | `eccb5da` |
| BUILD_COMMAND | as in §10-B |
| e2e strip | `NEUROPAUSE_E2E_SEED_v1`, `e2eSeed`, `firstRealSendGuard`, `s16VerifyRun` = **0 each**; 0 chunks emitted — a clean release build |

## 20–21 · Source vs artifact scope measurement
Source (B.18): contacts profile 7 scopes; full profile set-equal to the historical 22.
Artifact: **measured by execution, not by reading** — see §25.

## 22–24 · Parity, forbidden absence, UI description
Verified by `apps/desktop/scripts/verify-m365-artifact-parity.cjs` (new, §7-compliant — justified in
its own header against the two existing verifiers: `verify-e2e-strip.sh` answers a different question
*and rebuilds `out/`*, which is unusable while an armed build must be preserved;
`verify-release-artifacts.cjs` checks packaged-file hashes against the update feed. Neither inspects
authority; this one does and **never builds anything**).

**Result against the new artifact: 13/13 predicates PASS.**
`P1` exists · `P2` identity (sha/size/mtime) · `P3` profile implementation present
(`NEUROPAUSE_M365_SCOPE_PROFILE`, `m365ScopesForProfile`, `M365_SCOPE_SETS`) ·
`P3b` extract-and-execute · **`P4` contacts profile EXACTLY 7: `openid profile email offline_access
User.Read Contacts.Read Contacts.ReadWrite`** · **`P5` all 15 forbidden scopes absent** (the forbidden
set is *derived* from the historical set minus the profile, not remembered) · `P6` contacts ∩ {mail,
files, calendar, directory, teams} = ∅ · **`P8` full profile 22, set-equal to the historical surface** ·
`P8b` fail-safe resolution (unset → full, unknown → full, contacts → contacts — B.18's deliberate
choice, unchanged) · **`P7` UI authority parity: 22 described, 0 contacts-profile scopes undescribed,
0 described-but-never-requested** (both directions) · `P9` no secret material · `P10` redirect
preserved (`loopbackPort 42817` + `/callback`) · `P11` delegated-only (no `.default`, entra
`clientSecretEnv: null`).

## 25 · Behavioural artifact test (§8/§9 layers) — and why a grep would not have done
The bundle proved **not minified**: emitted declarations and functions survive with their identifiers.
The verifier therefore **extracts the emitted `M365_*_SCOPES` declarations and the compiled
`m365ScopesForProfile` / `resolveM365ScopeProfile` functions out of the artifact and executes them in
an isolated `node:vm` context with no `require`, no `process`, no filesystem, no network and no
electron** — the scope sets above are the artifact's own compiled logic *running*, not text that
happens to appear in it. This directly answers B.19's lesson: an artifact that contained **zero**
occurrences of the identifiers still carried the old flat surface, so string presence alone would never
have been a proof.

**Layer coverage, stated honestly:** L1 source grep ✓ · L2 build-output inspection ✓ · **L3 packaged
asar — N/A for this artifact** (no packaging was authorized or performed; the B.13 asar was measured
only as a negative control) · L4 compiled authority extraction ✓ · L5 behavioural invocation of the
built module's logic ✓ (module-scope logic only; the full bundle is an Electron main entry and was
**not** launched — no runtime claim is made) · L6 negative authority boundary ✓ (P5/P6 plus §26).

## 26 · The verifier is load-bearing (mutation-style proof)
The same script run against the two pre-B.18 artifacts **FAILS at P3, exit 1** in both cases:
armed `out/main/index.js` (`e40a47a2…`) and the B.13 `app.asar` (`4add8d3f…`) — *"absent:
NEUROPAUSE_M365_SCOPE_PROFILE, m365ScopesForProfile, M365_SCOPE_SETS … the artifact does not contain
the narrow-profile implementation — it predates it."* A check that passes on everything proves nothing;
this one distinguishes the artifacts.
**Instrument note (§2 #24, self-caught):** my first invocation of the asar check piped through `tail`,
so the reported `EXIT=0` was `tail`'s status, not the script's. Re-measured without the pipe:
**TRUE_EXIT = 1**. The finding was unaffected; the measurement command was wrong and is corrected here
rather than left in the record.

## 27–28 · Network and external effect
`NETWORK_CALLS = 0` — the build is local and the verifier opens one file and computes; neither contacts
`login.microsoftonline.com`, `graph.microsoft.com`, nor any other host. No browser, no credential, no
consent, no token. **EXTERNAL_EFFECT = 0.**

## 29–32 · Suites, typecheck, lint, secrets, hashes
Executor boundary regression (B.19 pins) + scope-profile pins: **17/17 green, unweakened**.
**Full main suite: 896 files / 9354 passed / 7 skipped — identical to the B.19 baseline** (this gate
added no test file; the new code is a certification script, deliberately outside the suite).
`tsc --noEmit -p tsconfig.node.json` clean. Lint: 0 errors (the verifier lives in `scripts/`, which is
eslint-ignored exactly like the existing `.cjs` harnesses). Secret scan: no credential material — none
exists to leak, since none was obtained. **Governed hashes 7/7.**

## 33 · Artifact custody result
New artifact retained on disk, untracked (the `dist-seam-b13` precedent), with its identity recorded
here. The armed `out/` and the B.13 package remain byte-identical and recoverable.

## 34–36 · Deviations, contradictions, corrections
**Deviation (stated, not silent):** the directive's §7 suggested
`certification/source-update/verify-m365-artifact-parity.sh`. The verifier was instead placed at
`apps/desktop/scripts/verify-m365-artifact-parity.cjs`, beside the repository's two existing artifact
verifiers, and written in Node because the measurement requires executing extracted code in a VM
sandbox — a shell script could only grep, which §8 explicitly says is insufficient.
`certification/source-update/` holds evidence documents, not tooling.
**Contradiction:** none. Every B.19 measurement re-confirmed (including the absent-artifact finding,
now demonstrated by the verifier's own failure on those artifacts).
**Correction:** the `tail` instrument artifact in §26.
**Absent primitives preserved:** `EvidenceEnvelope`, `MicroTrace`, `NeuroChain`, `permitId` remain
absent; nothing was manufactured, and no second audit ledger was created.
**Process note (§18):** a recon fleet was launched for the existing-tooling question and the emitted-
surface question. **At the time of writing it was still IN_FLIGHT** — recorded as in-flight, not as a
result, and **not incorporated**; both questions were answered first-hand (the two verifier scripts were
read directly, and the emitted bundle was inspected directly). If it lands and contradicts anything
here, the correction belongs in the register.

**RECONCILED (§18, applied immediately on completion). No contradictions — it corroborated every
judgment, in three independent ways:**
1. **New script justified**, with a sharper articulation than mine: `verify-e2e-strip.sh` is *text but
   rebuilds*; `verify-release-artifacts.cjs` is *no-build but content-blind by construction* (its only
   content check is feed-digest ≡ file-digest — tamper detection, never semantic parity). The needed
   check — read-only text measurement of an existing artifact — is the intersection **neither**
   occupies.
2. **Minification is OFF for the main process by bundler default** (`minify: false` in electron-vite
   2.3.0's main preset), which is *why* the identifiers survived — my finding was empirical, this is
   the mechanism behind it.
3. **It independently recommended the harness design I had already built** — "extract the compiled text
   and evaluate it — FEASIBLE, LOWEST RISK, RECOMMENDED" — and explained why the alternative
   (`node:vm` + stubbed `require`) is *not* acceptable: the release bundle exports nothing, so reaching
   the logic would mean executing the whole entry against a faked Electron surface (208 `electron.app.*`
   references, module-scope side effects, background services starting), converting a read-only
   measurement into **an uncontrolled partial launch**. It cites the same contiguous block this
   verifier extracts (`out-seam-b20/main/index.js:62699-62728`).
4. It re-verified the four absent primitives at HEAD with counts: **0 code occurrences each**, every
   tracked mention being documentation that records their absence.

**One non-blocking improvement recorded, deliberately NOT acted on (scope discipline):** the recon notes
that `verify-release-artifacts.cjs` uses an *injectable-IO + exported-pure-function +
`require.main === module`* shape, which makes a verifier unit-testable by the suite. This verifier is a
straight CLI and is therefore not covered by the test suite — a durability gap, not a correctness one.
Refactoring it belongs in a later gate, not in a closed one.

## 37 · Maturity impact
**`COHORT_API_EFFECT` remains NOT_VERIFIED** — nothing live happened. Improved: **artifact assurance**
(source authority → governed build → measured executable). Unchanged: module E4 · composition E3 ·
runtime E3 · packaged runtime E3 · production acceptance E3 · distribution E0. **This seam proves
artifact correctness, not provider effect**, and it does not clear the credential gate.
Also carried unchanged: product verification remains wired for `mail.send` only
(`NOT_PRODUCTION_WIRED` for contacts); the ceremony read-back stays on the product's implemented list
path (no get-by-id was added).

## 38 · First broken edge
**ARTIFACT → CREDENTIAL.** The artifact now exists and is measured; the next unproven edge is the
credential/consent gate, which is human-owned.

## 39 · Next single action
**GATE 1 — the operator establishes the narrow Entra app registration and consent**, launching the app
from the **measured artifact** (`out-seam-b20`, sha256 `c357a426…`) with
`NEUROPAUSE_M365_SCOPE_PROFILE=contacts`, and **aborting if the consent screen shows anything beyond
the seven scopes**. GATE 2 (execution authorization) remains separate and comes after.
