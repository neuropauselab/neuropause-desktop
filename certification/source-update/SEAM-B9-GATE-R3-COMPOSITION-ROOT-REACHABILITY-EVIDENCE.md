# SEAM-B.9 / GATE-R.3 — COMPOSITION ROOT REACHABILITY

## Date
24 Aug 2026.

## Commit
Slice start HEAD `949f127` (= the B.8 commit, the expected continuation). The B.9 commit follows this document.

## Branch
`cert/data-import-cst-integration`.

## Custody
Single worktree; working tree at slice start carried only the custody-protected ` M certification/baseline.json`
(pre-existing, byte-untouched by this slice, uncommitted). Kernel tarball sha256 `293d056…cbceb431` intact.
`out/` untouched and NOT rebuilt. Gate-detector run BEFORE editing on every touched path — PROCEED ×4.
No frozen or sensitive file touched (frozen `enterprise/index.ts`, `cst/`, `connectors/index.ts`,
`packages/shared/` were READ only).

## Baseline
`verify-freeze.sh`: **ANCESTRY OK · SOURCE FAIL**, classified per the gate's four-way rule BEFORE acting:
the 8 changed-since-freeze files are exactly SEAM-22's three + SEAM-B.8's five committed **non-frozen**
deliverables — **baseline lag over already-accepted non-frozen deliverables** (classes 2+3), not a
frozen-surface mutation and not a custody violation. No baseline re-record was run (`freeze-baseline.sh`
would overwrite the custody-protected `baseline.json`); the re-record remains the operator's call.

## Objective
Answer, with evidence: is the B.8 governed journal-post path reachable from the Computer-B production
composition root, and does the evidence/verification path survive that boundary?

## Authority Set
Read at HEAD (not from transcript): the five B.8 files · B.8 evidence doc · frozen `enterprise/index.ts`
(registration chain) · `runtimeCore.ts` · `moduleRegistry.ts` · `glPosting.ts` · vendored kernel
(`tar -xOzf`, types/kernel/stores) · `importTransition.ts` / `sendTransition.ts` / `governedAction.ts`
(key conventions) · `actionRecord.ts` · `readBack.ts` / `readBackReconciler.ts` / instance ·
`durableIdempotencyStore.ts` · `documentSpecs.ts` / `documentAdapter.ts` · companion/api/sandbox dispatchers ·
e2e harnesses (read-only) · `electron.vite.config.ts` + installed electron-vite defaults.

## Discovery Search Space
Four read-only fleet agents (192 tool calls) + inline verification. Greps over `apps/desktop/src/main`,
`src/renderer`, `packages/shared/src` (non-test and test separated), `src/main/e2e`, `e2e/`, `out/`,
and the vendored tarball. Every negative claim below names its command scope in the fleet record; the
door census's spaces are S1–S6 (postedAt writers · status-posted writers · module-id references ·
journal-store handle holders · e2e · companion allowlist).

## Composition Root Census
**One chain, no competing construction:** `index.ts:175` → `initRuntimeCore` → `initEnterprise`
(`runtimeCore.ts:777`) → `initEnterpriseModules` (`enterprise/index.ts:960` — the SOLE
`new EnterpriseModuleRegistry`, `framework/index.ts:62`) → `registerModule(journalEntryModule)`
(`enterprise/index.ts:1264`, import at `:132`) — registering the **object-identical B.8 governed
singleton** (`documentIntegration.attach` is a no-op for the journal: `finance-journal-entries` is
deliberately excluded from `DOCUMENT_SPECS`, `documentSpecs.ts:8-11`). The production construction
(`journalEntryModuleInstance.ts:24-32`) is the ONLY production `createJournalEntryModule` call and passes
durable ports + the evidence observer. **FIVE production dispatch doors, all funneling into the same
handler/registry:** renderer IPC (`moduleRegistry.ts:607-624` ← `ipc.ts:1206`) · companion mobile
(`companion/index.ts:205` via `bindDispatch`) · REST gateway (`api/routeRegistry.ts:153`,
`POST /modules/:moduleId/records/:id/actions/:action`) · sandbox real platform (`realPlatform.ts:97`) ·
GL auto-post cascade (`glPosting.ts:177` via `registry.get`, 14 non-test call sites). `FakeEnterprisePlatform`
never touches the registry and is test-instantiated only. No worker/utilityProcess/second registry exists
(searches stated in the fleet record).

