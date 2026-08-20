# F-N16-2 · AUTHORITY DETERMINATION — policyVersion, derived vs enforced
## The reconciliation slice's mandated first step. **CLASSIFIED. No implementation authorized; none written.**

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

**Status: SOURCE-PROVEN + TEST-VERIFIED (determination only).** Zero production code changed. Zero frozen touch.
NP-000 = HOLD unchanged.

---

## SOURCE — every real source, read from live code

| Source | What it is | Where |
|---|---|---|
| **Derived** | `deriveAuthority(capabilityId, target).policyVersion` — a single hardcoded branch: `capabilityId === 'mail.send' ? 'm365-send-policy-1' : null` | `liveBrain/executionGate.ts` |
| **Enforcing (send)** | the literal `policyVersion: 'm365-send-policy-1'` passed into `governedSend` | `connectors/index.ts` (FROZEN — read only) |
| **Enforcing (action)** | `const POLICY_VERSION = 'm365-action-policy-1'`, carried by every cohort action | `cst/governedAction.ts` (FROZEN — read only) |
| **Consumer of record** | the CST kernel | `@neuropause/cst` |
| **Prior ruling** | `boundDecisionClaim` DELIBERATELY EXCLUDES policyVersion (I-A3-STEP2-FINDING-1): *"the policy set is unversioned, so a policy-version field could only be a weaker (contract-level) substitute. NeuroPause must not represent weaker provenance as stronger."* | `cst/boundDecisionClaim.ts` |

## OBSERVATION — what the code actually does (all pinned in `authorityReconciliation.test.ts`, 10 tests)

1. **`policyVersion` is RECORDED, never COMPARED.** The kernel contains exactly ONE use of it, and it is string
   interpolation into an evidence label: `` scope: `${req.action}@${req.policyVersion}` ``. There is no
   comparison, no branch, no denial anywhere on it — pinned negatively (`req.policyVersion [!=]==` matches
   nothing). **It is not an enforcement predicate at all.**
2. **The complete catalog, measured (never a one-item fixture): 34 actions, 29 mutating.** Routes:
   `governedSend` 1 · `governedAction` 28 · unrouted 5.
3. **Every mutating action has a governed route.** The unrouted 5 are all READS — pinned. (An earlier draft of
   the probe assumed some mutating actions were ungoverned; measurement disproved it, and the corrected
   assertion now records the true property.)
4. `mail.send` is the ONLY action where derived and enforced agree.
5. All 28 `governedAction` cohort members: derived `null`, enforced `'m365-action-policy-1'`.

## COMPARISON — the shape of the disagreement

**The disagreement is UNIFORM and one-sided.** Pinned explicitly: there is **no action for which derived and
enforced both NAME a policy and the names differ**. Every disagreement is `null` (derived) vs named (enforced).

That distinction decides the classification. Two different names for one action would be a contradiction — two
parts of the system asserting incompatible facts. An absence versus a name is not a contradiction: it is one
side having nothing to say.

## CLASSIFICATION

**Not a genuine semantic conflict. Not two representations of one state. It is a MISSING SOURCE on the derived
side — over a field that is a recorded contract LABEL, not an authority predicate.**

Reasoning, in order:
- It cannot be a *semantic conflict*: a conflict requires two incompatible claims, and the derived side makes no
  claim for 28 of the 29 mutating actions — it returns `null`, which in this codebase's own vocabulary means "I
  have no source", not "the value is none".
- It cannot be *two representations of one state*: the two literals are not two spellings of one policy. They
  belong to two different governed adapters with different action sets, and each is the actual value carried by
  its own path.
- It is not an *architectural divergence*: no boundary is crossed wrongly, no layer reaches where it should not,
  and no authority decision consults the field. The prior ruling (I-A3-STEP2-FINDING-1) already established the
  architectural position — policyVersion is contract-level provenance and must not be represented as stronger.
- It **is a missing source**: `deriveAuthority` has no action→policy registry to consult, so it hardcodes the one
  case it knows and honestly answers `null` for the rest. The absence is truthful; it is simply incomplete.

**Which source is authoritative, per question:**

| Question | Authoritative source | Why |
|---|---|---|
| "Under which policy contract did this action actually execute?" | the **enforcing adapter's constant** | it is the value that reaches the kernel and is labelled into the evidence — the only one with a causal path to the record |
| "What policy version does a proposal claim?" | `deriveAuthority` | it is the proposal-side answer; `null` is honest where no source exists |
| "Was this action authorized?" | **NEITHER** | authorization is decided by the CST gauntlet (approval binding, scope, ceilings, expiry) and the S5.1 predicate; `policyVersion` participates in none of it |

## PROPOSED ACTION — the smallest possible governed correction (NOT applied; awaiting ruling)

**Do not normalize the two literals, and do not copy either vocabulary into the other.** Both are correct for
their own path, and merging them would manufacture a single policy identity that does not exist.

The smallest correction that removes the *appearance* of conflict without inventing anything:

1. **Document the field's real status at its definition** — `AuthorityRequirement.policyVersion` is a recorded
   contract label, `null` meaning "no source for this capability", explicitly NOT an authority input (citing
   I-A3-STEP2-FINDING-1 and the kernel's label-only use).
2. **Keep the observation pins** as the anti-drift guard (`authorityReconciliation.test.ts`), so a future third
   literal or a silent merge fails a test.
3. **RECORDED, NOT PROPOSED FOR NOW:** giving `deriveAuthority` a real action→policy source would require an
   action→policy registry that does not exist. Creating one is a design decision with its own ruling; inventing
   the mapping here would be exactly the invention the source-integrity rule forbids.

Item 1 touches `liveBrain/executionGate.ts` — a **GATE-class sensitive surface** — so even that comment change
is presented, not applied, if the operator wants it.

## TEST EVIDENCE

`capabilities/authorityReconciliation.test.ts` — **10 tests, all green.** DISCOVER (3): the derived source names
only mail.send; both enforcing literals exist in their own files; the kernel's single label-only use with a
negative pin against any comparison. COMPARE (7): the catalog is the real 34; mail.send is the only agreement;
all 28 cohort members are null-vs-named; **no action has two different named values**; the measured
distribution; every mutating action is governed; the unrouted are all reads.

Full main suite **870 files / 9107 passed / 3 skipped** · typecheck clean · lint clean · gate-detector PROCEED
on the one added file (run before it was written).

## GATE STATUS

None required for the determination (test-only, PROCEED-class). The proposed documentation change would be
GATE-class (`executionGate.ts`) and is **not applied**.

## COMMIT

This determination lands as its own commit, separate from FG-12 (which stays prepared and unapplied).

## REMAINING UNKNOWN

- Whether an action→policy registry should exist at all — a design question, unruled, deliberately unanswered.
- Whether the two policy literals should ever converge — they need not, and nothing today requires it.
- **F-N16-3 (reversibility) and F-N16-4 (oracle identity) are NOT yet examined.** Per the ruling, F-N16-3 begins
  only now that F-N16-2 is classified.
