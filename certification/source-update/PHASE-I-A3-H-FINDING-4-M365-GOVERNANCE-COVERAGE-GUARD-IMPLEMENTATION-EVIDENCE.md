# Phase I-A.3 — H-FINDING-4 M365 Governance Coverage Guard — Implementation Evidence

**Status: IMPLEMENTED + VERIFIED — AWAITING FINAL REVIEW / COMMIT AUTHORIZATION. Not committed. Not pushed.**
Baseline HEAD `d2c9827` (parent `cc184d0`), branch `cert/data-import-cst-integration`.
Labels: `[PROVEN]` / `[PROVEN-ABSENT]` / `[INFERRED]` / `[DESIGN]` / `[OPEN]` / `[NOT PROVEN]`.

## 1. Starting HEAD `[PROVEN]`
`d2c9827308e52ea1123d827700064bcd9e05b226`. Branch `cert/data-import-cst-integration`. Chain:
`90527b4 → dc9e8f3 → 8846371 → cc184d0 → d2c9827`. Working tree was clean of tracked changes at start.

## 2. Exact file changed `[PROVEN]`
**One new test file only:** `apps/desktop/src/main/cst/m365GovernanceCoverage.test.ts` (untracked). **Zero
production files changed.** `git diff --name-only` (tracked) is blank; the only non-doc working-tree entry is the
new test.

## 3. Why the guard exists `[PROVEN]`
The IPC write handler (`connectors/index.ts:528`) routes `mail.send`→governedSend, cohort members→governedAction,
and **everything else → the ungoverned `m365.execute` fallback (`:596`)**. That fallback is not constrained by
`mutates:true`, so a future mutating action registered WITHOUT cohort membership would silently reach it and mutate
Graph without CST governance. This guard turns "every mutating M365 IPC action is governedSend(mail.send) XOR
exactly one governedAction cohort" into a checked, test-time regression invariant. It is **not** runtime
enforcement — it is an **M365 governance coverage regression invariant**.

