# PROPOSAL — A STANDING LIGHTWEIGHT GATE CLASS FOR ADDITIVE READ-ONLY IPC
### Drafted 21 Aug 2026 · **A PROPOSAL, NOT A GATE DOC. Nothing was acted on.** The freeze is §2 #1 and this policy is the operator's to rule.

## THE PROBLEM IT EXISTS TO SOLVE

Surfacing `composeBusinessFacts` needs a channel. `packages/shared/src/ipc/channels.ts` and `contracts.ts` are
FROZEN, so it needs an FG gate. **So will the next ERP view. So will the first CRM view. So will every read-only
surface after that.**

> **Solving this once as FG-14, again as FG-15, and again as FG-16 is how the product does not finish.** The full
> §2.2 choreography costs a gate doc, a verbatim diff, a threat analysis both directions, the operator's literal
> token, two INTACT re-recordings and an isolated commit — and it buys, each time, the ability to show a number
> that already exists on a screen that already exists.

The freeze earned its strictness on surfaces that can grant authority. **This class covers surfaces that
structurally cannot.**

## THE PRECEDENT

**FG-12** — one additive optional `GovernedSendResult.requestId`, assigned verbatim from the transition request's
own id. It landed cleanly, the frozen-only commit was green on its own, and the bracket never passed through a red
state. It is the shape this class generalises: **additive, optional, consumed only as evidence, never branched on
for authority.**

## THE FOUR ENTRY CONDITIONS — all four, or it is not in this class

1. **ADDITIVE ONLY.** A new optional field, or a new channel. **Never a modification, never a removal, never a
   widening of an existing type.** A change that alters the meaning of an existing field is a full FG gate.
2. **READ-ONLY BY CONSTRUCTION.** The handler performs no write, no mutation, no effect. It composes from stores
   the caller may already read under its existing permission. **No new permission scope may be introduced by a
   change in this class** — if the data needs a scope that does not exist, that is a full gate.
3. **NO GOVERNANCE DECISION READS IT — PINNED.** In the FG-12 shape: a test asserting that no authority
   derivation, no admission path, no execution boundary, and no certification predicate references the new field
   or channel. **The pin ships in the same commit and is the entry ticket, not a follow-up.**
4. **NOTHING BRANCHES ON IT FOR AUTHORITY — PINNED SEPARATELY.** Distinct from (3): (3) says governance does not
   *read* it; (4) says nothing anywhere uses it as a *predicate* for a consequential decision. `policyVersion`'s
   lesson applies — a field that is recorded but never compared is safe; a field that is compared is a control.

## THE LIGHTER CHOREOGRAPHY

| Step | Full FG gate | This class |
|---|---|---|
| Gate doc | required | **not required** — the entry conditions are the doc |
| Verbatim diff presented | required | **required** — unchanged |
| Threat analysis both directions | required | **replaced** by the four conditions + their pins |
| Operator's literal token | required | **standing authorization** for the class, granted once |
| INTACT before / after | required | **required** — unchanged |
| Isolated frozen-only commit | required | **required** — unchanged |
| Full suites green | required | **required** — unchanged |
| Evidence doc | required | **replaced** by the commit message + the pins |

**What it still requires, deliberately:** the presented diff, both INTACT re-recordings, the isolated commit, the
full suite, and the two pins. **The saving is the gate doc, the threat analysis and the per-instance token — not
the change-control discipline.**

## WHAT THIS CLASS WOULD NOT COVER — stated honestly, because the exclusions are the point

- **Anything on the authority path.** `grantedScopes`, `TenantScope`, `AuthStatus`, admission records, the CST
  request/result envelopes. FG-12 itself would *not* qualify — `requestId` rides the governed send result, and
  that surface is authority-adjacent even though the field is evidence.
- **Anything a governance decision could later read.** If the field is plausibly a future predicate, the honest
  answer is a full gate now rather than a "move rule" later (§0.2's REVERSIBILITY MOVE RULE exists because that
  bet was already lost once).
- **New permission scopes**, new write paths, new channels that mutate, and anything touching `cst/`.
- **Renderer surfaces that display a governance claim.** A read-only *channel* may be light; a surface asserting
  "Verified" or "Governed" is a §4 UI-truth question and carries its own tests regardless.
- **The `brainReview` shape.** FG-9 was additive and optional and would superficially qualify, but it displays a
  governance artifact and its verbatim-rendering requirement is exactly the kind of constraint a lightweight class
  would erode.

## THE RISK, NAMED

**A lightweight class is a habituation surface.** F-P29's lesson — *false positives on a safety gate are dangerous
through habituation, not through logic* — inverts here: a gate that is easy to pass gets used, and the pressure
will be to classify borderline changes into it. **The mitigation is that conditions (3) and (4) are pins, not
judgements**: a change that cannot produce those two green tests is not in this class, and no one has to argue
about it.

**Recommended if adopted:** a standing register of every change admitted under this class, so the count is visible
and the class can be audited as a set — the F-P32 lesson, applied before the block accumulates rather than after.

## THE REVIEW TRIGGER — because a register without one becomes the thing it was built to prevent

> **F-P32 IS a register with no trigger.** Twenty-four files landed in one commit on 2026-08-07 and sat unreviewed
> for two weeks, and nobody discovered it until a recon looked. A list that nothing forces anyone to read is not a
> control; it is a second place for the same problem to accumulate quietly.

**The trigger, named concretely — BOTH conditions, whichever comes first:**

1. **EVERY FIFTH ADMISSION.** A count is unambiguous and needs no judgement. Five is small enough that a review is
   cheap and large enough that it is not ceremony on every change.
2. **AT EVERY SEVERITY GATE**, unconditionally, even if only one change was admitted since the last one — because
   the severity gate is the moment the programme asks what is ship-blocking, and an unreviewed class is exactly
   the kind of thing that should not answer "nothing" by default.

**WHAT THE REVIEW ACTUALLY CHECKS — and the second item is the one that matters:**

- **Conditions 1 and 2, re-verified per admitted change, against current source.** Not against the change as
  described at admission time. A field admitted as additive-optional may since have been made required; a handler
  admitted as read-only may since have grown a write. **The register records what was true then; the review
  establishes what is true now.**
- **THE TWO PINS, GREEN AS A SET — NOT INDIVIDUALLY.** Each admission ships pins that no governance decision reads
  *its* field and nothing branches on *its* field. Run per-change, those pass forever while the class as a whole
  drifts. **The set-level question is the real one: does any governance decision now read ANY field admitted under
  this class, and does anything branch on ANY of them for authority?** That is a different query, it can fail when
  every individual pin passes, and it is what a per-change discipline structurally cannot see.

**If a review cannot be run** — the register is missing, the pins do not exist as a set, or a change cannot be
located — **the class is suspended for new admissions until it can.** A gate whose audit is impossible has already
stopped being a gate.