## Journal Post Door Census (re-measured, not trusted from B.8)
**NO UNGOVERNED PRODUCTION JOURNAL-POST WRITE DOOR EXISTS** (spaces S1–S6). Exactly one production write
produces `postedAt`/`status:'posted'` on a journal row — inside the kernel-wrapped effect
(`journalEntryModule.ts`). Structural blocks re-verified with cites: validate-hook immutability +
forced `status:'draft'` on the MERGED Update field-set · `RecordStatus` zod enum (`contracts.ts:1579`)
· lifecycle-only `setStatus` + transition table · importer ontology field exclusion (`journal_entry`
declares only entryNumber/entryDate/memo/lines) · companion allowlist (8 modules, journal absent).
**NEW ADJACENT FINDING (recorded, deliberately NOT fixed — rule 16; not a post door):** the importer's
reviewer-'update' path (`importer.ts:550-558`) calls `store.update` directly, bypassing the module
validate hook — it cannot post a row, but it CAN rewrite `entryNumber/entryDate/memo/lines` on an
already-POSTED journal row (`identityKeys: [['entryNumber']]` makes a matching re-import plausible), and
`onChange` would re-derive account totals from the altered lines. Content-mutation-of-posted-row
exposure; the register resolves its number (§2 #28 — described, not self-numbered).

## Durable Idempotency Census
Journal path: ONE production `DurableIdempotencyStore` over `userData/journal-post-transitions.json`
(the only other production instance is M365's `m365-governed-actions.json` — distinct file, no key-space
overlap). Path profile-stable; hydrate fail-closed (ENOENT = fresh; anything else throws); atomic
temp+rename persist (no fsync, declared). All test constructions use temp dirs; the production path is
protected by convention + the electron import barrier, not by the store (recorded). Key recipes recorded
verbatim, no normalization: journal `sha256(tenantId|entryId|expectedRev)` — tenant + resource +
**revision**; send `sha256(tenant|connector|account|action|params)`; governedAction canonicalized JSON of
the same; import `sha256(tenant|planId|decisions)`. Actor and request identity are part of NONE of the
four (requestId is minted FROM the key). Kernel consults the store per run: DONE → original outcome with
`duplicateSuppressed`; IN_FLIGHT → reconcile, and journal's `{known:false}` oracle ⇒ HOLD
`RECONCILIATION_REQUIRED`; acquire (durable IN_FLIGHT) precedes the effect, and acquire-persist failure
rolls back with no admission.

## ActionRecord Evidence Census (§25 ledger for a journal.post row)
PERSISTED: WHO (`actor` verbatim, `''` when none) · WHAT (`actionId: 'journal.post'`;
`connectorId 'enterprise:finance-journal-entries'` + `accountId` name the store; entry + revision survive
embedded in the transition id) · ATTEMPTED vs EXECUTED (`verdict`/`executed`/`outcome` = the adapter's
semantic vocabulary) · VERIFIED (terminal + provenance `{source: journalPostTransition, method: in-kernel
post-state re-read, oracle: enterpriseRecordStore:finance-journal-entries}`, settled outcomes only) ·
WHEN (`at` record-time; `requestTime` parsed from the FG-12 epoch mint; `verification.at`;
`effectTime` = the row's own `postedAt` verbatim on success; `eventTime` honestly null).
NOT_PERSISTED (stated, never backfilled): raw params (observe drops non-mail params) · purpose ·
policyVersion · the approval object · expectedPostState/observed state (only the terminal survives).
F-P45 conforming: the evidence key is the journal row's own `workspaceId`; rows from unstamped rows land
under `''` — durable and internally consistent (terminal attachment uses the same key) but unqueried by
any production reader (recorded).

## Read-Back Census
`readBack`/`readBackFromDisk` reconstruct journal rows (nothing filters by actionId). A verified row
reads `VERIFIED_SUCCESS` **only** through the D-16 authority — without the verification object the same
outcome string reads `EXECUTED` (the lookalike guard holds for journal rows). A journal DENY-refusal row
reads `DENIED`; a HOLD row reads `UNKNOWN` (send-shaped vocabulary; recorded, not remapped).
**Reconciler invisibility proven from the consumer's end:** `awaitingVerification` requires
`actionId === 'mail.send' ∧ outcome === 'ACKNOWLEDGED'` — journal rows fail BOTH conjuncts structurally
(no `ACKNOWLEDGED` in the journal vocabulary); tick cost is O(n) filter only. Reader census: **zero
org-expecting readers** remain over the evidence store (all seven readers/writers workspace-conforming;
`connectors/index.ts:641` stays the F-P45 deviating writer with the migration owed).

## Governance Vocabulary
Recorded verbatim from the vendored kernel (fleet record): Verdict `ALLOW|HOLD|DENY|ESCALATE`; the full
26-code ReasonCode union; OutcomeClass 5-way; HOLD vs DENY split (missing approval → HOLD
`APPROVAL_REQUIRED`; expired → HOLD; AI-approver/SoD/binding/scope/constraint/consumed → DENY);
**policy DENY precedes the approval stage** (`kernel.ts:156-160`) — which is why an empty actor lands
DENY `AUTHORIZATION_FAILURE`, not HOLD (see Implementation). `policyVersion` is read at exactly ONE
kernel site (`kernel.ts:445`) as an evidence-label interpolation — never compared (NP-020 confirmed in
the kernel itself). Verification = declared `expectedPostState` vs authoritative re-observation under
JSON structural equality; `!accepted`+deviation → VERIFIED_FAILURE, accepted+deviation → DEVIATION.
No second enum, no synonym, no new decision engine was created.

## Runtime Reachability Result
**COMPOSITION ROOT UNEXECUTED at the Electron/runtime level — and the standing built artifact provably
lacks the governed path.** `out/` (built 20 Aug 22:18, the armed ceremony build — `e2eSeed-NKS_iH8j.js`
present) contains **0 occurrences** of `journalPostTransition`/`journal-post-transitions`/`JOURNAL-B8`
(grep over the whole `out/` tree) while the pre-B.8 journal module IS present — so the only launchable
bundle would exercise the UNGOVERNED pre-B.8 post, a false measurement, not a proof. The launcher itself
is solved (six e2e harnesses `_electron.launch` the prebuilt bundle with fresh temp `--user-data-dir`,
writing nothing to out/), but `npm run dev` rebuilds `out/main`+`out/preload` on every launch
(electron-vite 2.3.0 defaults; no outDir override in config) and a plain rebuild would destroy the armed
ceremony build (NP-008 law: it stays the LAST build). **Resolution paths recorded for the operator, none
taken:** (a) sanctioned rebuild with the ceremony build re-armed as the final build; (b)
`electron-vite build --outDir <other>` leaving `out/` untouched, harness pointing at the alternate
`main/index.js`; (c) keep runtime proof deferred. This gate took (c) plus the strongest sub-runtime
evidence (below).

## Implementation Performed
Per §15, **no composition wiring was manufactured — none was missing** (COMPOSITION_ROOT_GOVERNANCE_WIRING
= ALREADY PRESENT, measured). What WAS implemented:
1. **The composition pin** `journalPostCompositionRoot.test.ts` (9 tests): executes the REAL
   `journalEntryModuleInstance.ts` — the exact singleton frozen `enterprise/index.ts:132/:1264`
   registers — under vitest with `electron` mocked at the platform boundary only (the established
   `firstRealSendGuard.test.ts` hoisted-temp-dir pattern; measured: this instance's import graph never
   touches unimportable `enterprise/index.ts`, unlike the blocked `reconciliation/compositionRoot.test.ts`
   root). It proves through the production construction: durable idempotency file at the production-named
   path with a DONE intent (in-memory default ports would leave NO file — the §6 distinction) · evidence
   observer attached · §17 negative (guards satisfied, no actor ⇒ DENY, zero writes, rev unchanged,
   refusal row with NO terminal) · §18 positive (exactly one revision advance, terminal on the right row,
   effectTime verbatim) · §22 read-back from persisted bytes via a fresh reader · §20 door-level replay
   (no second write, no third evidence row) · §9 reconciler invisibility via the REAL predicate · §26
   policy-label-grants-nothing.
2. **A DEFECT FOUND BY THE PIN AND FIXED (measured on persisted bytes before any edit):** the B.8
   transition id `journal-post:<entry>:<rev>` was NOT attempt-unique — a refusal does not advance `rev`,
   so a retry reused the id and `recordVerification` (first match on tenant+transition) pinned the
   retry's VERIFIED_SUCCESS terminal onto the REFUSAL's evidence row (observed: a `verdict: DENY,
   executed: false` row carrying `terminal: VERIFIED_SUCCESS` while the real success row held
   `verification: null`, and `readBackFromDisk` matched 2 rows for one id). Fix (surgical, non-frozen,
   in the B.9 target surface): per-attempt transition id
   `journal-post:<entry>:<rev>:<ms>-<seq>` — the idempotency key (unchanged) carries the logical-post
   identity, so replay semantics are untouched — and `GovernedJournalPostResult.transitionId` now
   reports the OUTCOME ENVELOPE's id (on a DONE-replay, the original attempt's), keeping evidence
   addressing coherent. Two B.8 exact-string pins expired under the fix and were re-pinned to the
   stable `entry:rev` prefix (§54: EXPECTED_SEMANTIC_CHANGE; §2 #21 — B.8's "unique per
   attempt-generation" statement was measured FALSE for the refusal-then-retry sequence and is
   superseded, not erased).
3. **A precision correction to B.8's refusal claim (§2 #20):** the empty-actor refusal is
   **DENY `AUTHORIZATION_FAILURE`** (policy stage, empty grant set — `kernel.ts:156-160`), not
   HOLD `APPROVAL_REQUIRED`; the kernel's policy check fires before its approval check, and the
   adapter couples grant and approval to the same actor condition. Fail-closed either way; the
   measured reason is the stricter one. §1's B.8 bullet is corrected in the same commit.

## Tests
New: 9 (JOURNAL-B9-01…09), all green at the final state. B.8's 18 JOURNAL-B8 pins green (2 re-pinned to
the attempt-prefix as classified above). Adjacent: generalLedger 12 + glAutoPosting 10 green.

