# FG-16 · F-P24's LAST BUCKET-1 PIECE — THE L6 GATE'S SILENT DECISIONS

**STATUS: PRESENTED, NOT APPLIED.** No file modified. This document is to be ruled on, not acted on.

**FG NUMBER: FG-16, assigned by the worker and reported back.** Derivation: FG-1…FG-12 **closed** · FG-13
**RESERVED** (`grantedScopes` nullable — prepared, sequenced after P0, never applied; a reserved number is still
taken) · FG-14 **closed** (`c563cdd`) · FG-15 **closed** (`b5fcae3`, this session). Next free is **FG-16**. Note
for the record: `FG-16` also appears in the corpus inside the rhetorical line *"solving this once as FG-14, again
as FG-15, and again as FG-16 is how the product does not finish"* — **a warning, not an assignment.**

---

## 0 · THE DIRECTIVE'S PREMISE DOES NOT SURVIVE MEASUREMENT — AND IT CHANGES THE ANSWER

The directive says, and asks me to state plainly: *"`connectors/index.ts` IS FROZEN. So F-P24's remaining
Bucket-1 scope REQUIRES A FROZEN TOUCH."*

**MEASURED [CURRENT SOURCE] — `gate-detector.sh`, per file:**

| File | Class |
|---|---|
| `connectors/index.ts` | **FROZEN** |
| `liveBrain/executionGate.ts` | **GATE** |
| `liveBrain/proposalStore.ts` | **GATE** |
| `connectors/actionRecord.ts` | **PROCEED** |

**F-P24's remaining Bucket-1 scope does NOT require a frozen touch.** The governance decision is *made* inside
`l6ExecutionGate` (`executionGate.ts`, GATE-class), which already branches `admit` / `refuse` / `skip` at
`:96-104`. The evidence store's writer (`actionRecord.ts`) is **PROCEED**. Both ends of the change are outside
the freeze.

**This is not routing around the freeze, and the distinction matters.** Routing around means achieving the same
effect at a *worse* site to dodge a gate. Here the gate site is the **better** site: **§2 #19 requires GOVERNANCE,
EXECUTION and VERIFICATION to remain separate evidence classes**, and a governance record minted at the governance
decision point is architecturally more correct than one minted by the *send* observer at `:641`, which is an
execution-class emitter. Recording a governance refusal there would be borrowing an execution emitter to carry a
governance fact — the exact collapse §2 #19 forbids.

**FG-16 is therefore RESERVED FOR ROUTE B and is not needed for Route A.** If Route A is ruled, this stays a
GATE-class presented diff and FG-16 returns to the pool unspent. **The worker does not get to decide that** — both
routes are specified below.

---

## 1 · ONE CHANGE OR TWO? — **IT DEPENDS ENTIRELY ON THE ROUTE, AND THAT IS THE DECIDING ARGUMENT**

The directive asks whether the refusal and the skip can be covered by one change at `:606-607`. **They cannot —
because the frozen call site cannot see the skip.**

```ts
export type L6GateResult = { readonly ok: true } | { readonly ok: false; readonly refusal: ConnectorWriteResult };
```
`executionGate.ts:25` — and `:104` returns `{ ok: true }` for **both `admit` and `skip`**, with the comment saying
so. So at `connectors/index.ts:606-607` the two are **structurally indistinguishable**.

- **ROUTE B (frozen) needs TWO changes:** widen `L6GateResult` to surface `skip` (GATE-class) **and** edit the
  frozen line to emit on it. The frozen touch buys nothing the non-frozen change did not already have to do.
- **ROUTE A (no frozen touch) needs ONE change, at one site:** `l6ExecutionGate` already knows which of the three
  outcomes occurred. It emits for `refuse` and `skip` and returns exactly as before.

**ROUTE A IS ONE CHANGE; ROUTE B IS TWO CHANGES PLUS A GATE. Route A is recommended.**

---

## 2 · THE RECORDED ARTIFACT — AN ActionRecord WITH A GOVERNANCE VERDICT

Per §2 #19, which names F-P24's artifact as **the ActionRecord, not `app.log`**, and requires the three evidence
classes to stay separate:

| Class | Value | Why |
|---|---|---|
| governance | `DENY` (refuse) · **`NOT_EVALUATED`** (skip) | the decision, or the honest absence of one |
| execution | `NOT_STARTED` — `executed: false` | nothing ran |
| verification | `NOT_APPLICABLE` — `verification` absent | there is no effect to verify |

