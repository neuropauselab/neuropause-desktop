# Phase I-A.3 — H-FINDING-4 Cohort-2B-ii Implementation Discrepancy (STOP)

**READ-ONLY report. No commit, no push. 2B-ii code implemented but a committed Cohort-2B-i TEST
assertion now fails — reporting per the gate rule "If any prerequisite requires one of the prohibited
changes, STOP and report the blocker rather than expanding scope."** Baseline HEAD `cc184d0`.

## The conflict `[PROVEN]`
The authorization's **Phase 4 explicitly requires** `contacts.update → DIFFICULT_TO_REVERSE`. Implementing
that makes `reversibilityForAction('contacts.update') === 'DIFFICULT_TO_REVERSE'`.

But the **committed Cohort-2B-i test** (locked at `cc184d0`) asserts the opposite:
`apps/desktop/src/main/cst/governedAction.cohort2b.test.ts:84-88`
```
it('Cohort-2B-ii remain IRREVERSIBLE-by-default (not classified here)', () => {
  for (const id of ['drive.upload', 'drive.restoreVersion', 'contacts.update']) {
    expect(reversibilityForAction(id)).toBe('IRREVERSIBLE');   // <- contacts.update now DIFFICULT_TO_REVERSE
  }
});
```
`drive.upload` / `drive.restoreVersion` still pass (they use the IRREVERSIBLE default, as authorized).
**Only the `contacts.update` element of that loop fails** — because the 2B-i gate wrote a forward-looking
assertion ("2B-ii not classified here") that the authorized 2B-ii work legitimately supersedes.

## Why this is a blocker (not something to code around) `[PROVEN]`
- The gate's DO-NOT list includes **"modify Cohort-2B-i."** `governedAction.cohort2b.test.ts` is a
  committed Cohort-2B-i artifact.
- I **cannot** satisfy both (a) the authorized classification `contacts.update → DIFFICULT_TO_REVERSE`
  and (b) the unmodified committed 2B-i assertion — they are mutually exclusive.
- Re-classifying `contacts.update → IRREVERSIBLE` to keep the 2B-i test green would **violate the
  explicit Phase-4 instruction** (and would be less honest — source proves no contacts version history).
- Therefore completing the authorized 2B-ii work **requires touching a prohibited surface** (one stale
  assertion in the 2B-i test). Per the gate, I STOP and report instead of editing it.

## Facts `[PROVEN]`
- No 2B-i PRODUCTION behavior/classification is affected: the 9 Cohort-2B-i actions remain REVERSIBLE and
  their governance/routing are unchanged (their own assertions still pass).
- The failing assertion is about **2B-ii's default**, not about any 2B-i action.
- 2B-ii's own suite is fully green: `governedAction.cohort2bii.test.ts` **31/31**. Full suite otherwise
  green: **8498 passed / 1 failed / 3 skipped** (the 1 failure is exactly this assertion). Typecheck clean.
- Frozen surfaces unchanged (CST kernel, durable store, sendTransition/governedSend, mail.ts, m365
  executor, actionSdk, worker surfaces, runtimeCore, contracts, storeScope, package.json, Node engine).

## Minimum resolution options
1. **RECOMMENDED — one-line update to the committed 2B-i test assertion** (`cohort2b.test.ts:84-88`):
   change the `contacts.update` expectation to `'DIFFICULT_TO_REVERSE'` (keeping drive.upload /
   drive.restoreVersion → `'IRREVERSIBLE'`), or split the loop. This changes **no** 2B-i production
   behavior or any 2B-i action's classification — it only corrects a stale forward-looking assertion the
   authorized 2B-ii work supersedes. Requires explicit authorization to touch a "Cohort-2B-i" surface.
2. Re-classify `contacts.update → IRREVERSIBLE` — **NOT recommended**: contradicts the explicit Phase-4
   instruction and is less honest (source proves no version history / no recovery).
3. Revert the 2B-ii work entirely — abandons the authorized gate.

## Recommendation
Authorize **Option 1** (the minimal 2B-i test-assertion correction). It is the honest, source-correct fix
and does not alter any 2B-i behavior. On authorization I will apply it, re-run full regression, produce
the 2B-ii implementation evidence, and stop at the review gate.

## Current working-tree state
Implemented (uncommitted): `cst/governedAction.ts` (+`GOVERNED_ACTION_COHORT2B_II`; +`contacts.update →
DIFFICULT_TO_REVERSE` in `ACTION_REVERSIBILITY`), `connectors/index.ts` (routing +2B-ii),
`cst/governedAction.cohort2bii.test.ts` (new, 31/31). No commit, no push, no frozen surface changed. The
2B-i test is **not** modified (left as committed, hence failing).

## STOP
Blocker reported. No 2B-i test edited, no commit, no push, no scope expansion. Awaiting an explicit
decision on the resolution.
