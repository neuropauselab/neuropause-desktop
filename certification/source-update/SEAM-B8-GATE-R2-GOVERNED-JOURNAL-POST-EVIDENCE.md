# SEAM-B.8 / GATE-R.2 — THE GOVERNED JOURNAL-POST TRANSITION (DRAFT → POSTED)
**24 Aug 2026 · TEST-VERIFIED · zero frozen touches · zero sensitive touches · zero external effects · no app launched, `out/` not rebuilt**

## SLICE_ID / PURPOSE
`SEAM-B8-S1` — the directive's §1 objective verbatim: *"Create the smallest production-safe governed
transition adapter that causes: journal DRAFT → POSTED to cross the already established sanctioned CST
governance boundary."* This is the FIRST domain-store consequential transition governed by the CST
kernel — the first load-bearing CST entry point outside the M365 connector path.

## VERDICT
**GOVERNANCE_PATH_LOAD_BEARING** — for `finance-journal-entries` rows, in the current codebase, per the
call-graph audit and the §56 test below. Origin tags: the door census is CURRENT SOURCE (X1 fleet +
re-measured greps this sitting); the §56 refusal is CURRENT SOURCE (JOURNAL-B8-11, run green).

## WHY THIS IS LOAD-BEARING AND NOT DECORATIVE (§56)
The door census (X1, re-verified by grep this sitting — search space: `src/main`, `src/renderer`,
`packages/shared/src`, all non-test `*.ts`) shows the journal DRAFT → POSTED mutation has **exactly one
write site** in the product: the write inside `runAction('post')`. Every structural alternative is
blocked: SetStatus (zod `RecordStatus` enum has no `posted`; wrong column; transition table), Update
(the `validate` hook refuses any non-empty `postedAt` and forces `status:'draft'`), the importer
ontology (no status/postedAt), the companion allowlist (journal excluded). That single write now
executes **inside the kernel-wrapped effect closure** — so refusing the kernel refuses the write, for
every caller, at one edit point. JOURNAL-B8-11 proves it behaviorally: every domain guard satisfied
(balanced, resolvable accounts, open period), only the governance input differs (no session actor),
and the write does not happen — same entry then posts fine with an actor, isolating governance as the
only discriminator.

