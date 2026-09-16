# SEAM-B.12 / GATE-R.6 — CONTROLLED PRODUCTION BUILD ENVELOPE + PACKAGED ARTIFACT ACCEPTANCE

**Status: STOPPED AT §7, BY DESIGN — `PRODUCTION_BUILD_ENVELOPE_WAITING_FOR_ARMED_OUT_DECISION`.**
No build was run. No artifact was produced. Zero mutations beyond this document and the §1 update.
The complete §8 envelope was measured read-only and is READY-TO-EXECUTE the moment §8.1 is ruled.

## 1. Scope
Produce the actual production-equivalent packaged artifact from governed source and accept it through
the packaged runtime (§44 chain). B.8/B.9/B.10 not reopened; maturity carried verbatim (module E4 ·
composition E3 · runtime E3 · production E0 · production artifact E1 at HEAD).

## 2. Custody
HEAD_AT_START `b8c5f99` (the B.11 docs commit — the §2 expected continuation of `6515f3e`; no
CUSTODY_DRIFT) · branch `cert/data-import-cst-integration` · 1 worktree · staged 0 · no submodules ·
STATUS_AT_START: only the protected ` M certification/baseline.json` · KERNEL_HASH_AT_START
`293d056…` intact · verify-freeze: ANCESTRY OK · SOURCE FAIL (the standing classified baseline-lag
class) · versions: package `1.0.0-rc.20` · node v20.20.2 · npm 10.8.2 · electron 42.8.1 · electron-vite
2.3.0 · **electron-builder 26.15.3**. §11 source parity: **all 7 B.8/B.9/B.10 governed-file hashes OK**
(zero drift — packaging would package exactly the proven source). §0 honored: no build command was
executed at any point.

## 3. Operator build envelope — MEASURED STATE
Components 8.2–8.5 and the §9 firewall are fully measured (below). Component **8.1 is ABSENT**: this
gate's §7 lists four options (A CONSUME_ARMED_BUILD · B REARM_ARMED_BUILD_AFTER_PRODUCTION_BUILD ·
C DECLARE_ARMED_BUILD_EXPENDABLE · D DO_NOT_BUILD), forbids choosing silently, and mandates this STOP
when no option has been explicitly authorized. No prior directive authorized one (B.11's handoff posed
the same question; the B.12 directive re-poses it without answering). Per the constitution, silence is
not consent — Claude does not manufacture the ruling.

## 4. Armed-out decision (§7 / §8.1)
**OUT_ARMED = TRUE**, re-measured this sitting: `out/` = 87 files, newest `2026-08-20 22:18:48`,
`out/main/index.js` sha `ee5e8e99…` (= the committed ARCHITECTURE-MAPPING §8.4 record), ceremony seed
chunk `e2eSeed-NKS_iH8j.js` present. **Every packaging path rebuilds `out/` unconditionally**
(`electron-vite build` is hard-chained in all `package:*` scripts; the packager's input is
`files: out/**/*` + `"main": "./out/main/index.js"` — an alternate input dir is impossible without
config/main edits, which are forbidden inventions). **The four options, with measured notes — the
choice is the operator's:**
- **A CONSUME_ARMED_BUILD** — out/ becomes a plain release build; the 20-Aug ceremony build is gone; no
  re-arm scheduled. (Factual note: any future NP-000 ceremony resume would need a fresh seeded build at
  the then-current HEAD anyway — the armed build is already ~4 days/several gates stale.)
- **B REARM_AFTER** — package, then run `NP_E2E_BUILD=1 npx electron-vite build` as the LAST build.
  This restores the NP-008 PROPERTY (seed chunk present, seeded build last) but at CURRENT HEAD — a
  different artifact than the armed 472092c build; the original is not recoverable.
- **C DECLARE_EXPENDABLE** — rule the 20-Aug ceremony build superseded; build with no re-arm
  obligation; out/ remains a release build afterward.
- **D DO_NOT_BUILD** — the gate stays at B.11's verdict; production stays E0/E1.

## 5. Build command (§8.2) — READY
COMMAND_EXACT (canonical): `npm run package:mac` — expands to `generate-notices.cjs` →
`generate-build-info.cjs` → `electron-vite build` → `electron-builder --mac --arm64 --publish never` →
`verify:release`. WORKING_DIRECTORY `apps/desktop` · TARGET mac dmg+zip · ARCH arm64 · PUBLISH_MODE
`never` (hard-coded in the script). **Measured dist-protecting variant** (first-class, not an invented
config): run the same chain manually with
`npx electron-builder --mac --arm64 --publish never -c.directories.output=dist-seam-b12` and
`node scripts/verify-release-artifacts.cjs --dist dist-seam-b12` — dot-notation `-c.` overrides are a
documented electron-builder CLI mechanism (its own `--help` examples use them); the yml still applies
underneath; ONLY the output moves. This protects `dist/` completely; **it cannot protect `out/`** —
the input side is fixed.

