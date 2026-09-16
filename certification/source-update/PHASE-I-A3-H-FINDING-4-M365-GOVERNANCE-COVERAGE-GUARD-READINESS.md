# Phase I-A.3 — H-FINDING-4 M365 Governance Coverage Guard — Implementation Readiness (READ-ONLY)

**READ-ONLY design-readiness gate. No implementation, no production/test change, no frozen-surface change,
no stage, no commit, no push.** Baseline HEAD `d2c9827` (parent `cc184d0`), branch `cert/data-import-cst-integration`.
Labels: `[PROVEN]` / `[PROVEN-ABSENT]` / `[INFERRED]` / `[DESIGN]` / `[OPEN]` / `[NOT PROVEN]`.

---

## 1. Baseline repository state `[PROVEN]`
HEAD = `d2c9827308e52ea1123d827700064bcd9e05b226`. Branch = `cert/data-import-cst-integration`. Working tree:
0 tracked modifications, 0 staged. Untracked = 7 preserved certification docs (prior 6 + last gate's
NEXT-M365-COVERAGE-INVENTORY) — untouched. Chain: `90527b4 → dc9e8f3 → 8846371 → cc184d0 → d2c9827`.

## 2. Current 29/29 coverage proof `[PROVEN]`
`ALL_M365_ACTIONS` (`connectors/m365/index.ts:16`) = 34 actions: **29 `mutates:true`, 5 `mutates:false`**.
Governed: Cohort-1 =13, Cohort-2A =3, Cohort-2B-i =9, Cohort-2B-ii =3 → **28 governedAction**; `mail.send` →
**governedSend** (1) → **29/29** mutating IPC actions covered. Automated cross-check (prior gate, re-derivable):
`MUTATING NOT GOVERNED = NONE`, overlap `NONE`, stale/typo `NONE`, read-only-governed `NONE`. No Graph mutation
exists outside `connectors/m365/*` (registry is the sole effect surface).

## 3. Latent fallback regression `[PROVEN]` (mechanism) / `[OPEN]` (unguarded)
IPC handler (`connectors/index.ts:528`) routes: `mail.send`→governedSend (`:541`); `∈` any cohort→governedAction
(`:569-577`); **else → `m365.execute` fallback (`:596`)**. The fallback branch is **not** constrained by
`mutates:true`. `M365Executor.execute` will run any `mutates:true` action given `confirmed` (`executor.ts:101`).
Therefore a future mutating action added to `ALL_M365_ACTIONS` **without** cohort membership would silently reach
the ungoverned fallback and mutate Graph with only the executor's ownsAccount/confirmation/scope gate — **no CST
identity, admission, idempotency, restart durability, or denial-before-effect proof**. Live gap at HEAD = none
(29/29). Latent regression risk = real and currently unguarded.

## 4. Exact desired invariant `[DESIGN]`
> For every `a ∈ ALL_M365_ACTIONS` with `a.mutates === true`:
> &nbsp;&nbsp;`a.id === 'mail.send'` (⇒ governedSend, and `a.id ∉` every governedAction cohort)
> &nbsp;&nbsp;**XOR** `a.id ∈` **exactly one** of {Cohort-1, Cohort-2A, Cohort-2B-i, Cohort-2B-ii}.
>
> And: every `a.mutates === false` action is in **zero** governed cohorts and is **not** `mail.send`.
> And: every id in any governedAction cohort is a **registered** action (`∈ ALL_M365_ACTIONS`).

This is the smallest predicate that makes "a mutating action can never reach the ungoverned IPC fallback" a
checked property rather than a point-in-time observation.

## 5. Source-of-truth analysis `[PROVEN]`
- **One authoritative registry:** `ALL_M365_ACTIONS` (domain arrays concatenated). It is the single source for
  action ids + `mutates`. The guard **derives** the mutating list as `ALL_M365_ACTIONS.filter(a => a.mutates)` —
  it does **not** duplicate a manual action list, so it cannot drift from the registry. `[PROVEN]`
- **Cohort sets** are independently-maintained governance-assignment lists (`governedAction.ts`, exported
  `ReadonlySet<string>`). They are the *policy* the guard checks the registry against — intentionally separate.
- **`mail.send`/governedSend has no set** — it is a literal in the IPC handler (`index.ts:391,541`). The guard must
  encode `mail.send` as the one governedSend member via a literal. `[DESIGN]` This is the only value the guard
  hardcodes besides importing the cohort sets themselves.
