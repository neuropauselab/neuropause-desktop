# F-P8 · REJECT LOCALLY WHAT THE PROVIDER WILL REJECT ANYWAY — GATE-CLASS ENVELOPE

**STATUS: APPLIED 22 Aug 2026** under GATE-class choreography — detector before, INTACT both sides, isolated
commit, full suites. `executionGate.ts` only, one hunk, zero frozen surfaces. **FG-16 stays FREE.**

**THREE RULINGS FOLDED IN BEFORE APPLICATION:** the reason **`MALFORMED_REQUEST`** approved, with the
reason/detail split stated in the docstring — **a reason names the QUESTION for an auditor, a detail names the
FIELD for a developer**; the **detail guard pinned** — *no request-derived text in the detail, ever* (F-P26:
`redactCredentialText` preserves email shapes, so a leaked address **would look protected and would not be**);
and the two remaining propose-lane rules held back **on different grounds**, recorded in-code so a later reader
does not complete the transfer — **address format because a format check can be wrong in the costly direction**
(*reject locally only where local rejection cannot be wrong*), **MAX_RECIPIENTS because it is product policy, not
a provider requirement.**

**OUTCOME: 888 files / 9286 passed / 5 skipped** vs 887 / 9278 / 5 — **delta exactly the 8 new pins, ZERO existing
tests changed result.** Typecheck 0, lint 0.

*(The sections below are the envelope as presented, preserved.)*

---

## 1 · SCOPE — ONE RULE, AND DELIBERATELY ONLY ONE

**IN SCOPE: at least one recipient.** **NOT "exactly one" — at least one.**

**THE CONSUMER IS GRAPH, WHICH REQUIRES IT.** `to: []` produces a malformed request that only Graph rejects, so
the product **makes an external call to Microsoft for a request that cannot succeed.**

**IN-REPO PROVENANCE — the standard is not invented [CURRENT SOURCE]:** `m365ActionProposal.ts:104` already
declares **`'at least one recipient is required'`**, alongside an address-format check (`:101`) and a
`MAX_RECIPIENTS` cap (`:105`). **All three live on the PROPOSE path and none on the EXECUTE path** — F-P8's own
shape in miniature. This envelope moves **one** of the three, the one with an unambiguous provider requirement
behind it.

**OUT OF SCOPE, each for a stated reason:**
- **Subject** — Graph accepts a missing subject. **No validity requirement exists**, so the `'(no subject)'`
  default stays untouched.
- **Body content** — **NOT-YET-ESTABLISHED, awaiting a consumer.** Nothing in the system requires a body to be
  anything.
- **Address format and recipient cap** — real rules on the propose path, but **not presented here**: neither is a
  provider *requirement* in the same unambiguous sense, and each deserves its own justification rather than
  riding along on this one.

> **THIS IS NARROWER THAN THE PREVIOUS SCOPING AND BETTER FOUNDED.** The earlier version borrowed a limit from a
> consumer that **could not process**, not from one that **required** — *the oracle does not require one
> recipient, it can only handle one* (§5.0g). **This rule refuses only what no consumer could ever accept.**

## 2 · WHY THE REFUSAL IS GOVERNANCE-CLASS, AND WHY IT CANNOT SIT LOWER

**A malformed request means THE SYSTEM DECLINED TO ACT: governance DENY · execution `NOT_STARTED` · verification
`NOT_APPLICABLE`.** Nothing was attempted, so nothing failed.

**`m365/mail.ts` and `m365/actionSdk.ts` are excluded — and not merely because they are late.** They run inside
`action.run` (`sendTransition.ts:273`), so a throw there becomes `ActionInputError` → **EXECUTION_FAILED**, and
**§2 #19 forbids converting a governance DENY into an execution failure.** A refusal placed there would be
correctly *timed* and **wrongly *classified*** — the evidence would say the send was attempted and failed, which
is false. **The defaulting lives there; the enforcement cannot.**

`connectors/index.ts` and `cst/sendTransition.ts` are also pre-execution but **FROZEN**. `contracts.ts` is FROZEN
and a schema failure mints **no ActionRecord at all**. `m365ActionProposal.ts` covers only the propose path and
therefore cannot enforce on a direct execute — which is precisely the gap.

**`executionGate.ts` (GATE) is the only site that is pre-execution, non-frozen, and already governance-class.**

## 3 · IT INHERITS ROUTE A's EVIDENCE

`emitGovernance('DENY')` already exists in the gate and already mints `DENY` · `NOT_STARTED` · no verification,
keyed by the workspace id, best-effort. **The refusal is auditable the moment it exists — nothing new is built for
it.** Pinned, not assumed (pin 4).

## 4 · THE REASON — PROPOSED, FOR THE OPERATOR TO RULE

**The test (§5.0g): what question does this name answer?** This one answers **"is this a well-formed request?"** —
which is neither `IDENTITY_UNRESOLVED`'s question (*was the precondition for asking about the proposal met?*) nor
any of the proposal-boundary seven (*why was this proposal rejected?*). **A third question, therefore a third
name.**

**PROPOSED: `MALFORMED_REQUEST`, with the offending field named in `detail`.**

```ts
data: { outcome: 'DENIED', reason: 'MALFORMED_REQUEST', detail: 'at least one recipient is required' }
```

`ConnectorWriteResult.data` is `Record<string, string | number | boolean | null>` — **open, so the detail needs no
contract change.**

