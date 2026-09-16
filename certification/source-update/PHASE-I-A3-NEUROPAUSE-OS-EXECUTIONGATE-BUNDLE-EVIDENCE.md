# EXECUTIONGATE BUNDLE — CLOSING EVIDENCE
## Two GATE-class diffs applied as ONE bundle on the operator's go. The reconciliation slice closes here.

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

**Status: TEST-VERIFIED.** Zero external effects; ceremony surfaces untouched; NP-000 = HOLD unchanged.

## The go, quoted verbatim (operator, 20 Aug 2026)

> BUNDLE GO — GRANTED. Apply both GATE-class diffs exactly as presented in EXECUTIONGATE-BUNDLE-PRESENTATION.md,
> one bundle, one commit:
> - Diff A, with the ANTI-FORK pin updated in the same bracket to assert the import — the pin flipping is the
>   acceptance test, exactly as it was for F-N16-1;
> - Diff B, comment-only, not one byte of expression.
> Six-step verification plan as written, full main, honesty scan, FREEZE INTACT, evidence quoting this go.
> "An unconsumed field is not a safe field, it is an unfalsifiable one" stays in the record as the slice's lesson.

Applied EXACTLY as presented — the diff below is the working-tree diff, not a restatement.

## The applied diff, verbatim

```diff
-import { mutationAssuranceFor } from '../capabilities/liveCapabilitySources';
+import { isCertifiedConsequentialCapability, mutationAssuranceFor } from '../capabilities/liveCapabilitySources';
@@ deriveAuthority
     requiredGate: 'human-confirm + CST admission',
+    /**
+     * A recorded CONTRACT LABEL — never an authority input (F-N16-2).
+     *
+     * `null` means "no source for this capability", not "no policy": there is
+     * no action→policy registry to consult, so only the one case with a known
+     * literal is named. The ENFORCING paths carry their own values
+     * (`connectors/index.ts` for the send path, `cst/governedAction.ts` for the
+     * cohorts) and those are authoritative for "under which contract did this
+     * execute" — this one answers only "what does the proposal claim".
+     *
+     * Nothing decides on it: the CST kernel's sole use interpolates it into an
+     * evidence label, never a comparison, and `boundDecisionClaim` deliberately
+     * excludes it (I-A3-STEP2-FINDING-1 — weaker provenance must not be
+     * represented as stronger). Pinned in `authorityReconciliation.test.ts`.
+     */
     policyVersion: capabilityId === 'mail.send' ? 'm365-send-policy-1' : null,
@@ l6ExecutionGate — execDeps
-    isCertifiedConsequential: (c) => c === 'mail.send',
+    // ONE named authority — the same predicate discovery uses (F-N16-1). A
+    // second copy of this rule is how discovery and the boundary drifted apart.
+    isCertifiedConsequential: isCertifiedConsequentialCapability,
```

Diff B is comment-only: **not one byte of expression changed** — visible in the diff above, where the
`policyVersion` line itself is context, not a change.

## The acceptance test — the pin flipped

The ANTI-FORK pin was a source-scan holding the gate's inline lambda against the named set. It now asserts the
**stronger** property, in the same bracket:

- the gate CONSUMES `isCertifiedConsequentialCapability` (assignment + import both pinned);
- the inline copy cannot return in any form (`isCertifiedConsequential: (c) =>` and `c === 'mail.send'` are both
  pinned ABSENT from the file);
- the one authority still answers exactly as before (`mail.send` true, `calendar.create` false).

There is now **one value, shared** — not two copies that happen to agree. That is what F-N16-1 could only watch
for, and what this bundle removes.

## Six-step verification plan — walked in order

| # | Step | Result |
|---|---|---|
| 1 | gate-detector on the path **BEFORE** the edit | `GATE apps/desktop/src/main/liveBrain/executionGate.ts — present to the operator before editing` — authorization existed (this doc's go); tree clean; FREEZE INTACT at the checkpoint |
| 2 | both diffs in ONE commit | done — one file, one commit, nothing else in it |
| 3 | ANTI-FORK pin updated in the same commit | done — flipped to assert the import (above) |
| 4 | behavioral proof Diff A changed nothing | `capabilities/` + `liveBrain/` + `constitutionalInvariants` → **29 files / 366 tests green**, every one unmodified except the single anti-fork assertion. RULE-002 and RULE-003 drive this exact predicate and are untouched |
| 5 | full main + UI | **main 871 files / 9128 passed / 3 skipped — IDENTICAL to the pre-bundle count**, which is itself the no-behavior-change proof; **UI 42 / 279** |
| 6 | freeze re-record + INTACT | recorded below |

Also: typecheck node clean · lint clean · **honesty scan 0 findings** (the diff now touches implementation, so
the earlier test-only review item does not arise).

## The precise claim (advisor review, adopted verbatim by operator ruling)

> **"The reconciliation slice changed the policy-consumption topology while preserving the certified behavioral
> baseline and frozen boundary."**

Each clause is evidenced above: *topology changed* — the certification predicate now has one home consumed by
both discovery and the boundary, and `policyVersion` is labelled at its point of production; *behavioral
baseline preserved* — full main 871/9128/3, identical to the pre-bundle count, with RULE-002/003 driving this
exact predicate unmodified; *frozen boundary preserved* — nothing frozen was touched by this bundle, and the
GATE-class file was edited only after the presented go.

## Why this closes the reconciliation slice

F-N16-1 tightened discovery to the boundary's answer but left two copies of the predicate, watched by a pin.
F-N16-2 classified the policyVersion disagreement as a missing source over a contract label and proposed only
that the field say what it is, where it is produced. Both remaining actions were GATE-class, so both waited and
travelled together. With the bundle applied: **the certification predicate has one home, and the one field most
likely to be misread as authority now says, at the point of production, that it is not.**

## The slice's lesson, recorded (operator's words)

> **"An unconsumed field is not a safe field, it is an unfalsifiable one."**

Two live reversibility values pointed in opposite directions for as long as they did precisely because nothing
read either one — *nothing could fail because nothing consumes it.* That is why F-N16-3's early-warning pins
exist, and why the reversibility MOVE RULE (ARCHITECTURE-MAPPING §0.2) fires the moment a consumer appears.

## What this bundle deliberately did NOT contain

No change to `mutationAssuranceFor`'s behavior or signature · no normalization of the two policy literals
(ruled out — merging them would manufacture a policy identity that does not exist) · no action→policy registry
(unruled, linked to S28) · nothing touching `deriveOracle`, the oracle identifiers, or reversibility.
