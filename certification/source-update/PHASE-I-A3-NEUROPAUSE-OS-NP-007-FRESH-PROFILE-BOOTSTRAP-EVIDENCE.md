# NP-007 · FRESH-PROFILE APP-PRINCIPAL BOOTSTRAP RECONCILIATION · EVIDENCE
## The first reproduction-memory-SHAPED artifact (a DOCUMENT only — the experience-memory arc stays NOT ENTERED)

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

**Status: TEST-VERIFIED, V1–V5 all green. Bounded divergence repair under the operator's NP-007 gate (19 Aug 2026).
NP-000 (the ceremony) was SUSPENDED at step 1 throughout — safety HELD, authority never exercised. ZERO real contact.
No frozen surface touched (authService.ts read only). The strip keeps its meaning (PASS re-proven).**

## The ExperienceRecord shape
- **CONTEXT:** NP-000 S5.4 ceremony, step 1 pre-flight — first launch of app-principal mode on the fresh isolated
  `NeuroPause-S54` profile, e2e build at HEAD, flags `NEUROPAUSE_S15_APPPRINCIPAL=1 NEUROPAUSE_FIRST_REAL_SEND=1`.
- **STATE (at failure):** fresh profile; no stored session; S17 local-first present in the build (landed after S15's
  live run — the two had never been exercised together on a fresh profile).