## FILES_CHANGED (all non-frozen, gate-detector PROCEED ×3 captured before edits landed)
- `apps/desktop/src/main/enterprise/modules/finance/journalPostTransition.ts` — **NEW.** The adapter,
  mirroring frozen `cst/importTransition.ts` verbatim in shape: per-call `CstKernel` + `SystemTime` +
  `ResourceStore`/`EvidenceStore`, single-actor `PolicyStore` projection of the already-enforced RBAC,
  conditional `Approval` mint (no actor ⇒ no approval ⇒ C3 HOLD `APPROVAL_REQUIRED`, kernel.ts:189-196),
  declared `expectedPostState = { postedByThisTransition: true }`, honest `reconcile = {known:false}`,
  semantic refinement without overriding the kernel (`STALE_RESOURCE` only when the effect reported a
  lost CAS). Consequence **C3** (import's high-risk-local-write precedent); reversibility
  **DIFFICULT_TO_REVERSE** (compensable by a mirrored reversing entry, never undoable — the
  `contacts.update` precedent). `transitionId = journal-post:<entryId>:<expectedRev>` (unique per
  attempt-generation, non-colliding); idempotency key = sha256(tenant|entry|rev) — same entry at the
  same durable revision is the same logical post.
- `apps/desktop/src/main/enterprise/modules/finance/journalEntryModule.ts` — `runAction('post')`'s
  write moved inside the governed effect. Fresh synchronous re-read anchors the CAS (`expectedRev`);
  the effect re-checks row/rev/postedAt and writes **in one await-free section** (atomic on the
  main-process event loop — the substrate's real concurrency model, stated not pretended away). All
  pre-existing domain guards run BEFORE the kernel, preserving policy-hold semantics (closed-period
  POLICY object unchanged). New optional third parameter `JournalPostGovernanceOptions` injects
  DURABILITY and EVIDENCE only — **every construction is governed; there is no ungoverned variant**
  (defaults are in-memory ports with identical kernel semantics). Honest result mapping: refusal names
  the verdict + kernel reason; STALE_RESOURCE says reload-and-retry; UNKNOWN/DEVIATION are never
  promoted (§2 #9/#14). If the conditional write took effect, emit + account reconcile run regardless
  of verification class so ledger truth never drifts.
- `apps/desktop/src/main/enterprise/modules/finance/journalPostEvidence.ts` — **NEW**, Electron-free.
  One durable ActionRecord row per governed attempt (`actionId: 'journal.post'`, self-disclosing
  `connectorId: 'enterprise:finance-journal-entries'`); settled terminals attach via
  `recordVerification` (D-16 vocabulary; store monotonicity D3); `effectTime` = the durable row's own
  stamped `postedAt`, verbatim, success only (NP-015). F-P45 conformance: the evidence key is the
  WORKSPACE id (the writer's recorded convention; migration stays owed elsewhere).
- `apps/desktop/src/main/enterprise/modules/finance/journalEntryModuleInstance.ts` — the Electron
  wiring: `DurableIdempotencyStore` over `userData/journal-post-transitions.json` (frozen cst/ class
  **consumed, never modified** — a second instance over its own file, the `m365-governed-actions.json`
  convention) + `recordJournalPostEvidence` as the best-effort observer.
- `apps/desktop/src/main/enterprise/modules/finance/journalPostTransition.test.ts` — **NEW**, 18 pins.

## WHAT THE KERNEL NOW DECIDES (that nothing decided before)
X4's measurement: `canEnterStatus` is consulted only by the Update/SetStatus handlers, the journal has
**no approval spec** (deliberate, `documentSpecs.ts:8-11`), and the action door contains no approval
check — so this CST verdict is the FIRST approval verdict on this transition, competing with nothing.
Approval provenance: the explicit post by an RBAC-passed session actor is the approval act (the
sendTransition `confirmed` precedent); on the GL auto-post cascade the ctx carries the ORIGINATING
authorized mutation's actor verbatim — recorded semantic, not a bypass (§28 honored: glPosting's
`runAction('post')` at `glPosting.ts:177` crosses the same kernel as the human door).

## TESTS_ADDED (18, JOURNAL-B8-01…22; 17/18 first-run green, 1 fixture-artifact assertion corrected — §54 class TEST_FIXTURE_MISMATCH, product untouched)
Adapter: granted post → VERIFIED_SUCCESS through the real kernel · **fail-closed actor: refused before
the effect runs (0 effect calls)** · **lying executor caught: claimed success the store does not show ⇒
DEVIATION (§2 #14)** · wrong-revision posted state ⇒ DEVIATION (§30 non-vacuous) · UNOBSERVABLE ⇒
UNKNOWN (§2 #9) · lost CAS ⇒ STALE_RESOURCE (the winner's world never verifies the loser) ·
**at-most-once: replay duplicate-suppressed, effect ran exactly once** · durable replay across a
simulated restart (fresh `DurableIdempotencyStore` over the same file). Module: end-to-end success with
kernel evidence + rev+1 exactly + unchanged success message · **§56 load-bearing refusal** (with the
control re-post proving governance was the only discriminator) · unbalanced entry refused BEFORE the
kernel (guard order preserved; zero evidence rows) · already-posted refusal without a second kernel run ·
**two simultaneous posts ⇒ exactly one write (rev advances exactly once)** · restart survival ·
**observer failure never blocks or alters the post (§2 #19/#29)**. Evidence (REAL ActionRecord store,
read back per §2 #29): verified post ⇒ one durable row + attached VERIFIED_SUCCESS terminal + verbatim
effectTime + named provenance oracle · refusal ⇒ evidence row with NO verification terminal (a refusal
is not a verified failure) · **consumer-derived reconciler invisibility: the REAL `awaitingVerification`
predicate returns false on journal rows (§2 #27 — pinned from the consumer's end)**.

## TESTS_RUN / REGRESSION_RESULT
- Full main suite: **890 files / 9318 passed / 5 skipped** vs baseline 889/9300/5 — delta exactly
  +1 file/+18 tests (the new pin file), **zero existing tests changed or broken**. Decisive because the
  default-governance change routes all 27 pre-existing journal-post-driving test files through the
  kernel — authorized actors see byte-identical behavior (messages, refusals, reconciliation).
- `tsc --noEmit -p tsconfig.node.json` clean (from `apps/desktop`, §2 #24) · eslint clean on all five files.
- Focused: JOURNAL-B8 18/18 + `generalLedger.test.ts` 12/12.

## CUSTODY (§74)
HEAD at slice start `8954da5` (single worktree, branch `cert/data-import-cst-integration`); kernel
tarball sha256 `293d056…cbceb431` intact; `certification/baseline.json` **byte-untouched by this slice**
(its pre-existing modification preserved, uncommitted, exactly as custody requires).
`verify-freeze.sh`: **ANCESTRY OK · SOURCE FAIL** — classified before acting (§2 #24): the failing
files are exactly SEAM-22's three committed non-frozen deliverables; the baseline (`40616b9`, frozen
21 Aug) lags landed work — **the F-P25 conflation class per F-P39 ruling I, not a frozen surface
moving**. Re-freezing is deliberately NOT done: `freeze-baseline.sh` would overwrite the
custody-protected `baseline.json`. The re-record is the operator's call at the next sanctioned
checkpoint.

## REMAINING_RISK / HONEST BOUNDS
- **The composition root is unexecuted by tests** (journalEntryModuleInstance imports `electron`); the
  evidence function is extracted Electron-free and pinned against the real store, but the singleton
  wiring itself follows the F-P45 §19-item-6 posture: possible, not proven, flips on a real run —
  claiming otherwise would be the same error in new clothes.
- **Concurrency guarantee is event-loop-scoped** (one process, one thread; `requestSingleInstanceLock`);
  there is no multi-process CAS in a JSON substrate — stated, JSON_CONCURRENCY_LIMITATION carried.
- **The store gains no generic `updateIfRevision`**: the CAS lives in the post path's synchronous
  closure. A generic conditional-write API is a framework decision a future consumer should earn
  (NP-017: a field/API lands with the consumer that earns it).
- **Sibling posted-flags are OUT OF SCOPE and named**: `payrollRunModule.ts:388` stamps the payroll
  run's own row (its journal entries flow through the governed door via glPosting); other module
  lifecycle transitions remain ungoverned candidates for the same adapter pattern.
- **Posted-soft-delete debt** (§36) unchanged, recorded, not expanded here.
- Evidence rows for rows lacking a workspace id are keyed `''` (durable, honestly queryable under the
  empty key) — a namespace nothing currently reads; noted, not silently dropped.
- Rollback: revert the two modified files, delete the three new ones (no other file changed).

## STATUS
**CLOSED (TEST-VERIFIED).** EXTERNAL_EFFECT = 0 — no production journal entry was created; all writes
in tests hit temp dirs. The ceremony build is preserved (`out/` not rebuilt). NL-03 untouched.
