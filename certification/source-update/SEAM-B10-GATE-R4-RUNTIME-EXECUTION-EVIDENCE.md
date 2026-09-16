# SEAM-B.10 / GATE-R.4 — RUNTIME EXECUTION + PRODUCTION-BUILD PARITY

## 1. Scope
Prove or disprove: the governed journal-post path present in source and composition (B.8/B.9) is
present and executable in a REAL Electron runtime built from source into an ISOLATED artifact —
without touching the armed `out/` build, with zero external effects. The only permitted effect: local
journal-post mutations inside a fresh temporary profile.

## 2. Custody
HEAD_AT_START `914204d` (= the B.9 commit; expected continuation) · branch
`cert/data-import-cst-integration` · single worktree, no submodules · STAGED 0 ·
FILES_CHANGED_AT_START = 0 beyond the custody-protected pre-existing ` M certification/baseline.json`
(byte-untouched throughout, uncommitted) · COMMITS/PUSHES/FETCHES at start = 0 · EXTERNAL_EFFECT = 0 ·
kernel tarball sha256 `293d056…cbceb431` intact · gate-detector PROCEED ×3 on every planned new path
BEFORE creation. No reset/checkout/clean/stash/rebase/amend performed.

## 3. B.9 Baseline
`verify-freeze.sh`: ANCESTRY OK · SOURCE FAIL — same classified state as B.9 recorded it: the
changed-since-freeze set is exactly the SEAM-22 + B.8 + B.9 committed NON-frozen deliverables
(baseline lag over already-accepted work; not FROZEN MODIFIED; no baseline repair run). §8 source
hashes recorded at gate start for the seven B.8/B.9 files (`/tmp` manifest; `journalEntryModuleInstance.ts`
= `7a72b821…` — identical to B.9's mutation-restore shasum, continuity across gates).

## 4. Armed Build Preservation
§9 census at start: `journalPostTransition` hits under `out/` = **0** (ARMED_OUT_GOVERNED_HITS = 0);
legacy `finance-journal-entries` = 2 (ARMED_OUT_LEGACY_HITS); ceremony chunks incl.
`e2eSeed-NKS_iH8j.js` present (sentinel ×1); 87 files; newest `2026-08-20 22:18:48`. §41 re-census at
end: **87 files, newest 2026-08-20 22:18:48, `out/main/index.js` sha256 prefix `ee5e8e993c70fb71276a` —
byte-identical to the sha recorded in the committed ARCHITECTURE-MAPPING §8.4 build record.** The armed
build was not deleted, rebuilt, patched, or touched. **§67 cause of the staleness, measured:** `out/`
was built at HEAD `472092c` on 20 Aug 22:18:48 with `NP_E2E_BUILD=1` (the armed ceremony build — seed
chunk + sentinel prove the flag; the rebuild is recorded in committed evidence), and no build has run
since, per the NP-008 last-build law; B.8/B.9 landed 24 Aug. The gap is build timing + a preservation
law — not a build-system defect and not a source/composition defect.

## 5. Alternate Build
Command (from `apps/desktop`): `env -u NP_E2E_BUILD npx electron-vite build --outDir "$PWD/out-seam-b10"`.
Exit 0 in 2.89s. **The ABSOLUTE `--outDir` form is load-bearing** (measured in the installed
electron-vite 2.3.0: `resetOutDir` resolves per-process against each section's own `root`, and this
repo's renderer section sets `root: src/renderer` — a RELATIVE `--outDir` would split the renderer limb
to `src/renderer/out-seam-b10/renderer` and break `window.ts`'s `join(__dirname,'../renderer/…')`
sibling resolution; the absolute form lands all three limbs under one parent). Build produced from
source by the real pipeline; **zero generated files edited** (§13 honored); zero bytes written under
`out/` (the only 'out' literals in electron-vite are the three defaults, all overridden pre-build).
§12 parity, measured on `out-seam-b10/main/index.js`: `journalPostTransition` ✓ · `journal-post:` mint ✓
· `finance-journal-post-policy-1` ✓ · `postedByThisTransition` ✓ · `journal-post-transitions.json` ✓ ·
`enterprise:finance-journal-entries` ✓ · kernel required via externalized
`@neuropause/cst/dist/src/{kernel,stores,types}.js` (runtime-resolvable from the sha-pinned vendored
install — same externalization mechanism as the armed build) · e2e seams **absent** (0 chunks, 0
sentinels — release strip held). §69 comparison: armed = 0 on every governed marker + seed sentinel
present; alternate = all governed markers + 0 seams.

## 6. Build Fingerprint
HEAD `914204d` · command above · node `v20.20.2` · npm `10.8.2` · electron `42.8.1` · electron-vite
`2.3.0` · built `2026-08-24T14:26:13+05:30` · outDir `apps/desktop/out-seam-b10` ·
`main/index.js` sha256 `a3184b7ee4ab2572aba077f880d7b5c9e67c6e155d42afeaaa9210606c6456df` ·
`preload/index.js` sha256 `5bd5f8b0c70d92c8ab18b46e11752427072b0a3517b72860fb5a0c72bb0e10f3`.

## 7. Runtime Environment
Playwright-core `_electron.launch` (the six-harness precedent) of `out-seam-b10/main/index.js` with
`--user-data-dir=<fresh mkdtemp>`, cwd `apps/desktop`, env `NODE_ENV=production, NP_E2E_BUILD='',
NEUROPAUSE_E2E=''`. Harness: `e2e/journalRuntime.e2e.cjs` (new, PROCEED-class — top-level `e2e/` is in
no frozen/sensitive list; the sensitive class is `src/main/e2e/`). Two launches: phase 1 (fresh
profile) and phase 2 (same profile, restart).

## 8. UserData Isolation
ISOLATED_USERDATA = TRUE — asked of the RUNNING app: `app.getPath('userData')` realpath equals the temp
profile realpath (macOS `/var/folders` ⇄ `/private/var/folders` symlink accounted). `--user-data-dir`
is Electron's native switch, applied before any store resolves the path (0 `setPath` calls in src/main —
measured).