## 4. Authoritative registry used `[PROVEN]`
The mutating universe is DERIVED from `ALL_M365_ACTIONS` (`connectors/m365/index.ts`) via
`ALL_M365_ACTIONS.filter(a => a.mutates)` — **no** re-listing of the 29 actions, so the guard cannot drift from the
registry. It checks that derived universe against the existing exported sets `GOVERNED_ACTION_COHORT1 / 2A / 2B_I /
2B_II` and the single `mail.send` governedSend literal (mirroring the handler's own `r.actionId === 'mail.send'`).
No second manually-maintained governance inventory is created.

## 5. Exact six invariants `[DESIGN]`/`[PROVEN]`
A pure `auditCoverage(actions, cohorts, sendId)` computes all violations; it is applied to the REAL registry (must
be clean) and to SYNTHETIC fixtures (each must be flagged):
1. **Exactly-one-cohort** — every `mutates:true` action except `mail.send` is in exactly one governedAction cohort
   (0 → ungoverned/fallback FAIL; >1 → FAIL).
2. **mail.send exception** — `mail.send` is `mutates:true`, governed by governedSend, and in **no** governedAction
   cohort.
3. **Read-only exclusion** — every `mutates:false` action is in **zero** cohorts.
4. **Registered-id** — every id in any cohort exists in `ALL_M365_ACTIONS` (no stale/unknown ids).
5. **No multi-cohort** — no id appears in >1 cohort (checked independently across raw sets, with offending labels).
6. **Complete accounting (authoritative)** — set-equality `{mutating} === {mail.send} ∪ {all cohort members}`
   derived from the registry (NOT a hardcoded count; counts asserted only as secondary diagnostics).

## 6. Current accounting result `[PROVEN]`
Set-equality holds. Secondary diagnostics at HEAD: **29** mutating · **28** governedAction cohort members · **1**
governedSend (`mail.send`) · **5** read-only · **0** ungoverned mutating IPC actions.

## 7. Test results `[PROVEN]`
- New guard `m365GovernanceCoverage.test.ts`: **12/12** (6 real-registry invariants + 6 synthetic
  future-regression scenarios A–E + a non-vacuous clean case).
- Required regression set (11 files): **207 passed** — new guard, Cohort-2B-ii, Cohort-2B-i, Cohort-2A,
  governedAction.negative, governedAction.durableRestart, sendTransition.negative, boundaryB,
  boundaryBEnforcement, storeScopeGate, durableIdempotencyStore.
- **Full main suite: 8511 passed / 3 skipped** (807 files; was 8499/806 at d2c9827 → **+12** new, no regression).
- UI suite: **24 files / 183 passed**.

## 8. Typecheck result `[PROVEN]`
`npm run typecheck` (node + web) — exit 0, clean.

## 9. Lint result `[PROVEN]`
`eslint apps/desktop/src/main/cst/m365GovernanceCoverage.test.ts --max-warnings 0` — exit 0, clean.

## 10. diff-check result `[PROVEN]`
`git diff --check` — clean.

## 11. Frozen-surface result `[PROVEN]`
No tracked file changed (blank `git diff --name-only`), so ALL frozen surfaces are unchanged: `@neuropause/cst`
(**1.3.0**), CST kernel, `durableIdempotencyStore.ts`, `sendTransition`/governedSend, `mail.ts`, m365 `executor.ts`,
`actionSdk.ts`, `drive.ts`, `contacts.ts`, `governedAction.ts`, `connectors/index.ts`, BoundDecisionClaim/mint,
ExecuteEngine/ExecutionSession/ExecutionStore, Boundary-B, worker router/runtime, `runtimeCore.ts`, `contracts.ts`,
`storeScope.ts`, `package.json`, Node engine (`>=20.11.0`). No new governance mechanism; no cohort membership
changed; no existing test modified.

## 12. NEUROPAUSE-FINAL result `[PROVEN]`
Untouched (read-only relationship unchanged; vendored CST 1.3.0). No merge, copy, or provenance change.

## 13. What the guard proves `[PROVEN]`
A **test-time coverage regression invariant** derived from the authoritative registry: at and after this change, the
suite FAILS if a mutating M365 action is registered without governedSend(mail.send) or exactly one governedAction
cohort, if a read-only action enters a cohort, if a cohort holds an unknown/stale id, if an action is in two
cohorts, or if `mail.send` is placed in a governedAction cohort. The synthetic A–E fixtures prove the invariant
logic actually catches each such future edit.

## 14. What the guard does NOT prove `[PROVEN-ABSENT]`/`[NOT PROVEN]`
NOT proven: runtime universal governance; worker/IPC governance equivalence; CST governance of the worker
(Boundary-B) ingress; provider idempotency; provider effect success; verification success; cross-process durability;
power-loss durability; renderer exclusion; universal NeuroPause OS governance. The guard does not change routing,
authority, decision contracts, or the CST kernel, and does not enforce at runtime. Residual `[OPEN, minor]`: the
guard proves cohort-set completeness (which the routing predicate consumes) but does not itself re-assert that the
IPC handler's `if` references all four sets (true and stable at HEAD; optional future strengthening).

## 15. Certification boundary
> "The M365 governance coverage guard establishes a test-time regression invariant derived from the authoritative
> ALL_M365_ACTIONS registry: every mutating IPC action is accounted for either by the special governedSend mail.send
> path or exactly one governedAction cohort, while read-only actions and unknown/overlapping cohort membership are
> rejected by the invariant. It does not establish runtime, universal, or cross-ingress governance, and does not
> claim that all future M365 actions are automatically governed — only that the suite fails if coverage is broken."

Do not read this as "all future M365 actions are automatically governed." **IMPLEMENTED ≠ VERIFIED ≠ CERTIFIED ≠
UNIVERSAL. AUTHORITY ≠ DECISION ≠ ADMISSION ≠ EXECUTION ≠ EFFECT ≠ VERIFICATION ≠ CERTIFICATION.**

## 16. Remaining gaps `[OPEN]`
- Worker-ingress CST parity — the worker path (`runtimeCore.ts:2509`, Boundary-B) remains a separate, non-CST stack
  (larger design gate; touches frozen surfaces).
- The optional handler-predicate linkage assertion (§14 residual) — deferred.
- Unchanged prior: cross-process atomicity, power-loss/fsync durability, provider idempotency, effect success,
  verification success, renderer exclusion, universal governance — none opened here.

## STOP
Implemented (one new test); tests/typecheck/lint/diff-check run fresh; frozen surfaces unchanged; evidence written.
**No commit. No push. No amend. No next gate.**