## 6. Side-writes (§8.3) — ENUMERATED AND CLASSIFIED
- `out/` full overwrite — **PROTECTED pending §8.1 (effectively FORBIDDEN now)**.
- `dist/` (if the canonical output is used): **every mac output name of a rc.20 build ALREADY EXISTS —
  a build OVERWRITES the complete 15-Aug rc.20 mac set**, including the only copy of the version-less
  `NeuroPause-arm64.dmg` (the file the release workflow ships as the site's `NeuroPause.dmg`), its
  blockmaps, `beta-mac.yml`, `mac-arm64/`, `notarization-status.json`, and (local TTY)
  `builder-effective-config.yaml`. The repo's own precedent for preserving superseded artifacts:
  rename-version-less-and-archive into `dist/release-archive/`/`dist/pre-commit-archive/`. The
  `-c.directories.output=dist-seam-b12` variant avoids ALL dist/ collisions.
- `resources/build-info.json` — REQUIRED overwrite; the current file is the **stale 15-Aug rc.20 record
  (`commit: efe8196`)** whose provenance is preserved in this document and B.11's; git-ignored.
- Repo-root `THIRD-PARTY-NOTICES.md` — REQUIRED regeneration; **git-TRACKED** — may dirty the tree if
  the production dependency closure changed; classify at build time. `resources/` copy — git-ignored.
- `dist*/notarization-status.json` (afterSign hook, every mac build) — EXPECTED.
- Environment-side caches (electron-builder cache dirs) — outside the repo, EXPECTED.

## 7. Version provenance (§8.4) — MEASURED
- Dirty handling: **warn-only, never refuses** (zero `process.exit` in generate-build-info; the only
  non-zero exits in the chain are notices' missing-node_modules and verify-release's artifact failures).
  The tree is dirty by exactly the custody-protected `baseline.json`, which must NOT be cleaned —
  **the artifact will honestly stamp `commit: <sha>-dirty`** (the generator suffixes and warns). This
  is forced and truthful; the operator may note it or override provenance via the CI env variables.
- Version: `1.0.0-rc.20` is SPENT (a 15-Aug artifact set exists at `efe8196`). A HEAD build without a
  bump = same semantic version over different bits — permitted by the system, recorded as
  rebuilt-same-version if chosen; a bump is the operator's call (§18: no manufactured version).
  CHANGELOG HAS the rc.20 section (releaseNotes non-null); channel derives to `beta`.
- Provenance completeness: build-info carries source HEAD (short, `-dirty`-suffixed) + branch + dirty +
  buildTime + version + channel; **recorded omission: toolchain versions (electron-builder/
  electron-vite/node) are embedded nowhere**, and the Electron version appears only in the non-shipped
  `builder-effective-config.yaml`. Not fabricated; recorded.

## 8. Signing posture (§8.5/§38) — MEASURED
Local keychain holds **exactly one valid codesigning identity, a Developer ID Application certificate**
(name/team masked; hash matches the one notarize.cjs's own log excerpt cites).
`CSC_IDENTITY_AUTO_DISCOVERY` unset ⇒ auto-discovery ON (app-builder-lib source quoted) ⇒ a local
build **SIGNS with Developer ID**. Apple notarization credentials (APPLE_ID / APP_SPECIFIC_PASSWORD /
TEAM_ID) are UNSET ⇒ `notarize.cjs` **SKIPS with a status marker and the build continues** (not a tag
push, so failure would not be fatal either). All CSC_/GH_TOKEN env vars UNSET. Classification for the
authorized build: **SIGNED + NOT_NOTARIZED** — per §38 the strongest permissible label is *LOCALLY
EXECUTABLE PRODUCTION ARTIFACT, SIGNED_NOT_NOTARIZED*; NOT distribution-ready (notarization + Gatekeeper
untested). Missing-identity fallback (not our case) would be UNSIGNED-with-warn, never silent ad-hoc.
No credentials acquired, printed, or configured.

## 9. No-publish firewall (§9) — PROVEN IN SOURCE
`--publish never` present in every `package:*` script. app-builder-lib 26.15.3:
`isPublish = … && publishOptions.publish !== "never" && …` — **false unconditionally under `never`;
GH_TOKEN is never consulted** (and is UNSET). Every upload site is gated on `isPublish`. The yml
`publish:` block produces exactly two LOCAL writes: `app-update.yml` inside the app resources (feed URL
embed) and the `dist*/beta-mac.yml` feed file (written locally even under `never`; uploaded nowhere —
the release workflows copy it to the droplet manually and that publishing is gated OFF). Hooks: exactly
one (`afterSign: notarize.cjs`). LOCAL_ONLY · PUBLISH_NEVER · EXTERNAL_EFFECT = 0 — guaranteed by
construction for the authorized command.

## 10–12. Build execution / artifact inventory / fingerprint
**NOT EXECUTED — blocked at §8.1.** Placeholders deliberately absent (§85: nothing fabricated).

## 13. Release-strip for the packaged artifact (§15)
`verify-e2e-strip.sh` targets `out/` and **itself rebuilds out/** — unusable while the armed decision
is open, and it checks the electron-vite output, not the asar. **No packaged-content strip check
exists: NOT_AVAILABLE.** The acceptance run should therefore include a measured manual check (grep the
asar contents for `NEUROPAUSE_E2E_SEED_v1` / e2e chunk names / `journalPostTransition` markers) — a
measurement, not a new mechanism.

## 14–20. Packaged runtime tests (§20–§29)
**NOT EXECUTED** — they require the artifact. The B.10 harness pattern (fresh temp profile, real
renderer door, separate-process read-back) is ready to be pointed at the packaged app when it exists.

## 21–23. External effect / isolation
EXTERNAL_EFFECT = **0** this gate (nothing was built, launched, packaged, published, or uploaded).

## 24–25. Signing/notarization status
See §8 above: prospective SIGNED + NOT_NOTARIZED; nothing produced yet.

## 26. Known limits (§33/§34/§52 — carried unchanged)
Corrupt `journal-post-transitions.json` ⇒ app-fatal boot (KNOWN_BOOT_RESILIENCE_LIMIT,
NOT_A_B12_ACCEPTANCE_FIX) · success-branch comment drift · importer posted-row content mutation
(ACCEPTANCE_ADJACENT_IMMUTABILITY_DEBT) · CONCURRENCY_SCOPE = single-process event loop + unconditional
single-instance lock (never promoted to multi-process) · rc.20 artifact is pre-B.8 stale · no production
acceptance yet proven.

## 27. Public-claim quarantine (§46/§47 — carried unchanged)
AI Action Firewall story = Hitavada, PUBLIC_CLAIM ceiling (the Economic Times attribution stays
NOT_ESTABLISHED and is not resurrected) · PATENT_STATUS = PUBLICLY_REPORTED_APPLICATION_IN_PROCESS ·
LEGAL_NAME_CONFLICT_UNRESOLVED (Limited / Private Limited / third-party variants — not normalized).

## 28. First-broken-edge
**BUILD — specifically the §8.1 armed-out authorization.** Everything upstream is proven; everything
downstream (artifact content parity, packaged launch, packaged-door governance, packaged read-back,
restart, durable replay) is specified and waiting on the artifact.

## 29. Maturity
Unchanged: finance.journal.post module **E4** · composition **E3** · runtime **E3** · production **E0**;
production artifact **E1 at HEAD**. Nothing promoted without artifact evidence (§3/§37 honored).

## 30. Final verdict
**`PRODUCTION_BUILD_ENVELOPE_WAITING_FOR_ARMED_OUT_DECISION`** (§7's exact stop string; §50's nearest
mapping is PRODUCTION_BUILD_BLOCKED_BY_CUSTODY — custody is not violated, the authorization is absent).

## 31. Next single action
**The operator rules §8.1 with one unambiguous word: `PRESERVE` (=D, do not build) /
`CONSUME_AND_REARM` (=B) / `EXPENDABLE` (=A or C).** On B or C (or A), the ready envelope executes:
recommended shape = archive-or-override for dist/ (the `-c.directories.output=dist-seam-b12` variant
avoids all dist/ collisions), the canonical chain with `--publish never`, `-dirty` provenance accepted
as truthful, SIGNED+NOT_NOTARIZED posture accepted for a local acceptance artifact — then the §20–§29
packaged-runtime acceptance matrix on a fresh isolated profile, and (option B) the `NP_E2E_BUILD=1`
re-arm as the LAST build.

## Custody closure (§54)
HEAD_AT_END = HEAD_AT_START `b8c5f99` (this document + the §1 update commit follows) ·
STATUS unchanged but for the docs · FILES_CHANGED = docs only · COMMITS = 1 (docs) · PUSHES 0 ·
FETCHES 0 · EXTERNAL_EFFECT 0 · kernel + frozen surfaces untouched · armed `out/` byte-untouched
(87 files, newest 20 Aug 22:18:48, sha re-matched) · all 7 governed hashes OK at close.