- **Guard staleness direction is fail-closed** `[DESIGN]`: if a *future* fifth cohort (`COHORT2C`) is added to the
  handler but not to the guard's imported set-of-cohorts, its actions register 0 known memberships → guard FAILS →
  forces guard maintenance. A new mutating action with no cohort → guard FAILS. Both failure directions are safe
  (the guard errs toward flagging, never toward silently passing an ungoverned mutation).
- Residual `[OPEN, minor]`: the guard proves **set membership/completeness**, which the routing predicate consumes
  (`COHORT1.has||COHORT2A.has||COHORT2B_I.has||COHORT2B_II.has`), but does not itself re-prove the handler's `if`
  references all four sets. That linkage is true and stable at HEAD (verified prior gate). Optionally strengthenable
  (see §6) but not required to close the identified regression.

## 6. Candidate guard mechanisms `[DESIGN]`
| | Runtime behavior | Authority | Decision contract | CST kernel | Frozen surface | Prevents future regression | Detects missing cohort at test time | Can falsely certify worker gov. | Duplicate gov. mechanism | mail.send false-positive risk | Exactly-one-cohort |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **A. Test-only invariant** over registry + cohort sets | none | none | none | none | **none** | yes (CI fails) | **yes** | no | no | no (literal-exception handled) | yes |
| B. Production assertion at IPC routing/startup | **changes** (may throw) | none | none | none | touches `connectors/index.ts` (prod, not frozen) | yes (at runtime) | no (runtime, not test) | no | risk (2nd enforcement point) | possible | yes |
| C. Registry field (`governance` on `WriteAction`) | none | none | none | none | **touches `actionSdk.ts` (FROZEN)** + every registration | yes | yes | no | no | no | via field |
| D. Derived exported union set + type check | none | none | none | none | none | partial (still needs a test to assert completeness) | needs test | no | mild | no | needs test |

**Recommended: Option A — a single read-only regression test.** It is the smallest mechanism that actually closes
the §3 gap: it changes no runtime behavior, no authority, no decision contract, no CST kernel, and **no frozen
surface**; it fails CI the moment a mutating action lacks exactly-one governedAction cohort (or the mail.send
exception). Option C is rejected — `actionSdk.ts` is a frozen surface. Option B adds a second runtime enforcement
point (duplicate governance) and only fires at runtime, not at test/CI time. Option D still needs the same test.

## 7. Exact test design `[DESIGN]`
A new `describe` over `ALL_M365_ACTIONS` and the four imported cohort sets asserting:
1. **Accounting:** partition `ALL_M365_ACTIONS` by `mutates`; assert 29 mutating / 5 read-only (documents the
   current inventory; a count change forces a conscious update).
2. **Coverage (core):** for each mutating action, `membershipCount = [C1,C2A,C2B_I,C2B_II].filter(s => s.has(id)).length`;
   assert `id === 'mail.send' ? (membershipCount === 0) : (membershipCount === 1)`.
3. **mail.send exception:** assert `mail.send.mutates === true`, is **not** in any governedAction cohort, and is the
   governedSend member (literal).
