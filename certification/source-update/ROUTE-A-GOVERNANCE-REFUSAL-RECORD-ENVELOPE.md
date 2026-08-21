# ROUTE A · F-P24's LAST BUCKET-1 PIECE — THE L6 GATE'S SILENT DECISIONS

**STATUS: PRESENTED, NOT APPLIED.** No file modified. GATE-class presented diff, to be ruled on, not acted on.

## FG-16 RETURNS TO THE POOL — **UNSPENT**

Recorded explicitly, because *a reserved-but-unspent number must not become taken by rumour.* FG-16 was reserved
for Route B (the frozen route). **Route A is ruled, Route B is not being built, and FG-16 was never issued as a
token.** **FG-16 IS FREE.** The next frozen gate takes it. This file was renamed off that number for the same
reason: **a filename claiming a gate number is how an unspent number acquires a history.**

Standing gate ledger at this commit: FG-1…FG-12 closed · **FG-13 RESERVED** (grantedScopes nullable, prepared,
never applied — still taken) · FG-14 closed (`c563cdd`) · FG-15 closed (`b5fcae3`) · **FG-16 FREE.**

---

## 0 · SEQUENCING — **ROUTE A LANDS FIRST, F-P48 SECOND, NEVER TOGETHER.** BOTH REASONS, RECORDED.

**REASON 1 — ORDERING.** F-P48 makes the gate **REFUSE where it previously proceeded.** Landing it first would
mean those refusals **mint nothing** — F-P24's exact defect, **freshly created by F-P48's own fix.** A fix that
manufactures the defect it is adjacent to is a regression wearing a repair's clothes.

**REASON 2 — AND THIS IS THE ONE SOMEONE WILL LATER MISTAKE FOR CEREMONY, so it is written down first:**
**YOU CANNOT PROVE A CHANGE IS DECISION-NEUTRAL IN THE SAME COMMIT AS A CHANGE THAT ALTERS DECISIONS.**
Route A's acceptance criterion is *the gate's return is byte-identical for all three outcomes* — that is the
entire proof that adding evidence changed no behaviour. **F-P48 breaks that criterion BY CONSTRUCTION**, because
its whole purpose is to make one of those outcomes return something different. Combined, neither change is
provable: the neutrality claim has no baseline and the behaviour change has no isolation. **This is not
procedural tidiness — it is the difference between a proof and an assertion**, and merging them destroys the only
instrument that could have caught a mistake in either.

## 1 · THE SITE, AND WHY IT IS THE BETTER ONE RATHER THAN A WORKAROUND

**MINTS:** `liveBrain/executionGate.ts` — **GATE** class. **RECEIVES:** `connectors/actionRecord.ts` — **PROCEED**
class. **No frozen surface is touched.**

The obvious objection is that this dodges the freeze on `connectors/index.ts`. It does not, and the reason is
architectural rather than convenient:

**§2 #19 requires GOVERNANCE, EXECUTION and VERIFICATION to remain separate evidence classes and forbids
collapsing one into another.** The emitter at `connectors/index.ts:641` is an **execution-class** observer: it runs
after `governedSend` returns and its whole subject is *what the executor did*. **A governance refusal has no
execution to observe.** Minting it there would mean borrowing an execution emitter to carry a governance fact —
the precise collapse that law forbids — and it would arrive with an execution-shaped row that must then be
explained away as "not really executed."

**The governance decision is MADE in `l6ExecutionGate`.** Recording it there is where the fact is, at the moment
it becomes true. **Route A is where the evidence belongs; Route B is where the frozen file happens to be.**

**And Route B is structurally worse, not merely dearer.** `executionGate.ts:25`'s `L6GateResult` collapses
`admit` and `skip` into `{ ok: true }` — so **the frozen call site cannot see the skip at all.** Route B needs
*two* changes (widen the result type, then edit the frozen line) to reach a distinction Route A already has for
free at `:96-104`.

---

## 2 · THE ARTIFACT

An `ActionRecord`, per §2 #19's naming of F-P24's artifact — the evidence store, not `app.log`:

| Class | Value |
|---|---|
| governance | `DENY` (refuse) · **`NOT_EVALUATED`** (skip) |
| execution | `NOT_STARTED` — `executed: false` |
| verification | `NOT_APPLICABLE` — `verification` absent |

**A governance DENY is NEVER converted into `execution_failed`.** Nothing was attempted.

## 3 · A SKIP IS NOT A REFUSAL — THE SHARPEST CONSTRAINT, AND IT CUTS AGAINST THE OBVIOUS IMPLEMENTATION

F-P48's finding is that **the gate did not decide.** The lookup missed and the send proceeded.

**A record claiming `DENY` would be a fabrication in the opposite direction.** It would assert a refusal that never
happened, and it would make an **ungated send look governed** — strictly worse than the present silence, because
silence is at least honestly empty. It would also close F-P24 on paper while making the audit *less* truthful,
which is the worst available outcome: a green that costs accuracy.

So `NOT_EVALUATED` is **a record whose purpose is to make THE ABSENCE OF A DECISION visible.** It never invents
one.

