# PHASE D — NEGATIVE-CONTROL ACCEPTANCE MATRIX (governed Data IMPORT)

**Suite:** `apps/desktop/src/main/cst/importTransition.negative.test.ts`
**Result:** 13 passed · **1 failing on purpose** (a genuine finding, F-1, left red).
**Nothing committed. Frozen CST package unmodified. Scope not broadened.**
Every mutation-sensitive control shows PRE-STATE → VERDICT → EFFECT/NO-EFFECT →
POST-STATE on a real `EnterpriseRecordStore` (integration) or a spy effect over a
measurable destination (kernel boundary, where the guard is mutation-proven).

## Acceptance matrix

| # | Negative control | Required result | Status | Evidence (verdict · effect · post-state) |
|---|---|---|---|---|
| 1 | Unauthorized request | Refused; no mutation | **PASS** (mutation-proven) | DENY `AUTHORIZATION_FAILURE`; effectRuns 0; dest 0. Guard off ⇒ effectRuns 1, dest 1 |
| 2 | HOLD verdict | No mutation | **PASS** | C3 w/o approval → HOLD `APPROVAL_REQUIRED`; executed false; dest 0 |
| 3 | DENY verdict | No mutation | **PASS** | tenant-isolation DENY + approval-scope DENY; dest 0 both |
| 4 | Duplicate / replay | No second effect | **PASS** | replay: `duplicateSuppressed` true, executed false, effectRuns 0, its dest 0 (first run wrote 1) |
| 5 | Stale pre-state | Block/revalidate; no unsafe exec | **PASS** | observed v99 ≠ req v1 → HOLD `STALE_RESOURCE_VERSION`; executed false; dest 0 |
| 6 | Unobservable state | UNKNOWN, never VERIFIED | **PASS** | integration: HOLD `OUTCOME_UNKNOWN`, verification UNKNOWN; kernel: observe→null → UNKNOWN. Never VERIFIED |
| 7 | Failed execution | Never VERIFIED | **PASS** (reported-failure) | non-accepted effect + unchanged post-state → `VERIFIED_FAILURE`, not VERIFIED_SUCCESS. **But see F-1** |
| 8 | Post-state mismatch | DEVIATION, not success | **PASS** | readBack denies writes → verification DEVIATION; `deviation` non-null; not VERIFIED |
| 9 | Recovery | Recovery itself governed | **PASS** (mutation-proven) | guard off ⇒ `RECOVERY_UNGOVERNED`, effect ran ungoverned (the bypass); guard on ⇒ ALLOW, claimed true, governed |
| 10 | Evidence failure | Not represented as complete | **PARTIAL** | distinctness proven (EVIDENCED is a separate populated field); an *injected evidence-write failure* path is **CONTROL NOT TESTED** here |
| 11 | C3 approval absent | Refused where C3 applies | **PASS** (kernel) | C3 + no approval → HOLD `APPROVAL_REQUIRED`; dest 0. (Via the adapter, C3 only arises when a high-risk table is *approved* — implicated in F-1) |
| 12 | Low-risk C1 path | Must not require C3 approval | **PASS** | C1 import → ALLOW reason `OK` (not APPROVAL_REQUIRED), executed true, 2 records written |
| — | SEEN≠CLAIMED≠AUTHORIZED≠EXECUTED≠EFFECT_CONFIRMED≠VERIFIED≠EVIDENCED | Independently observable | **PASS** | success keeps `claimed`/`executed`/`verification`/evidence as distinct fields; a HOLD shows executed false, verification NOT_APPLICABLE, dest 0 |

Legend: PASS = required result observed · PARTIAL = one facet proven, another not
tested · CONTROL NOT TESTED ≠ pass · NOT APPLICABLE = does not apply.

## F-1 — GENUINE FINDING (the failing test, left red)

**Observed:** an import that writes **nothing** because its only table is
high-risk and **unapproved** is reported `verification: VERIFIED`,
`outcomeClass: VERIFIED_SUCCESS`, `wrote: 0`, `status: nothing_imported`.
A no-op / content-refused import is dressed as success.

**Root cause (two coupled causes in the adapter, not the kernel):**
1. `expectedPostState = { allWrittenRecordsPresent: true }` is satisfied
   **vacuously** when zero records are written — a no-op verifies as success.
2. `approvedHighRisk` keys on *approved* high-risk tables, so an **un**approved
   high-risk table downgrades the transition to **C1** (no approval required),
   the kernel ALLOWs, `applyImportPlan` skips the unapproved table, and the
   vacuous postcondition verifies the empty result.

**Why it matters:** it collapses "refused / did nothing" into VERIFIED_SUCCESS —
exactly the SEEN-vs-VERIFIED / attempt-vs-outcome distinction this integration
exists to preserve.

