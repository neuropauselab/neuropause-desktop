# F-N16-3 · REVERSIBILITY and F-N16-4 · ORACLE IDENTITY — DETERMINATIONS
## The reconciliation slice, findings 2 and 3. **CLASSIFIED. No implementation authorized; none written.**

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

**Status: SOURCE-PROVEN + TEST-VERIFIED (determinations only).** Zero production code changed. Zero frozen
touch. NP-000 = HOLD unchanged.

═══════════════════════════════════════════════════════════════════════════════

# F-N16-3 · REVERSIBILITY

## SOURCE

| Vocabulary | Values | Declared |
|---|---|---|
| **CST (five, UPPERCASE)** | `REVERSIBLE` · `PARTIALLY_REVERSIBLE` · `DIFFICULT_TO_REVERSE` · `IRREVERSIBLE` · `UNKNOWN` | `@neuropause/cst` types; carried as required `TransitionRequest.reversibility` |
| **Proposal (three, lowercase)** | `reversible` · `irreversible` · `unknown` | `liveBrain/proposal.ts` — declared INLINE, twice, with **no named type** |

**The CST vocabulary's ENTIRE documented semantics is one line:** *"NP-CST-16 — reversibility is separate from
consequence."* No per-value definition, no ordering, no predicate, no guidance on choosing a value exists in the
package. The proposal vocabulary has no definition at all.

**Producers.** CST side: `sendTransition` hardcodes `IRREVERSIBLE` for mail.send *with* an inline justification;
`importTransition` hardcodes `REVERSIBLE` for data.import with **no justification, no comment, no citation** —
the only unexplained constant in an object whose neighbours carry multi-line rationales; `governedAction` calls
`reversibilityForAction`, a 10-entry table over a **conservative default of `IRREVERSIBLE`**. Only those 10 are
claims — ~25 routed actions get the fallback. Proposal side: one production producer, `brainProposeLane`, which
hardcodes `'irreversible'` and **never imports the CST table**. `PARTIALLY_REVERSIBLE`, `UNKNOWN` and the
proposal-side `unknown` are produced nowhere.

## OBSERVATION — the decisive question has a clean negative answer

**No governance, authorization, admission, identity, or execution decision branches on reversibility in either
vocabulary, anywhere.** Pinned: the kernel never reads `req.reversibility`; no boundary, gate, or transition
file compares the value in either casing; it is absent from the idempotency key, so it touches neither action
identity nor admission.

**Stronger, and pinned by driving a real `governedSend`: the CST value never reaches durable evidence at all.**
The request carries `IRREVERSIBLE`; the outcome envelope — the closed "nothing is omitted" record — has no such
field, and `JSON.stringify(outcome)` does not contain the string. It is absent from the kernel's evidence entry,
absent from the S34a ActionRecord, and discarded when `kernel.run` returns.

> **Finding F-N16-3a (recorded, not fixed):** `governedAction.ts`'s own comment says the table changes "only the
> recorded reversibility class". **Nothing records it.** The comment is an overstatement of its own effect.

The single consumer of either vocabulary is a DISPLAY string: `toBrainReview` interpolates the proposal value
into the human-facing Risk row.

## COMPARISON — one dimension or two?

Same subject (can this effect be undone), **different grain** (CST is per-action-id and params-blind; proposal
is per-proposal), **different value spaces** (5 vs 3, with no proposal-side representative for
`PARTIALLY_REVERSIBLE` or `DIFFICULT_TO_REVERSE`), **no shared source, no mapping function, no consistency
check** — all pinned.