**The two rows are distinguishable BY FIELD, never by prose.** R5 condition 2 is exactly that mistake one level
down — not-found and ambiguous both returning `HOLD`, separated only by `detail` text — and it is **deliberately
not repeated here.**

---

## 4 · THE COUNTER — RULED: **FILTER, DO NOT WIDEN THE FUNNEL**

`m365WriteStates.ts:43` increments `requested` for **every** `mail.send` row. Unfiltered, governance rows would
inflate F-P41's counter, freshly repaired at `68e3349`.

**RULING APPLIED:** the five states describe **WRITE ATTEMPTS THAT REACHED THE EXECUTOR.** A governance refusal
never became one — execution `NOT_STARTED` — so **counting it as `requested` would claim a write was requested
when none was: a claim-language defect in the very counter built to fix F-5.** The irony is the argument.

**PREDICATE:** rows with **execution `NOT_STARTED` are excluded** from `deriveWriteStates`.
**PIN:** *a governance row moves no counter* — all five states unchanged across an emit.

**Widening the funnel is a different product decision and is NOT taken:** it would make the counter mean
"governance events" rather than "writes", and that needs its own ruling.

---

## 5 · `transitionId` — RULED **NULL IT, DO NOT MINT IT**. THE CONDITIONAL WAS CHECKED FIRST.

**THE CONDITIONAL FIRED, AND ITS PRESCRIBED STOP DOES NOT APPLY — here is the measurement rather than a design
around it.**

**Does anything BRANCH on `transitionId` / `admissionRef`? YES — three sites [CURRENT SOURCE]:**
- `actionRecord.ts:380` — `recordVerification` matches `r.tenantId === tenantId && r.transitionId === transitionId`
- `actionRecord.ts:407` — the query filter predicate
- `readBackReconciler.ts:263,268` — **the single-flight key** (`inFlight.has(...)` / `singleFlight(...)`)
- (`actionRecord.ts:332` — `admissionRef: transitionId`, the same value in a second field)

**BUT THE STOP CONDITION WAS "making the field OPTIONAL is governance-class", AND NO OPTIONALITY IS NEEDED.**
`actionRecord.ts:292` already reads `let transitionId = '';` — **the observer ALREADY defaults it to the empty
string when the outcome carries none, so rows with `''` exist today.** `''` is the established absent
representation; the type stays `string`; **no schema change, no optionality, no §2 #18 trigger, no STOP.**

**The precedent is ours and it is exactly on point:** `requestId` was structurally null and we did **not**
fabricate one — FG-12 propagated the real value once it existed. Same discipline here.

**ONE RESIDUAL RISK, NAMED RATHER THAN DISMISSED:** `recordVerification`'s `find` on `transitionId === ''` could
match the wrong row if a governance row ever reached it. **It cannot today** — `awaitingVerification` filters on
`outcome === 'ACKNOWLEDGED'`, which a governance row is not. **The latent `''` collision is PRE-EXISTING among
execution rows and is not introduced by this envelope**, but it should be pinned so this change never becomes its
cause. Recorded, not fixed.

## 6 · TENANT KEY — **THE WORKSPACE ID**, per F-P45

`deps.workspaceId()`, matching the writer. Stated explicitly so the accommodation is **not silently re-litigated
at a new site** — the reconciler and the counter each had to learn this separately, and a third site learning it
by accident is how F-P45 acquires a fourth instance.

## 7 · WHAT IT DOES NOT CLOSE

**F-P48 STAYS OPEN. This records the silence; it does not end it.** F-P48's fix shape is ruled and recorded in its
own register row, and is **deliberately NOT folded into this envelope** — its envelope comes after Route A lands.

F-P24 does not close until the record exists and is proven durable. Nothing here touches F-P39, F-P41's terminal,
F-P46, F-P49, F-P50, or `productionWired`.

---

## 8 · VERIFICATION PLAN

1. `gate-detector.sh` on every path **before** editing (expected: `executionGate.ts` GATE, `actionRecord.ts`
   PROCEED).
2. GATE-class presented diff → apply → full suites → isolated commit → re-record → INTACT both sides.
3. **Pins, derived from the CONSUMER per §2 #27:**
   - a refusal mints a row: governance `DENY`, `executed: false`, no verification
   - **a skip mints `NOT_EVALUATED` and NEVER `DENY`** — the fabrication guard, asserted directly
   - the row is keyed by **workspace id**
   - **a governance row moves no counter** — all five write states unchanged across an emit
   - the emit is **best-effort**: a throwing store never alters the gate's return
   - **the gate's return value is byte-identical for all three outcomes** — the decision-neutrality proof
   - a governance row is **never selected by `awaitingVerification`** — it must not enter the reconciler
4. Suite delta must be **exactly the new pins**, measured as at `68e3349` and `b5fcae3`.

## 9 · WHAT IS STILL NEEDED TO PROCEED

The route, the counter predicate and `transitionId` are all ruled. **What remains is the operator's go on the
diff itself**, which will be presented verbatim before application. Nothing is applied until then.