## Full Regression
At the final code state (nothing but documentation changed after these runs; the B.8
measure-then-edit mistake was not repeated — the mutation test restored byte-identically BEFORE the
final runs, shasum-proven):
- **WITH the new pin file: 9327 passed / 5 skipped** (captured Tests line; file count 891 by
  construction — baseline's 890 + the one new file).
- Baseline (B.8): 890 / 9318 / 5.
- Delta: **exactly +9**, the new pin file's tests.

## Decision Neutrality
Full suite WITHOUT the new B.9 test file (`--exclude "**/journalPostCompositionRoot.test.ts"`):
**9318 passed / 5 skipped — the Tests totals IDENTICAL to the B.8 baseline**, despite the adapter fix
and the two re-pinned assertions running everywhere. (Captured output carried the Tests line only; the
file count is 890 by construction — the exclusion removes exactly the one new file from the WITH-run's
set.) The WITH-run delta is exactly the 9 new tests. Measured, not asserted.

## Mutation Proof
`journalEntryModuleInstance.ts` locally mutated (governance argument removed) → the pin fails
**6 of 9** → restored **byte-identically** (sha256 `7a72b821…da681f78` identical before/after) → 9/9
green. The pin is load-bearing on the production wiring; the mutation was never committed.

## Call-Graph Audit (§28 answers)
1 production journal-post door class (`runAction('post')`) fanned by **5** production dispatchers ·
**1** write site, inside the kernel effect · **1/1 governed** · **0 kernel bypasses** · **1** production
composition root · **1/1** injects durable idempotency · **1/1** injects evidence · 30 test-only
constructions (28 with in-memory ports — kernel-identical, non-durable, no observer; 2 durable in the
B.8 test file) · no hidden background paths (serviceManager roster + automation + workforce + medicalDevice
swept; `modules.actionContext` is exported process-wide and COULD hand a future consumer a
channel-RBAC-free path to `runAction` — the kernel's own actor/approval policy would still apply;
recorded as a standing bound, §2 #31 class) · direct store writes exist only behind structural blocks
(and the importer content-mutation finding above).

## First-Broken-Edge Analysis
Walking the target graph: every edge from *Electron composition root* through *institutional
reconstruction* is PROVEN at the composition level except the FIRST one — **Electron startup → real
composition** — which is UNPROVEN at runtime (unexecuted; and the only existing bundle predates the
governed path entirely). No edge is BLOCKED by a defect; the runtime edge is blocked by an artifact
decision that is the operator's (out/ preservation vs rebuild). The evidence edge (ActionRecord →
institutional reconstruction) was BROKEN at slice start for the refusal-then-retry sequence and is now
PROVEN (the defect fix above, pinned).

## Known Bounds
Event-loop-scoped CAS (one process, one thread; no multi-process atomicity claimed) · the vitest
composition pin substitutes `app.getPath` at the platform boundary and supplies the dispatch `ctx`
(the registry's actionCtx and frozen `enterprise/index.ts` boot remain unexecuted by tests) · F-P45
carried (workspace-id-in-tenant-column; migration owed elsewhere) · `''`-workspace evidence rows are
durable but production-unqueried · HOLD rows read `UNKNOWN` in the send-shaped read-back vocabulary ·
the observer-failure contract is pinned at module level (B8-16), not re-provable through the production
instance without mutating it.

## Out-of-Scope Items (recorded, untouched)
The importer posted-row content-mutation finding · posted-soft-delete debt · F-P45 migration ·
`payrollRunModule.ts:388` sibling posted-flag · generic `updateIfRevision` (NP-017: a consumer earns it) ·
the operator's out/ rebuild decision · the §59 first-real-verification run plan.

## Maturity Classification
Module-level implementation **E4 VERIFIED** (B.8 pins + B.9 fix) · composition-level wiring
**E3 DEMONSTRATED** (the real instance executed under vitest; mutation-proven load-bearing) ·
runtime reachability **E1 SPECIFIED** (static chain quoted end-to-end; unexecuted; current bundle lacks
the path) · verification path **E4 VERIFIED at composition level** (read-back from persisted bytes) ·
production acceptance **E0** (no operator acceptance, no runtime run, no external effect). The
Computer-B system as a whole is promoted by NONE of this.

## Final Verdict
**COMPOSITION_REACHABILITY_POSSIBLE_BUT_UNPROVEN** — the static call graph and the executed production
construction establish possibility end-to-end (and the wiring is measured PRESENT, durable, and
evidence-bearing), but the actual Computer-B Electron composition/runtime was not executed, and the only
existing built artifact predates the governed path. The correct institutional statement is exactly:
*the examined Computer-B composition path for finance.journal.post is governed and reachable under the
tested conditions* — nothing wider.

## Next-Gate Handoff

| SEAM | STATUS | LOAD-BEARING EDGE | PROVEN | UNPROVEN | BLOCKED | NEXT REQUIRED GATE |
|---|---|---|---|---|---|---|
| B.8 journal governed transition | CLOSED | kernel wraps the one write door | module level (E4) | — | — | — |
| B.9 composition reachability | CLOSED (this gate) | production construction graph | composition level (E3), evidence chain repaired | Electron runtime execution | out/ artifact decision (operator) | **B.10: runtime execution** — operator-sanctioned build (option b: `--outDir` alternate keeps out/ untouched) + real-Electron journal-post run on a fresh temp profile, zero external effects |

Next highest-value seam by FIRST-BROKEN-EDGE + HIGHEST CONSEQUENCE: the runtime edge above; after it,
the gate-blocked P0s (B1/B2 executor-governance FG envelope · cohort ActionRecord FG envelope) remain
owed to the operator, and the §59 first-real-verification run plan stays ⛔ operator-executed.

## STATUS
**CLOSED (TEST-VERIFIED at composition level).** EXTERNAL_EFFECT = 0 · no app launched · `out/` not
rebuilt · `baseline.json` byte-untouched · no frozen/sensitive touch.
