# NP-019 · TEMPORAL COMPLETION — SEMANTIC MAPPING RESULT: **STOP, DO NOT WRITE**
## The operator's mandated first step returned a NEGATIVE answer. `authorization_time` and `execution_time` cannot be honestly sourced from the CST timeline. No fields were written.

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

**Status: SOURCE-PROVEN (a negative result, empirically demonstrated).** No production code was changed for the
ruled objective. Zero frozen touch. NP-000 = HOLD unchanged.

## The binding instruction this slice obeyed

> SEMANTIC MAPPING FIRST: establish SOURCE EVENT → SEMANTIC FIELD → RECORD before any write. Map decided /
> claimed / executionStarted / executionCompleted / verified to temporal concepts ONLY where the semantic
> equivalence is demonstrable from the existing implementation … NEVER nearest-timestamp-fills-empty-field …
> No workaround.

The mapping step ran first, and it is the reason nothing was written.

## SOURCE EVENT → SEMANTIC FIELD: the mapping, and where it fails

### Step 1 — what each stamp brackets (read from the kernel implementation)

| Kernel stamp | What the code demonstrably marks |
|---|---|
| `requested` | entry into the transition |
| `decided` | the policy DECISION was computed — stamped BEFORE the approval gate, so HELD and DENIED transitions carry it too |
| `claimed` | the atomic claim was WON — reachable only after every authorization check passed (approver-not-AI, separation of duties, approval bound to this transition, scope covers target, constraint ceilings, not consumed, not expired, evidence fresh) |
| `executionStarted` / `executionCompleted` | the bracket around the single effect call |
| `verified` | the KERNEL's own post-state comparison — **not** the independent read-back oracle |

Two conclusions from step 1 alone, before any timing question:

- **`decided` is NOT `authorization_time`.** It is stamped on paths that then HOLD (`APPROVAL_REQUIRED`,
  `MODEL_SELF_AUTHORIZATION`, `EVIDENCE_STALE`) or DENY (`SEPARATION_OF_DUTIES`, `APPROVAL_SCOPE_VIOLATION`,
  `CONSTRAINT_EXCEEDED`, `APPROVAL_CONSUMED`). Mapping it would attach an "authorization time" to transitions
  that were never authorized.
- **`verified` is NOT `verification_time`.** The kernel's post-state comparison and the S16 independent read-back
  oracle are different acts of verification; the record's `verification.at` already means the oracle run.
  Conflating them would let a kernel self-check masquerade as independent verification — the §14/§39 boundary
  this program exists to hold.

### Step 2 — the timing question, answered empirically (this is the decisive finding)

`cst/sendTransition.ts` constructs `new SystemTime()` per call, and `SystemTime.now()` returns a base **frozen at
construction** (`stores.js`: `#base = fixedNow ?? Date.now(); now() { return this.#base; }`), advanced only by an
explicit `advance()` that **no production path calls**.

A real `governedSend` was driven end-to-end (mock transport, no external effect) and its timeline read directly:

```
TIMELINE-VALUES: {"requested":1787216587199,"decided":1787216587199,"claimed":1787216587199,
                  "executionStarted":1787216587199,"executionCompleted":1787216587199,"verified":1787216587199}
DISTINCT-VALUE-COUNT: 1 of 6      SPREAD-MS: 0
```

**All six stamps carry one identical value — the instant the transition's clock object was constructed.**

The CST timeline is therefore a **phase-reached ledger under a frozen logical clock**, not a set of phase
timestamps. It faithfully records WHICH phases were reached (key presence) and their ORDER (by construction); it
does not record WHEN each phase occurred, because nothing ever measures that.

### The verdict

**`authorization_time` ← `claimed` and `execution_time` ← `executionStarted` are DEMONSTRABLY NOT semantically
equivalent to what those fields mean.** Writing them would stamp the request-construction instant onto two
phases that were never separately measured — the textbook form of "nearest timestamp fills the empty field",
and it would do so while *looking* like verbatim sourcing. The ruled envelope's own first condition therefore
forbids the write, so **no field was added, and both remain honestly ABSENT** in the §14 model.

## F-N19-2 — a defect in NP-015's own claim, found by this probe and corrected (SELF-CAUGHT)