- **SEQUENCE (timestamped from the operator's terminal):**
  `16:32:38.987 Entering device-local mode` (restoreSession → no stored token → enterLocalMode, unconditional) →
  `16:32:39.020 Owner bound to the active principal { local: true }` (enterprise bootstrap inside runtime init claims
  the org owner row for the LOCAL principal) →
  `16:32:39.448 [NEUROPAUSE_E2E_SEED_v1] installing seeds — mode=app-principal` (the seed swaps the session to the app
  principal — AFTER the owner row is claimed).
- **FAILURE:** permanent `not_a_member` on every org-scoped channel — Connector Center unloadable
  (`connectors:list` refused), routing-choice save refused (`ai:preference.set`) — the ceremony rail unreachable.
- **PREDICATE (W-7, verbatim):** `reason: 'not_a_member', sessionEmailShape: '3@example.com',
  activeWorkspaceId: 'workspace-default', workspaceFound: true, workspaceOrgId: 'org-default', organizationFound:
  true, organizationOperable: true, memberCount: 28, humanMembersWithEmail: 1, sessionMatchedAMember: false,
  ownerExists: true, ownerClaimed: true, ownerOrgMatches: true, ownerEmailShape: '42@device.invalid',
  sessionMatchesOwner: false, memberStatus: null, memberInWorkspace: null`
- **ENVIRONMENT:** fresh `--user-data-dir` (the ceremony environment). The Phase-0 harnesses had launched WITHOUT
  `--user-data-dir` — the default dev profile's pre-existing org state masked this path entirely.
- **EXPECTED PATH:** app principal established → enterprise binds the owner to it → `sessionMatchesOwner: true` →
  tenancy resolves → Connector Center loads (how S15 behaved, pre-S17).
- **ACTUAL PATH:** local principal wins the owner-row race; owner email is immutable (O-13, correctly untouched);
  the later-seeded session can never match → fail-closed forever on that profile.
- **SAFETY RESULT: FAIL-CLOSED.** No external effect · no OAuth exercised in-app (`accounts: 0`) · FG-4 latch never
  written · no expiry started. The failed profile is EVIDENCE — archived per §4, never deleted; logs preserved at
  `~/Desktop/S54-divergence-logs-2026-08-19`.

## The verification ladder (binding; each rung RUN, none inferred)
- **V1 · REPRODUCED FIRST** (`e2e/freshProfileBootstrap.e2e.cjs`, `FRESH_BOOT_EXPECT=broken`, CURRENT build, fresh
  temp profile): **PASS 5/5** — seed armed · local-owner claim before the seed · `not_a_member` fired · the W-7
  predicate matched (session≠member, owner `@device.invalid`, session≠owner) · `connectors:list` refused. The
  ordering hypothesis was confirmed as the mechanism BEFORE any code change. (V3 plain-mode baseline also run
  pre-change: PASS 4/4.)
- **V2 · SMALLEST CORRECTION** (both files pre-flight classified; the e2e module under the granted gate):
  - `e2e/e2eSeed.ts` — split: NEW `installE2eSeedPrincipal(mode)` (profile-isolation HARD-FAIL checked EARLY + the
    app-principal seeding, both modes); `installE2eSeeds(mode)` keeps only the LATE seams (mock Graph + fake account,
    which need the initialized runtime) and no longer seeds the principal. Same compile gate, flags, and sentinel.
  - `main/index.ts` — mode resolution + the principal seed moved BETWEEN `authService.restoreSession()` and
    `initRuntimeCore()` (after local entry so nothing stomps it; before the bootstrap so the owner binds to the app
    principal); HARD-FAIL semantics preserved (invalid coupling exits before init); the late block reuses the resolved
    mode and keeps the title stamp. No architectural change; no frozen touch; typecheck + lint clean.
- **V3 · S17 NON-REGRESSION, both ways:** plain fresh profile → `Entering device-local mode` + `Owner bound to the
  active principal { local: true }` + zero refusals (**PASS 4/4**, identical pre- and post-change); seeded fresh
  profile → owner NOT bound local (**in V4**).
- **V4 · THE EXACT CEREMONY SCENARIO** (`FRESH_BOOT_EXPECT=fixed`, repaired build, fresh temp profile): **PASS 5/5** —
  seed armed · owner bound to the APP principal · **ZERO `not_a_member`** · **`connectors:list` LOADS (22
  connectors)** · the propose surface reachable with a TYPED response (`CAPABILITY_NOT_SELECTED` — honest: no account
  connected in the check). AND the coverage gap closed at the source: `brainPropose.e2e.cjs` + `mailReadBack.e2e.cjs`
  now launch on FRESH temp `--user-data-dir` profiles — **both PASS** (brain-proposed loop end-to-end incl. single-use;
  read-back all three terminals) on the exact bootstrap the ceremony uses. This is the run that would have caught it.
- **V5 · FULL VERIFICATION:** typecheck node clean · lint clean · full main **858 files / 8992 passed / 3 skipped** ·
  `verify-e2e-strip.sh` **PASS** (meaning intact: any leak of the early block necessarily pulls the e2eSeed chunk +
  sentinel, both already in the negative checks) · honesty scan **0 findings** · renderer untouched (ui rule not
  triggered).

## Findings recorded
1. **Fresh-profile coverage gap (CLOSED):** the Phase-0 real-Electron proofs ran on the default dev profile, never on
   a fresh one — the environment mismatch that let this reach the operator's keyboard. All three harnesses now use
   fresh temp profiles.
2. **Title-stamp red herring (RUNBOOK CORRECTED):** the `-e2e` window-title stamp is set once at startup and the
   renderer may overwrite `document.title`; its absence proves nothing. The AUTHORITATIVE armed-rail check is the log
   line `[NEUROPAUSE_E2E_SEED_v1] installing seed principal — mode=app-principal` — written into the runbook's step-1
   pre-flight (edit authorized by the NP-007 directive §3).
3. **DISCOVERED FOLLOW-UP (not executed — out of scope):** adding `installE2eSeedPrincipal` to
   `verify-e2e-strip.sh`'s belt-and-braces greps would touch an out-of-scope sensitive file; not needed for meaning
   (chunk + sentinel checks already catch any leak). Queued as a proposal, not silently expanded into.

## Scope honesty
OUT OF SCOPE and untouched: the owner-row policy and O-13 (the immutability behaved CORRECTLY — the defect was the
ordering, not the policy) · frozen contracts · the authority model · OAuth behavior · production connectors · any real
external effect · ceremony authorization.