## 9. Database Isolation
DATABASE_PATH = TEMP: `enterprise-module-finance-journal-entries.json` exists inside the temp profile
and contains the probe entries (asserted by the read-back driver). No production profile, no existing
workspace data — the profile was born empty this run.

## 10. Evidence Isolation
`action-records.json` AND `journal-post-transitions.json` both inside the temp profile (asserted from
the files themselves). Nothing written to any normal user profile.

## 11. Runtime Composition
Asserted from RUNTIME BOOT LOGS captured off the launched process (not source inference):
`Enterprise OS ready` · `Owner bound to the active principal` (local; phase 1 — the claim happens once,
so phase 2 correctly does not expect it) · `Runtime core ready` · `Background services started` ·
`Read-back reconciler started`. Behavioral completion of the assertion: the door produced rows stamped
`tenantId 'org-default' / workspaceId 'workspace-default'` and evidence at the production-named paths
that ONLY the governed singleton (durable ports + observer) writes.

## 12. Runtime Dispatch Door
The renderer-IPC production door, driven verbatim: `window.neuropause.invoke` (the real preload bridge)
→ `enterprise:module.create` / `enterprise:module.get` / `enterprise:module.action` → secure bridge
(`requireAuth` passes: local principal) → `moduleRegistry` action handler (`ctx.authorize('operations:manage')`
passes: the local owner claim holds it) → `runAction('post')`. The brainPropose.e2e.cjs precedent; no
sixth door invented; no external service touched. Actor = the REAL local-mode principal
`local-ece74a01-275a-4750-823d-1bff46e2177b@device.invalid` (deterministic synthetic, D-12 verbatim in
evidence rows; no real user identity).

## 13. Governance Path
door → governedJournalPost → CST kernel (policy grant + approval mint + claim + durable idempotency
acquire) → ALLOW → synchronous CAS effect → journal store write → authoritative re-read verification →
ActionRecord evidence → independent read-back. "Module imported" was NOT counted as governance; the
chain below is behavioral.

## 14. Test A — Governed Success
`JE-B10-01` draft (rev 1) → post → `{ok:true, message:'Journal entry JE-B10-01 posted (balanced 100).'}`
→ row `status 'posted'`, `postedAt '2026-08-24T08:58:59.723Z'`, **rev 2 (exactly one increment)**.
Evidence row: verdict `ALLOW`, executed `true`, outcome `VERIFIED_SUCCESS`, terminal `VERIFIED_SUCCESS`,
`effectTime` = the row's own postedAt VERBATIM, transitionId
`journal-post:rec_809520f6-…:1:1787561939722-1` (per-attempt suffix — §64 fix present in the runtime).