**They can diverge, and today they DO — pointing opposite ways.** `calendar.create` is `IRREVERSIBLE` on the CST
side and `'reversible'` on the proposal side. The disagreement is worse than a mismatch: the CST value is a
conservative default whose own comment **explicitly disclaims the claim** ("calendar.update's external
consequence depends on non-param-derivable server-side attendee state, so precise reversibility is NOT
claimed"), while the proposal value **asserts the opposite as a flat literal**. For `mail.send` the two agree —
but by two independent hardcodes plus a third in the lane, never by derivation.

**The divergence went unnoticed precisely because nothing consumes either value: nothing could fail.**

## CLASSIFICATION — two answers, because there are two questions

1. **The vocabulary question: SOURCE_REQUIRED.** ARCHITECTURE-SPEC places a reversibility slot in BOTH the §23
   capability record and the §28 proposal model — so the spec **sanctions two slots at two grains** — but it
   **defines no value space for either and states no relationship between them.** Per the ruling ("If the
   specification does not define the final vocabulary, SOURCE_REQUIRED stays SOURCE_REQUIRED — no invention"),
   the canonical vocabulary cannot be established from any available source. **No collapse is authorized, and
   none is proposed.**
2. **The `calendar.create` values: CONFLICTING.** Two live values for one action, pointing opposite ways, with
   no reconciling mechanism. The conflict is **descriptive, not functional** — nothing consumes either value —
   which is why it is a truth defect rather than a safety defect today. It stays CONFLICTING until evidence
   reconciles it.

## PROPOSED ACTION

**None authorized; none written.** Explicitly NOT proposed: collapsing the vocabularies (the value space is
SOURCE_REQUIRED — collapsing would invent it), or "fixing" the calendar.create proposal literal (that value is a
test fixture on a capability with no production propose lane; changing it would edit an expectation rather than
a source of truth). The determination pins stand as the anti-drift guard.

**Recorded for a future ruling, not proposed now:** the moment ANYTHING branches on reversibility, the
proposal-side value becomes an untrusted caller-authored input — it sits on `ProposalRequest`, unlike its
neighbours `authorityRequired` and `verificationPlan`, which were deliberately given no request field so they
could not be injected. That is a §6 exposure that does not exist today and must not be created accidentally.

═══════════════════════════════════════════════════════════════════════════════

# F-N16-4 · ORACLE IDENTITY

## SOURCE → OBSERVATION

| Identifier | What it actually names | Evidence |
|---|---|---|
| `verifyEffect` | the pure matching **RULE** — zero I/O, every read an injected callback; decides the terminal from `matchesTuple` + `bounceReason` | supplied by the registry (`deriveOracle`) |
| `m365ReadBack:sentItems+inbox` | the **READER** — the only I/O in the chain (vault token + two Graph GETs) — **plus its two sources** | written at the recording site (`s16VerifyRun`) |

**The decisive detail, pinned: neither file contains its own identifier string.** Both are assigned from
outside. And the component actually invoked at the recording site — the orchestrator `verifyGovernedSend` — is
named by **neither** identifier; it appears only in the kit's prose.

**Question 7 — is `oracleId` ever a lookup key? NO.** Pinned: there is no id→implementation registry anywhere;
implementations are chosen by **static import** at both runner sites. `oracleId` is consumed as (a) a non-null
predicate in `buildProposal`, (b) a rendered label, and (c) — the one load-bearing use — **a drift token in the
canon-equality check** at the execution boundary, where a changed id refuses execution. Even there both sides
come from the SAME `deriveOracle`, so the string can detect drift but can never select an oracle.

## CLASSIFICATION

**NOT an identity conflict — (b) TWO DISTINCT MECHANISMS at two layers, each correctly named for its own
layer.** The registry names the rule; the evidence record names the reader and its sources; the rule's behaviour
is recorded alongside, in the `method` field. Nothing is being silently merged, and **a mismatch between the two
is descriptive, not functional** (no resolution depends on either string).

**Residual, and it is SOURCE_REQUIRED, not a conflict:**
- **Field ownership** — whether `CapabilityRecord.oracleId` should name the RULE (as the registry supplies) or
  the READER+sources (as the evidence records) is not settled by any source. Both field docs are honest about
  their own layer; nothing reconciles them.
- **No identifier grammar exists.** Pinned: the two live ids are not even the same KIND of name — one is a
  function export name, the other a file basename (whose export is `makeM365GraphReader`) suffixed with the
  folders it read. `provenance.oracle` is typed a bare `string` — no union, no pattern, no value space.

**Never silently merged** (the ruling's own words): the two identifiers are left exactly as they are.

## Also observed, recorded as findings — NOT fixed in-slice

- **F-N16-4a:** `productionWired: false` is hardcoded on BOTH branches of `deriveOracle` and no path ever sets
  it true, so the human-facing label always reads "not production-wired".
- **F-N16-4b:** the `VerificationPlan` union declares a `'per-recipient'` value that no producer emits.
- **F-N16-4c:** `e2eVerifyRun` (the mock twin) calls the identical orchestrator/reader pair but writes **no
  ActionRecord verification and therefore no provenance** — whether that is deliberate (a mock path must leave
  no evidence) is not stated in the file.
- **F-N16-3b:** `importTransition`'s `REVERSIBLE` for `data.import` is the repo's only unjustified reversibility
  literal.

## TEST EVIDENCE

`capabilities/vocabularyReconciliation.test.ts` — **18 tests, green first run.** F-N16-3 (10): both vocabularies
as declared; the unproduced values; nothing joins them; the kernel never reads it; no path compares it; not in
the idempotency key; **the real-send proof that it never reaches the outcome envelope**; the calendar.create
divergence in both directions with the disclaiming comment; mail.send agreeing by three independent literals.
F-N16-4 (8): the rule is I/O-free and unnamed by itself; the reader is the I/O and unnamed by itself; the
orchestrator named by neither; registry-vs-record; **no id→implementation registry**; the drift-token use; an
absent oracle stating its need; no identifier grammar.

Full main **871 files / 9125 passed / 3 skipped** · typecheck clean · lint clean · gate-detector PROCEED (run
before the file was written).

## GATE STATUS

None required (test-only, PROCEED-class). Nothing added to the `executionGate.ts` bundle by these two findings.

## REMAINING UNKNOWN

- The canonical reversibility vocabulary and the relationship between the two slots — **SOURCE_REQUIRED**, spec
  silent, operator's to rule.
- Whether `calendar.create`'s two values should be reconciled at all before anything consumes them.
- Which layer owns `oracle_id`, and what an oracle identifier's grammar should be — **SOURCE_REQUIRED**.
- Whether the `method`/`oracle` split (rule vs reader) is the intended contract or an accident.