Driving the REAL path also showed that **`TransitionOutcome` carries no `requestId` field at all** — the
requestId lives on the transition REQUEST and never comes back. The observer reads `requestId` off the OUTCOME,
so:

```
STORED-REQUEST-ID:   ""
STORED-REQUEST-TIME: null
STORED-TRANSITION-ID: "m365-send:78f9db95…"   (the identity that IS carried back)
```

**`ActionRecord.requestId` is empty on every real governed send, and NP-015's `requestTime` is structurally null
in production.** The FIELD behaved exactly as designed — null, never a guess, precisely what its pins assert —
but NP-015's evidence described it as "READ from the kernel-minted requestId" without recording that today's
production outcome never carries one. **The description overstated what the field does.** The cause is
instructive and is recorded as a standing lesson: *NP-015's pins used a hand-built `GovernedSendResult` fixture
carrying `outcome.requestId`* — a fixture more generous than reality — which is exactly why the gap survived a
green suite.

**Correction applied (non-frozen, no new claim):** a REALITY pin now drives the real `governedSend` into the real
observer and asserts the true production shape (`requestId === ''`, `requestTime === null`, transitionId
non-empty), so the optimistic fixture can never quietly become the claim again. The NP-015 evidence and CLAUDE §1
are corrected to state the structural null.

**The actual fix is GATED, not worked around.** Surfacing the requestId requires adding it to
`GovernedSendResult` in `cst/sendTransition.ts` — a **FROZEN** surface. Per the ruling ("Frozen surface required
→ STOP → FG presentation → WAIT … No workaround"), it is presented, not applied. The one-field diff is in the
report accompanying this evidence.

## What the timeline CAN honestly support (PROPOSED, not built)

A **phase-reached ledger**: record which of `requested / decided / claimed / executionStarted /
executionCompleted / verified` were reached, verbatim from key presence. That is a real, demonstrable fact with
genuine diagnostic value (it distinguishes a transition that halted at `decided` from one that reached
`executionStarted`), and it is NOT a timestamp claim. It is outside the ruled objective, so it is proposed for
the operator's decision and nothing was built.

## Honest bounds

- `authorization_time` and `execution_time` remain **ABSENT** in the §14 model; the mapping row is updated to say
  *why* — the source exists but does not carry phase instants.
- Nothing was relocated, no frozen contract was touched, and the nine-field model was NOT made to "look
  complete".
- F-N16-2..5 untouched, as ruled. No canonical IDs minted.

## Honesty-scanner review item — EXPLAINED (never silently green)

The scanner raised exactly one item on this slice's diff:

> REVIEW ITEM · (diff-wide) — ONLY test files changed — expected-output edited instead of the implementation?
> [apps/desktop/src/main/temporalModel.test.ts]

**Explanation, and why it is the correct state here.** The scanner's suspicion is the right one to have: a
test-only diff usually means an expectation was bent to fit a broken implementation. That is NOT what happened.

1. **Nothing was weakened.** The change is purely ADDITIVE — one new `describe` block. Every pre-existing NP-015
   assertion is byte-unchanged and still green.
2. **The new test asserts what production genuinely does** (`requestId === ''`, `requestTime === null`), which is
   a DEFECT RECORD, not a relaxed expectation. It exists so the previously-optimistic fixture cannot silently
   become the claim again.
3. **A test-only diff is the ruled outcome.** The objective's write was forbidden by the mapping result, and the
   one available implementation fix (surfacing the requestId) needs a FROZEN `cst/` change — "STOP → FG
   presentation → WAIT. … No workaround." Applying it here is precisely what the directive prohibits.

The implementation change is therefore *withheld and presented*, not *avoided*.

## Verification (all RUN)

The empirical readings above were taken with a temporary probe driven through the REAL `governedSend` and the
REAL `actionRecord.observe`; the probe was deleted after the readings, and its findings are preserved as the
permanent REALITY pin in `temporalModel.test.ts` (14 tests, green). Typecheck node clean · lint clean ·
**full main suite 869 files / 9097 passed / 3 skipped** (was 869/9096/3 — the delta is exactly the one REALITY
pin) · honesty scanner: 1 review item, explained above · zero frozen touch · zero external effects.