**Proposed fix (REPORTED, NOT APPLIED — awaiting your go-ahead; would touch only
`main/cst/importTransition.ts`, no scope broadening):**
- Consequence is **C3 whenever the plan CONTAINS a high-risk table**, not only
  when one is approved ⇒ an unapproved high-risk import becomes C3 → HOLD
  `APPROVAL_REQUIRED` (refused), never a vacuous success.
- Strengthen `expectedPostState` so a **zero-write** import is not vacuously
  VERIFIED (e.g. carry the intended write count, or an explicit
  `importAccomplished` predicate tied to `result.status !== 'nothing_imported'`
  and the effect's acceptance), so nothing-imported ⇒ not VERIFIED_SUCCESS.
- Add the corresponding negative control asserting an unapproved-high-risk import
  HOLDs and a no-op import is not VERIFIED_SUCCESS.

**Discipline note:** per the Phase-D instruction, FAIL remains FAIL until its
cause is understood; the implementation was **not** modified to make the matrix
green. The fix is proposed here and awaits approval before Phase E.

## Also open (honest)
- #10 injected-evidence-failure path: not tested → not claimed.
- Durable cross-run CST claim/idempotency: **not established** (in-memory,
  per-invocation) — unchanged from Phase C disclosure; the durable row-level
  `externalKey` dedup inside the effect is a different mechanism.

---

# PHASE D-R1 — CORRECTIVE RERUN (F-1 fix applied, adapter-only)

**Change:** `apps/desktop/src/main/cst/importTransition.ts` only (kernel untouched).
1. **C3 by presence** — `hasHighRisk = plan contains a table with requiresApproval`;
   consequence `C3` whenever high-risk data is in the submitted plan, regardless of
   approval. Approval is supplied ONLY when every high-risk table is approved ⇒ an
   unapproved high-risk import reaches the kernel as C3 without approval ⇒ HOLD.
2. **Non-vacuous verification + VERIFIED_NOOP** — `expectedPostState` is
   `{ importResolved: true }`, and the observation returns `{ importResolved: false }`
   when a reported write is not present OR the run reported failure; the adapter
   refines the kernel's `VERIFIED_SUCCESS` into `VERIFIED_SUCCESS` (≥1 record
   written) vs `VERIFIED_NOOP` (authorized, 0 written, 0 failed).

**F-1 negative controls (rerun): 19/19 PASS.** The originally-failing control now
passes for the RIGHT reason (unapproved high-risk HOLDs), and the distinctions hold:

| Case | Result | Evidence |
|---|---|---|
| F1-A high-risk PRESENT + unapproved | HOLD `APPROVAL_REQUIRED`, effect 0, dest 0 | consequence C3 by presence |
| F1-B high-risk + approved | ALLOW → executed → `VERIFIED_SUCCESS`, records written | approval supplied |
| F1-C authorized re-import (nothing to change) | `VERIFIED_NOOP` (not SUCCESS, not FAILURE), no duplicate | legitimate no-op |
| F1-D unauthorized high-risk zero-write | never VERIFIED (`HOLD`) | the F-1 regression, now fixed |
| F1-E/F reported writes not present | not `VERIFIED_SUCCESS` → DEVIATION/FAILURE | non-vacuous |
| #10 evidence-persistence failure | transition NOT represented as complete (rejects) | tested (was PARTIAL) |

Updated matrix vs D initial: control #7 no longer has the F-1 hole; control #10 is
now **TESTED** (not PARTIAL). All controls PASS.

## CONSEQUENCE TO REPORT — 2 existing wiring tests now fail (behaviour change)

The F-1 correction changes observable `dp:import` behaviour: an **unapproved
high-risk** import now **HOLDs (refused)** instead of silently skipping and
returning `nothing_imported`. Two pre-existing tests encoded the OLD behaviour:

- `dataPlane/wiring.test.ts` — "does not demand approve rights when nothing
  high-risk is approved" (imports `Customers` unapproved, expects `nothing_imported`).
- `dataPlane/wiring.test.ts` — "emits nothing when nothing was imported"
  (imports `Customers` with empty approvals, expects `onImported` not called).

Both submit a **high-risk table unapproved** → per F1-A/F1-D they now HOLD, so the
handler throws rather than returning a skip result. These tests document exactly
the behaviour F-1 corrects.

**Open scope question (not decided unilaterally):** with C3-by-presence, ANY
unapproved high-risk table in a plan HOLDs the WHOLE import — including approved
low-risk tables in the same file. Is that the intended scope (whole-transition
HOLD, per your "high-risk + no approval → NO EFFECT"), or should a mixed plan
still import the approved low-risk tables and refuse only the high-risk one?

