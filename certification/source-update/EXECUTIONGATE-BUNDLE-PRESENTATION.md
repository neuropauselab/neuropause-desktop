# EXECUTIONGATE BUNDLE — TWO GATE-CLASS DIFFS, PRESENTED TOGETHER
## PRESENTED ONLY. **NOT APPLIED.** One bundle, one go. Ruled at the reconciliation slice's close (operator, 20 Aug 2026).

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

**File:** `apps/desktop/src/main/liveBrain/executionGate.ts` — **GATE-class sensitive surface**
(frozen-surfaces.json: "present to the operator before editing"). Not frozen — no FG token is required — but it
is present-before-editing class, which is why nothing here is applied.

**Two diffs, one file, one bundle.** Diff A came from F-N16-1 (deferred deliberately when that fix landed);
Diff B came from F-N16-2's classification. Neither changes behavior.

---

## DIFF A · Collapse the gate's inline certified-capability lambda onto the shared authority

**Origin:** F-N16-1. The per-action certification predicate existed as an inline lambda here plus a verbatim
copy in a test. NP-016's fix created ONE named authority in `liveCapabilitySources.ts` and deliberately did NOT
add a third copy; an ANTI-FORK pin currently holds this lambda against that named set. This diff completes the
collapse and retires the need for that pin's source-scan half.

```diff
@@ import block
 import type { AuthorityRequirement, VerificationPlan, ProposalTarget } from './proposal';
-import { mutationAssuranceFor } from '../capabilities/liveCapabilitySources';
+import { isCertifiedConsequentialCapability, mutationAssuranceFor } from '../capabilities/liveCapabilitySources';
 import { createLogger } from '../logger';
@@ l6ExecutionGate — execDeps
     authorityFor: deriveAuthority,
     oracleFor: deriveOracle,
-    isCertifiedConsequential: (c) => c === 'mail.send',
+    // ONE named authority — the same predicate discovery uses (F-N16-1). A
+    // second copy of this rule is how discovery and the boundary drifted apart.
+    isCertifiedConsequential: isCertifiedConsequentialCapability,
   };
```

**Behavior change: NONE.** `isCertifiedConsequentialCapability(id)` is `CERTIFIED_CONSEQUENTIAL_CAPABILITIES
.includes(id)` where that array is exactly `['mail.send']` — identical to the lambda for every input, today and
by construction. The import path already exists in this file (`mutationAssuranceFor` comes from the same
module), so no new dependency direction is introduced.

**Threat analysis.** *If applied:* the boundary's certification answer becomes sourced from the same named set
discovery uses, so the two cannot silently diverge again — the failure mode F-N16-1 was. Risk: a future edit to
that array now changes BOTH discovery and the boundary at once. That is the intended coupling (they must agree),
and adding a capability to it already requires a live certified chain by the array's documented entry rule.
*If NOT applied:* two copies of one rule persist; the anti-fork pin catches drift only if someone runs the
suite, and the pin is a source-scan, which is weaker than sharing the value.

**Test impact:** the ANTI-FORK pin in `capabilityRecord.test.ts` asserts the lambda's source text
(`/isCertifiedConsequential:\s*\(c\)\s*=>\s*c === 'mail\.send'/`). **It will fail by design** and must be
updated in the same bracket to assert the import instead — the pin flipping is the acceptance test, exactly as
it was for F-N16-1.

---

## DIFF B · State what `policyVersion` actually is, at the derivation that produces it

**Origin:** F-N16-2's classification — the field is a recorded contract LABEL, not an authority input, and the
apparent "derived vs enforced conflict" is a missing source over that label. No normalization: the two literals
stay exactly as they are.

```diff
@@ deriveAuthority
 export function deriveAuthority(capabilityId: string, target: ProposalTarget): AuthorityRequirement {
   return {
     requiresApproval: true,
     governanceStatus: mutationAssuranceFor(target.connector),
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
   };
 }
```

**Behavior change: NONE.** Comment only — not one byte of expression changes.

**Threat analysis.** *If applied:* the next reader of this line learns what the value is and is not, at the
place they will read it, which is where the misreading (as an authority input) would otherwise start. No
runtime risk. *If NOT applied:* the field keeps looking like an authority claim that disagrees with enforcement,
and the classification lives only in an evidence document that a future reader of this function may never open.

---

## Verification plan for the bracket (if the go is given)

1. Gate-detector on the path **before** the edit (standing law).
2. Apply BOTH diffs in ONE commit (they touch one file; splitting would leave the anti-fork pin red between
   commits).
3. Update the ANTI-FORK pin in the same commit to assert the shared import.
4. Behavioral proof that Diff A changed nothing: `capabilities/` suite (208+), `liveBrain/` suite,
   `constitutionalInvariants.test.ts` (RULE-002/003 drive this exact predicate), and the F-N16-1 end-to-end
   discovery pins — all unmodified except the one anti-fork assertion.
5. Full main suite + UI suite.
6. Freeze re-record + INTACT (the file is not frozen, but the whole-source baseline goes stale on any change).

## What this bundle deliberately does NOT contain

- No change to `mutationAssuranceFor`'s behavior or signature.
- No normalization of the two policy literals (ruled out).
- No action→policy registry (unruled; linked to S28).
- Nothing touching `deriveOracle`, the oracle identifiers, or reversibility — the F-N16-3/F-N16-4 findings
  produced no executionGate work.

**Awaiting: the operator's go. Neither diff is applied.**