## 15. Test B — Empty Actor
**STRUCTURALLY UNREACHABLE THROUGH ANY PRODUCTION DOOR — measured, not skipped:** every production
dispatch derives the actor from the live session; `createAuthorize` throws `'Sign in to continue.'`
when `sessionEmail` is null BEFORE `runAction`, and local mode always carries a principal. This is a
POSITIVE finding about the composition (the door cannot manufacture an empty actor), not an executed
runtime test. The empty-actor governance refusal (DENY `AUTHORIZATION_FAILURE`, policy stage — the B.9
measured classification, NOT the old HOLD description) remains proven at module + composition level
(JOURNAL-B8-02, JOURNAL-B9-02). RUNTIME_EMPTY_ACTOR = NOT_EXECUTED (structurally excluded at the door).

## 16. Test C — Replay
Same logical request repeated through the door → `{ok:false, message:'JE-B10-01 is already posted.'}`,
rev unchanged (2), **no second effect**. Honest split: the runtime replay is refused by the door's
fresh already-posted re-read BEFORE the kernel — the kernel-level DONE-replay (duplicateSuppressed,
original transition id returned via the outcome envelope) is unreachable through this door once the row
is posted and remains proven at module/composition level (JOURNAL-B8-07/08). RUNTIME physical write
count for the logical post: **1**.

## 17. Test D — Refusal/Retry
NOT EXECUTED at runtime through a production door: a governance-stage refusal followed by a same-rev
retry cannot be manufactured through the real door without injection (the door supplies a granted,
approved actor; domain-guard refusals stop BEFORE the kernel and mint no evidence). The B.9 defect fix
this test protects is nonetheless runtime-evidenced structurally: BOTH runtime evidence rows carry
per-attempt transition ids (`…:1:1787561939722-1`, `…:1:1787561939732-2`), and the read-back driver
pins that no non-success attempt carries a success terminal over the runtime rows. Full
refusal-then-retry semantics remain proven at composition level (JOURNAL-B9-02/03/05).

## 18. Test E — Concurrency
Two truly concurrent posts of one draft, fired in a single renderer turn → results:
`[{ok:true, 'posted (balanced 50)'}, {ok:false, 'JE-B10-02 is already posted.'}]` → row rev **2 exactly**
(original + 1, never + 2), posted once. The loser was refused at the DOOR's fresh re-read (it never
reached the kernel — hence exactly 2 evidence rows in the profile, both successes on distinct entries);
the kernel-loser variants (STALE_RESOURCE / HOLD `RECONCILIATION_REQUIRED`) were not exercised at
runtime and remain module/composition-proven (JOURNAL-B8-06/14). Physical write count: **1**.

## 19. Test F — Lying Executor
NOT EXECUTED at runtime: no safe injection exists without changing production code, and none was
created (§30 honored). DEVIATION-on-lying-executor remains proven at module level (JOURNAL-B8-03/04).

## 20. Test G — Disk Read-back
EXECUTED, the mandatory form: WRITE (real Electron process) → PROCESS BOUNDARY → FRESH READER (a
separate vitest process, `journalRuntimeReadBack.test.ts`, env-gated `describe.runIf`) →
`readBackFromDisk(profile, 'workspace-default', {transitionId})` → **`matches: 1`,
`finalStatus: 'VERIFIED_SUCCESS'`** for each success row — reconstructed from persisted bytes, never
from app memory, singleton, cache, or fixture. Also pinned over the runtime rows: per-attempt id shape ·
provenance oracle `enterpriseRecordStore:finance-journal-entries` · no non-success attempt wears a
success terminal · `awaitingVerification` false on every row (the REAL M365-reconciler predicate — and
the RUNNING app's reconciler service ticked over this same store with journal rows present and no
errors).

## 21. Test H — Restart
EXECUTED: the same alternate build relaunched on the same profile (after clearing an orphaned
harness-spawned instance that correctly held `requestSingleInstanceLock` — the app's single-instance
enforcement working as designed; classified as a harness-environment condition, not a product defect).
Result: `JE-B10-01` still `posted`, rev still 2, `postedAt` byte-identical to the phase-1 value.
Evidence and domain state survive the process boundary.

## 22. Test I — Replay After Restart
EXECUTED: post replayed after restart → refused (`'JE-B10-01 is already posted.'`), rev unchanged,
no second effect. The durable idempotency file (`journal-post-transitions.json`) carries DONE intents
inside the profile (asserted from bytes) — durability is disk-backed, not process-memory.

## 23. Evidence Integrity
The two runtime evidence rows answer (per the §25 ledger, B.9): WHO (the local principal, verbatim) ·
WHAT (`journal.post`; entry + rev embedded in the transition id) · ATTEMPTED/EXECUTED
(ALLOW/true/VERIFIED_SUCCESS) · VERIFIED (terminal + provenance) · WHEN (record/request/verification
times + effectTime verbatim). NOT_PERSISTED remains as B.9 recorded (purpose · policyVersion ·
approval object · raw params · observed state) — stated, not backfilled.