**Decision needed before Phase E:**
(a) update the two existing wiring tests to the corrected HOLD behaviour (touches
    existing data-plane tests — reporting first, per the discipline); and/or
(b) refine the C3 trigger to the requested writes so a mixed plan imports approved
    low-risk and refuses only high-risk.

Full data-plane + cst suites: **235 passed, 2 failed** (the two above). Frozen
baseline source (NEUROPAUSE-FINAL) UNMODIFIED. Nothing committed. Phase E remains
blocked.

---

# PHASE D-R2 — TEST UPDATES + MIXED-PLAN CONTROLS (invariant frozen)

**Decision applied:** (a) the two legacy wiring tests updated to the corrected
governance; (b) whole-transition HOLD for mixed plans frozen as v1 semantics.
See `C3-TRANSITION-INTEGRITY-INVARIANT.md`. Implementation change since R1: none
to the adapter — R2 is test-and-invariant work plus the two wiring-test updates.

## What changed in R2
- `dataPlane/wiring.test.ts` — the two tests that asserted the OLD silent-skip
  behaviour now assert the invariant they were exposing the absence of:
  - *"an unapproved high-risk table HOLDs the whole transition — no effect"*:
    `rejects APPROVAL_REQUIRED`; `crm-customers` store unchanged.
  - *"emits nothing when nothing was imported"* → high-risk, no approval →
    `rejects APPROVAL_REQUIRED`; `onImported` NOT called; destination unchanged.
  These assert the actual contract (thrown CST reason + destination unchanged),
  not merely a changed status string.
- `importTransition.negative.test.ts` — added the atomic-boundary controls:
  - **MIXED-A**: plan with a high-risk (unapproved) + low-risk (approved) table →
    HOLD `APPROVAL_REQUIRED`, executed false, **both** stores unchanged (no
    partial execution).
  - **MIXED-B**: same plan, all approvals present → ALLOW, executed, VERIFIED_SUCCESS,
    **every** table's records land (C3 is not a permanent blocker).

## R2 acceptance criteria — all demonstrated

| Criterion | Result |
|---|---|
| C3 by presence | ✓ (F1-A, MIXED-A) |
| Missing approval ⇒ HOLD | ✓ APPROVAL_REQUIRED |
| No effect (effectRuns 0, destination unchanged) | ✓ (F1-A/D, MIXED-A, wiring) |
| Mixed plan, one unapproved C3 ⇒ whole transition HOLD | ✓ MIXED-A (both stores 0) |
| Authorized mixed plan ⇒ complete transition allowed | ✓ MIXED-B (all stores > 0) |
| Authorized genuine no-op ⇒ VERIFIED_NOOP | ✓ F1-C |
| Non-vacuous verification (expected effect absent ⇒ not SUCCESS) | ✓ F1-E/F, D |
| Evidence-persistence failure ⇒ not fully evidenced | ✓ control #10 (rejects) |

## Regression (the complete relevant suite)
- Negative controls (`importTransition.negative.test.ts`): **21/21 PASS**.
- CST + data-plane suites: **239/239 PASS** (11 files).
- **Full desktop main suite: 792 files PASS** (incl. the `productJourney` E2E
  that imports through `dp:import`).
- TypeScript node typecheck: clean.
- FROZEN BASELINE SOURCE UNMODIFIED (NEUROPAUSE-FINAL, 28 files) — integration
  changes are confined to the declared Desktop working-tree footprint; vendored
  kernel hash `293d0560…ceb431`;
  installed `kernel.js` byte-identical to the extracted frozen copy. Nothing
  committed. Backup tag `pre-final-source-update-20260815-154001` intact.

## Assurance statement (scoped, per discipline)
The selected Data Import transition passed the declared Phase D negative-control
and regression suite **within the tested control scope** (the reference fixtures
and modules exercised here; single host; in-process kernel stores). This is a
TEST PASS within scope — it does not establish universal assurance, detection
completeness, durable cross-run idempotency, multi-host ownership, or coverage of
Desktop transitions other than Data Import.

## Phase D history (preserved — not rewritten)
```
PHASE D INITIAL   19/19 controls · F-1 FOUND · 2 legacy wiring tests exposed
PHASE D-R1        F-1 corrected (adapter-only) · 19/19 controls PASS · 2 tests FAIL (old semantics)
PHASE D-R2        wiring tests updated to intended semantics · +2 mixed-plan controls
                  21/21 controls PASS · 239/239 dp+cst · 792 files full suite PASS
```
**Phase D CLOSED (pending your review). Phase E remains BLOCKED until you review this R2 result.**