4. **Read-only exclusion:** each `mutates:false` action has `membershipCount === 0` and is not `mail.send`.
5. **No unknown cohort ids:** every id across all four cohorts `∈` `new Set(ALL_M365_ACTIONS.map(a=>a.id))`.
6. **No multi-cohort:** union has no id appearing in >1 cohort (equivalently step-2's `=== 1`).

Automatic failure on future mistakes it must catch `[DESIGN]`:
- new mutating action without a cohort → step 2 (count 0) **fails**.
- mutating action in two cohorts → step 2/6 (count 2) **fails**.
- unknown/misspelled id in a cohort → step 5 **fails**.
- `mail.send` added to a governedAction cohort → step 3 **fails**.
- read-only action added to a cohort → step 4 **fails**.
- read/mutating count drift → step 1 **fails** (forces conscious re-baseline).

Optional (not required) strengthening `[OPEN]`: additionally assert the handler predicate references all four
sets — deferred, as it needs handler invocation/static analysis and adds cost beyond the identified gap.

## 8. Exact-one-cohort semantics `[DESIGN]`
`0 → FAIL`, `1 → VALID`, `>1 → FAIL`, evaluated over exactly {C1, C2A, C2B_I, C2B_II}. `mail.send` is excluded from
this count (its valid count is 0) and separately required in governedSend. Cleanly representable with the exported
`ReadonlySet.has` — confirmed `[PROVEN]` (sets are `ReadonlySet<string>`; registry entries carry `id`/`mutates`).

## 9. mail.send exception `[DESIGN]`
`mail.send` is `mutates:true` but governed by **governedSend**, not governedAction. The guard treats it as the sole
governedSend member (literal) and asserts it is absent from every governedAction cohort — so it neither fails
coverage nor is double-counted. Mirrors the handler's own `r.actionId === 'mail.send'` literal (`index.ts:541`);
if the send action were ever renamed, both the handler and this literal would need updating, and the guard would
flag a renamed-but-uncohorted mutating action — fail-closed.

## 10. Frozen-surface analysis `[PROVEN]`
Option A implements as **one new test file** that *imports* (reads) `ALL_M365_ACTIONS` and the cohort sets. Importing
is not modifying. **No** change to: `@neuropause/cst`/kernel, `durableIdempotencyStore.ts`, `sendTransition`/
governedSend, `mail.ts`, m365 `executor.ts`, `actionSdk.ts`, BoundDecisionClaim/mint, ExecuteEngine/ExecutionSession/
ExecutionStore, Boundary-B, worker router/runtime, `runtimeCore.ts`, `contracts.ts`, `storeScope.ts`, `package.json`,
Node engine. NEUROPAUSE-FINAL untouched. The recommended guard needs **no** frozen surface — gate does not STOP.

## 11. Certification implications `[PROVEN]` / `[DESIGN]`
The guard would establish a **future-regression invariant** (test/CI-time), not new runtime authority. Supported
claim `[DESIGN]`: *"At and after this commit, no mutating M365 action can be registered without governedSend or
exactly one governedAction cohort without failing the test suite; the 29/29 IPC mutating coverage is guarded against
silent regression."* It does **not** enforce at runtime, does not touch routing, does not add CST properties to the
fallback.

## 12. Certification semantics preserved (explicit) `[PROVEN-ABSENT]`
The guard does **not** establish: universal NeuroPause governance; worker/IPC governance equivalence; cross-ingress
CST equivalence; provider idempotency; effect success; verification success; cross-process durability; power-loss
durability. The worker ingress (`runtimeCore.ts:2509`, Boundary-B) remains a separate, non-CST stack and is out of
this guard's scope.

## 13. Remaining non-claims
NOT claimed: that the guard governs the worker ingress; that it makes governance universal or cross-ingress-uniform;
that it enforces at runtime; that it adds CST identity/admission/idempotency to the fallback; provider idempotency /
reversibility / effect success / verification success / cross-process / power-loss durability. Also NOT claimed: the
optional handler-predicate linkage (§5/§7 `[OPEN]`) — deferred. **IMPLEMENTED ≠ VERIFIED ≠ CERTIFIED ≠ UNIVERSAL.**

## 14. Implementation readiness `[DESIGN]`
**Decision: A. IMPLEMENTATION-READY.**
- **Exact files that would change (next gate):** exactly **one new test file**, e.g.
  `apps/desktop/src/main/cst/m365GovernanceCoverage.test.ts` (co-located with the governedAction cohort tests).
- **Production files that would remain untouched:** ALL — `connectors/index.ts`, `governedAction.ts`,
  `connectors/m365/*`, executor, everything. **No production code should change.**
- **Frozen surfaces protected:** all (see §10) — none touched.
- **Only a regression test is sufficient** to close the identified gap. `[DESIGN]`
- **Expected verification:** the new suite passes at HEAD (proving 29/29 + the six invariants), plus
  typecheck (node+web) clean, lint (new file, `--max-warnings 0`) clean, `git diff --check` clean, and the full
  main + UI suites unchanged (one new test file, +N tests, no regressions).
- **Commit boundary:** a single additive commit adding one test file (and, following the established per-gate
  convention, one evidence doc), e.g. `test(m365): guard 29/29 mutating-action governance coverage`. No production
  diff. Chain would extend `d2c9827 → [coverage-guard commit]`.

## 15. Proposed next implementation gate `[DESIGN]`
A scoped **implementation gate** that adds the Option-A guard test only: derive the mutating list from
`ALL_M365_ACTIONS`, assert the §7 six invariants (exactly-one-cohort + mail.send/governedSend exception + read-only
exclusion + registered-id + no-multi-cohort + accounting), run the required regression + typecheck + lint, write
one evidence doc, and STOP for commit authorization. No production change, no frozen surface, no worker-ingress
work, no runtime assertion.

## STOP
Design-readiness only. HEAD unchanged (`d2c9827`); 0 production/test files changed; exactly one new investigation
document; nothing staged, committed, or pushed; no frozen surface touched; NEUROPAUSE-FINAL untouched.
