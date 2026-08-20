# NP-018 · STALE AS A FIRST-CLASS STATE ASSESSMENT
## The single `Certainty` authority EXTENDED — no fork, no second certainty system. The last slice of the NP-012 §3 ranking.

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

**Status: TEST-VERIFIED.** PROCEED-class (gate-detector run before the edit). Zero frozen touch. Zero external
effects. NP-000 = HOLD unchanged.

## THE BINDING DISTINCTION — preserved in the vocabulary, the docs, and the pins

> **UNKNOWN** — the system CANNOT ESTABLISH the current fact.
> **STALE** — evidence EXISTS but is no longer sufficiently current for the required freshness condition.

They are not degrees of one thing. **UNKNOWN is blindness; STALE is sight that has aged past a stated
requirement.** Collapsing them would destroy the only information separating "we have never seen this" from "we
saw this, and the requirement says that is no longer good enough". Both the type's doc comment and three pins
carry the distinction, including one that asserts the two are never interchangeable for the same input.

A consequence worth stating, recorded verbatim by operator ruling (20 Aug 2026):

> **"An unusable observation time is UNKNOWN, never STALE — we cannot say a fact aged if we cannot say when it
> was seen."**

Pinned for `null`, `undefined` and `NaN`.

## WINDOW SEMANTICS — a requirement, never a default (designed in-slice, reasoning recorded)

**There is deliberately NO default max-age.** The reasoning, recorded at the function and pinned:

> **"A freshness requirement is a property of the consumer, not of the fact."** (recorded verbatim by operator
> ruling, 20 Aug 2026)

So the requirement is supplied by the caller. **No declared requirement ⇒ nothing is ever STALE**, however old
the observation (pinned against a 25-year-old timestamp, for `null`, `undefined` and omitted). A pin also asserts
no magic number was smuggled in as a fallback. This is the same discipline as NP-019's temporal work: **a
window we were not given is not invented.**

Boundary chosen and pinned: age **strictly greater** than the requirement is stale; at exactly the limit the
requirement is still met. The caller also states what a FRESH fact would be, so corroborated evidence stays
`VERIFIED` while current — and ages to `STALE` like anything else, rather than silently keeping its proof.

The assessor is pure and has **no clock of its own** (pinned: no `Date.now()`, no `new Date()`); `nowMs` is an
input, so the same inputs always yield the same answer.

## ONE AUTHORITY, EXTENDED — the anti-re-entry pattern

`STALE` was added to the **existing** `Certainty` union. Pinned: no parallel `Freshness`/`Staleness` type, no
enum, no shadow union anywhere in the Brain substrate; and the assessor is the only place the string is produced
(occurrence count bounded, so a second inventor fails the pin).

**Rollup precedence — where STALE sits and why.** The rollup returns the WORST section. STALE is strictly *more*
informative than UNKNOWN (evidence exists) and strictly *less* than KNOWN (it aged past a stated requirement),
so it ranks **below UNKNOWN and above KNOWN**:

> CONFLICTING → UNAVAILABLE → UNKNOWN → **STALE** → VERIFIED / KNOWN

A state with one stale section is not blind, and it is not simply known either. The ordering is pinned by index,
so a future reshuffle fails a test rather than passing quietly.

**The compiler participated.** `uncertainty: Record<Certainty, number>` failed to compile the moment the union
grew — the census had to count all six or the build broke. That is the type system enforcing the census's
honesty, and it is exactly the backstop CLAUDE §4 says does *not* exist for `AuthStatus`.

> **RECORDED AS A CANDIDATE FUTURE SLICE (operator, 20 Aug 2026) — recorded, NOT queued:** *bring `AuthStatus`
> under the same `Record`-census pattern*, so that adding a status value breaks the build until every consumer
> counts it — the backstop §4 currently says is absent there.

## §2 #18 OPERATIONAL TEST — applied to this slice, answered with evidence

> EXISTING GOVERNANCE + NEW FIELD → does the field change the decision?

**ANSWER: NO.** Pinned three ways:

1. **Proposal expiry is a SEPARATE mechanism.** `buildProposal` enforces freshness from `evidence[].asOfMs`
   against a governed `freshnessWindowMs` — and `proposal.ts` contains no reference to `Certainty` and no
   `'STALE'`. Adding a state value cannot change proposal expiry or admission.
2. **The execution boundary reads no certainty of any kind** (pinned absent).
3. **The Brain substrate keeps its zero-runtime-import property** — no value import from `cst/`, executors or
   connectors — so `STALE` gained no path to governance (RULE-007 / §2 #13 intact).

Therefore this is a data-model change that does **not** alter what the system is permitted to do — the ruling's
own test says no gate is required, and none was taken.

## Honest bounds — what this does NOT claim

- **No production caller declares a freshness requirement yet, so nothing is STALE in the running system
  today.** The value, its producer, its precedence and its census are real and consumed by the rollup; the first
  real requirement arrives with the consumer that needs one. Recorded rather than manufactured — inventing a
  window to make the value "live" is exactly what the window semantics above forbid.
- Lifecycle rung reached: **FIELD → CONSUMER** (the rollup and the census consume it), **not DECISION** — and
  deliberately so.
- **Where the STALE assessment eventually meets the CST kernel's unreachable freshness gate belongs to
  F-N17-4's SOURCE_REQUIRED, not this slice** (operator-ruled). Nothing here bridges them by assumption; the
  shapes do not line up today (`RelationshipRef` wants `observedAt: number` + `epistemicStatus`).

## Verification (all RUN)

`liveBrain/staleCertainty.test.ts` **15/15** · typecheck node clean (after the compiler caught the census) ·
lint clean · **full main 873 files / 9160 passed / 3 skipped** (was 872/9145/3 — the delta is exactly this
file) · **UI 42 / 279** (brain-substrate change ⇒ full main + UI, as ruled) · gate-detector PROCEED before the
edit · zero frozen touch.