**A GOVERNANCE DENY MUST NEVER BE CONVERTED INTO `execution_failed`** (§2 #19, verbatim). Nothing was attempted.

## 3 · **A SKIP IS NOT A REFUSAL, AND THE RECORD MUST NOT SAY IT WAS**

This is the sharpest constraint in the envelope and it cuts against the obvious implementation.

F-P48's whole point is that **the gate did not decide.** The lookup missed and the send proceeded. **A record
claiming `DENY` would be a fabrication in the opposite direction** — it would assert a refusal that never happened
and would make an ungated send look governed, which is strictly worse than the present silence. It would also make
the audit *less* truthful while appearing to close F-P24.

So the skip's verdict is an honest third value — `NOT_EVALUATED` — meaning **"this send was not gated, and here is
the record saying so."** The record's purpose is to make the *absence* of a decision visible, never to invent one.
**The skip row and the refusal row must be distinguishable by field, not by prose** (R5 condition 2 is the same
mistake one level down, and is deliberately not repeated here).

---

## 4 · DECISION-NEUTRALITY — TRUE FOR THE SEND PATH, **FALSE FOR THE MEASUREMENT LAYER**

**For the send path: fully decision-neutral.** The emit is best-effort and self-catching like the `:641` observer,
returns nothing, and changes no branch. The `??` stays untouched. **The skip still proceeds. This envelope makes
the skip VISIBLE; it does not make it refuse.**

**For the measurement layer: NOT neutral, and it must be ruled rather than discovered later.**
`m365WriteStates.ts:43` increments `requested += 1` for **every** record with `actionId === 'mail.send'`. A
governance-refusal row would therefore **inflate the `REQUESTED` counter**, and the panel would show refused and
ungated sends as requested writes. **That is F-P41's counter, freshly repaired at `68e3349`, and this change would
alter what it displays.** Two honest options, neither taken here: filter governance-class rows out of
`deriveWriteStates`, or widen the funnel to show them as their own state. **A ruling is required.**

---

## 5 · TWO OPEN QUESTIONS — NAMED, NOT INVENTED

1. **`transitionId` has no honest value.** `ActionRecord.transitionId` is required, and the governed one is
   `m365-send:<idem>` where `idem` is **content-addressed and minted INSIDE the CST** (`sendTransition.ts:165`).
   **A refusal never reaches the CST, so no transition exists.** Minting a gate-scoped id would create a second
   id-space (F-N16-4's shape); making the field optional is a schema change. **Not decided here** — inventing an
   id to satisfy a required field is exactly how a fabricated lineage starts.
2. **Tenant key.** The emit must use the **workspace id** (`deps.workspaceId()`), matching the writer, per F-P45.
   Stated so the accommodation is not silently re-litigated at a new site.

---

## 6 · WHAT THIS DOES NOT CLOSE

- **F-P48 STAYS OPEN.** It closes only when **the skip-on-miss behaviour itself is ruled** — *a gate that skips on
  a key miss is not a gate, it is a lookup with a permissive default* — which is a separate and larger question
  about whether an unresolvable identity should DENY. **This envelope records the silence; it does not end it.**
- **F-P24 does not close either**, until the record exists and is proven durable.
- Nothing here touches F-P39, F-P41's terminal, F-P46, F-P49, or `productionWired`.

---

## 7 · VERIFICATION PLAN

1. `gate-detector.sh` on every path **before** editing.
2. Route A: GATE-class presented diff → apply → full suites → isolated commit → re-record → INTACT.
   Route B: additionally the §2 #2 frozen choreography with the FG-16 token.
3. **Pins, derived from the consumer per §2 #27:** a refusal mints a row with `verdict DENY`, `executed false`,
   no verification · **a skip mints `NOT_EVALUATED` and NEVER `DENY`** · the row is keyed by workspace id · the
   emit is best-effort (a throwing store never alters the gate's return) · **the gate's return value is
   byte-identical for all three outcomes** — the decision-neutrality proof.
4. Suite delta must be **exactly the new pins**, measured as at `68e3349` and `b5fcae3`.

## 8 · THE TOKEN

Nothing is applied until the literal token is given. Route B only:

```
AUTHORIZED: FG-16 — connectors/index.ts L6 governance-record emit, per gate doc
```

**Route A requires no FG token — it requires the operator's ruling on the route, on the counter question (§4),
and on `transitionId` (§5.1).** Silence is not consent; a diff that changes after the token requires a new token.