**WHY THIS SHAPE:** the **reason names the QUESTION** and the **detail names the FIELD**, so a second
well-formedness rule (address format, recipient cap) extends the detail rather than multiplying the vocabulary —
avoiding a reason-per-defect explosion that would make the enum a list of symptoms. **And the detail string is
copied VERBATIM from `m365ActionProposal.ts:104`, so the two lanes say the same sentence in the same words** —
which is the smallest possible repair to *the validating path and the serving path are different paths*.

**THE ALTERNATIVE, STATED FAIRLY: `NO_RECIPIENT`.** More precise at the point of reading and self-describing
without a detail. Its cost is a per-field vocabulary that grows one entry per rule, and the corpus precedent runs
the other way — `IDENTITY_UNRESOLVED` names a *condition*, not a field. **Worker's recommendation:
`MALFORMED_REQUEST` + detail. The operator rules; nothing is applied until then.**

## 5 · THE DIFF, VERBATIM

```diff
   if (tenantId === '') {
     log.warn(`L6-GATE REFUSE capability=${r.actionId} — IDENTITY_UNRESOLVED (no workspace resolved)`);
     emitGovernance('DENY');
     return { ok: false, refusal: { ok: false, message: 'L6 execution gate refused', data: { outcome: 'DENIED', reason: 'IDENTITY_UNRESOLVED' } } };
   }
+  /**
+   * F-P8 (scoped) — REJECT LOCALLY WHAT THE PROVIDER WILL REJECT ANYWAY.
+   *
+   * A send with no recipient is a MALFORMED REQUEST: Graph requires at least one, so dispatching it means
+   * making an external call to Microsoft for something that cannot succeed. The refusal is GOVERNANCE-CLASS —
+   * the system declined to act, execution NOT_STARTED — and never an execution failure, because nothing was
+   * attempted (§2 #19).
+   *
+   * AT LEAST ONE, NEVER EXACTLY ONE. The read-back oracle can only corroborate a single-recipient send, but
+   * that is a CAPABILITY LIMIT, NOT A REQUIREMENT (§5.0g): a two-recipient email is a perfectly good email, and
+   * refusing it would make the user pay for our verifier's incompleteness. Multi-recipient sends PROCEED here
+   * and are simply unverifiable — which is F-P55's subject, not this rule's.
+   *
+   * SUBJECT IS NOT CHECKED: Graph accepts a missing one, so there is no validity requirement to enforce.
+   * BODY IS NOT CHECKED: no consumer defines what a valid body is (F-P8's out-of-scope half).
+   *
+   * The detail is VERBATIM from `m365ActionProposal.ts:104`, so the propose lane and the execute lane state the
+   * same rule in the same words instead of drifting into two phrasings of one requirement.
+   */
+  const to = r.params.to;
+  if (!Array.isArray(to) || to.filter((a) => typeof a === 'string' && a.trim() !== '').length === 0) {
+    log.warn(`L6-GATE REFUSE capability=${r.actionId} — MALFORMED_REQUEST (no recipient)`);
+    emitGovernance('DENY');
+    return { ok: false, refusal: { ok: false, message: 'L6 execution gate refused', data: { outcome: 'DENIED', reason: 'MALFORMED_REQUEST', detail: 'at least one recipient is required' } } };
+  }
   const gate = gateL6Execution({ tenantId, capabilityId: r.actionId, account: r.accountId, params: r.params }, execDeps);
```

**One hunk, one file.** Placed after the identity check (an unresolved identity is the earlier failure) and before
the proposal lookup. **The `??` is untouched; `skip` is not rewritten; nothing else in the gate moves.**

*Note the whitespace-only case is included deliberately: `to: ['   ']` is as unsendable as `to: []`, and Graph
rejects both. Excluding it would leave the rule true in letter and useless in fact.*

## 6 · THE PINS — CONSUMER-DERIVED (§2 #27). DEFINED HERE, NONE WRITTEN.

1. **`to: []` → REFUSE**, and the send does not proceed.
2. **one recipient → PROCEEDS** (unchanged).
3. **TWO RECIPIENTS → PROCEED. THIS IS THE REGRESSION GUARD FOR THE CORRECTION ABOVE AND IT MUST NOT REFUSE.**
   Derived from the *user's* legitimate case, not from the gate's branch: a two-recipient email is valid, and the
   oracle's narrowness must never leak into an admission decision.
4. **the refusal mints Route A's governance row** — `DENY` · `NOT_STARTED` · no verification.
5. **a throwing store does not change the decision** — evidence is best-effort; refusal is not.
6. **existing counts unchanged except the new pins** — measured, as at `39c551b`.

*(Pin 3 is the one that would have caught the superseded scoping, which is why it is written as a guard rather
than as a case.)*

## 7 · WHAT IT DOES NOT DO

- **Does not validate content.** No body rule, no length rule, no placeholder detection.
- **Does not enforce a subject.** The `'(no subject)'` default is untouched.
- **Does not make unverifiable sends refuse.** Multi-recipient and subjectless sends proceed exactly as today —
  **F-P55 remains open and is not narrowed by this.**
- **Does not close F-P8.** It closes the malformed-request half; the content half stays NOT-YET-ESTABLISHED.
- Does not touch `productionWired`, F-P45's migration, F-P54, or any frozen surface.