## 24. Regression
Full main suite at the final source state: **892 files / 9328 passed / 7 skipped** vs the B.9 baseline
891/9327/5 — delta exactly the new env-gated read-back file (+1 gated-off pass, +2 gated-on skips).
§42 re-hash of all seven B.8/B.9 source files: identical to gate start (the runtime experiment changed
no source). Typecheck node clean · eslint clean (the .cjs harness is config-ignored like every
`e2e/*.cjs`) · honesty scan 0.

## 25. Runtime Maturity
finance.journal.post governed path: **E3 at the runtime level — RUNTIME GOVERNED EXECUTION DEMONSTRATED**
(real build from source, real Electron process, real composition, real door, durable evidence), with
the read-back independently reconstructing the terminal from persisted bytes in a separate process.
NOT E4 "independently verified" in the external-assurance sense; NOT production acceptance (§54:
a fresh temp Electron profile is controlled local runtime evidence).

## 26. First-Broken-Edge
IDENTITY PROVEN (local principal, verbatim in evidence) · AUTHORITY PROVEN (owner claim → RBAC →
kernel grant+approval) · POLICY PROVEN (kernel ALLOW; label-grants-nothing at composition level) ·
REQUEST PROVEN (door schema → runAction) · DECISION PROVEN (ALLOW recorded) · TRANSPORT PROVEN
(renderer IPC → secure bridge → handler) · EXECUTION PROVEN (CAS write, rev+1 exactly) ·
EFFECT INTERNAL (local journal row — by design of this gate) · READ-BACK PROVEN (fresh reader,
persisted bytes, separate process) · VERIFICATION PROVEN at the in-kernel-oracle level (authoritative
store re-read; external/independent assurance remains out of scope). The previous first broken edge —
Electron startup → real composition — is now CLOSED for this path under these conditions; the next
unproven boundary is PRODUCTION ACCEPTANCE (operator-controlled, outside this gate).

## 27. Known Limitations
Event-loop-scoped CAS (unchanged claim; no multi-process atomicity asserted) · runtime Tests B/D/F
NOT EXECUTED for the measured structural reasons above (module/composition proofs stand) · the
kernel-loser concurrency variants not exercised at runtime · the alternate build is a RELEASE build
launched via playwright's loader (the packaged/electron-builder artifact was not built — packaging is a
different pipeline stage) · F-P45 carried (`tenantId` column holds `workspace-default`) · single
harness-environment incident (orphaned instance holding the profile lock) classified and cleared.

## 28. External Effects
**EXTERNAL_EFFECT = 0.** No email, no M365/Graph, no payment, no cloud mutation, no third-party call,
no notification, no real customer/company/financial data. All writes: temp profile only. The app's
backend probe targets localhost and no backend was running.

## 29. Final Verdict
**RUNTIME_GOVERNANCE_VERIFIED — scoped exactly as §59 requires:** *finance.journal.post governed
runtime execution demonstrated under an isolated Electron build/profile.* The alternate
production-pipeline build executes the governed journal-post path in a real Electron runtime, with
durable evidence and independent read-back from persisted bytes. Per §54's distinction this is
RUNTIME_PROVEN, **not** PRODUCTION_ACCEPTED — equivalently verdict G's framing holds:
RUNTIME_VERIFIED_PRODUCTION_NOT_ACCEPTED. No claim is made about NeuroPause OS as a whole, other
capabilities, other doors under load, or any external effect.

## 30. Next Single Action
The operator's production-acceptance decision for this path (a separately authorized gate), OR the next
load-bearing seam from the standing topology: the B1/B2 executor-governance FG envelope (frozen `cst/`,
operator token required). §48 note: public NeuroPause/NeuroShell material (Devdiscourse UBE article;
The Hitavada "AI Action Firewall" article with allow/review/block + human-approval-for-high-risk claims;
an unrelated third-party "NeuroShellOS" Linux concept; `neuropause033.com` unreachable from this
environment — DNS ENOTFOUND) is recorded as PUBLIC CLAIMS, NOT RUNTIME PROOF, and none of it was used
as evidence of repository behavior.

## Cleanup (§43)
Performed AFTER all evidence above was captured and hashed: temp profiles + state files and the
`out-seam-b10/` alternate artifact deleted (its fingerprint hashes recorded in §6 survive it). The
armed `out/` untouched (§41 proof above). Harness + read-back driver committed as permanent,
re-runnable artifacts.
