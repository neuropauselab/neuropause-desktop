# FG-12 · GATE DOC — surface the transition's `requestId` on `GovernedSendResult`
## PREPARED ONLY. **NOT APPLIED.** Awaiting the operator's read-only confirmations and the literal token.

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

**Origin:** F-N19-2 (NP-019, self-caught). The evidence observer stores `requestId: ''` on every real governed
send, and NP-015's `request_time` is therefore structurally null, because the CST `TransitionOutcome` carries no
requestId — it exists only on the transition REQUEST, which never comes back to the caller.

---

## 1 · Exact file

`apps/desktop/src/main/cst/sendTransition.ts` — **FROZEN** (`src/main/cst/`). No other file is touched by this
gate.

## 2 · Exact diff (verbatim, both hunks — this is the entire change)

```diff
@@ export interface GovernedSendResult {
   /** The full CST envelope — the transition's evidence of record. */
   readonly outcome: TransitionOutcome;
   readonly semanticOutcome: SendSemanticOutcome;
   /** The external effect is attempted AT MOST ONCE. MUST be 0 or 1; never >1. */
   readonly effectCalls: number;
   /** true ONLY when a provider 202 acknowledgement was received. Never implies verified. */
   readonly providerAck: boolean;
+  /**
+   * The transition REQUEST's own id, surfaced verbatim so the evidence
+   * observer can record it. The kernel's outcome envelope does not carry it,
+   * so without this the Action Record stores an empty requestId (F-N19-2).
+   * Optional: a caller compiled before this field existed is unaffected.
+   */
+  readonly requestId?: string;
   readonly summary?: string;
 }
@@ const outcome = await kernel.run(request, effect);
   return {
     outcome,
     semanticOutcome: classifySend(outcome, sendSignal),
     effectCalls,
     providerAck,
+    requestId: request.requestId,
     ...(summary ? { summary } : {}),
   };
 }
```

## 3 · Why `requestId` is required

The §14 temporal model's `request_time` has exactly one authoritative source: the stamp the CST kernel itself
minted into the request id (`req:<idem>:<time.now()>`). The observer cannot read it because the value never
reaches it. Every alternative is a fabrication: re-clocking at observe time records when the OBSERVER ran, not
when the request was made, and any downstream-manufactured id would be a different identity wearing the same
name. Without this field, `request_time` can only ever be honestly ABSENT.

## 4 · Why the field is OPTIONAL

`readonly requestId?: string` is additive and non-breaking: every existing consumer of `GovernedSendResult`
compiles and behaves identically, and any persisted or reconstructed result predating the field remains valid.
Optionality also preserves the NP-015 absent≠null distinction — a result without the field is honestly missing
it, never a null that claims "asked and got nothing".

## 5 · Source of the value

`request.requestId` — the `TransitionRequest` object constructed in this same function, whose id the kernel
brands and uses. It is copied VERBATIM. **It is never manufactured downstream**, never re-derived, never
reformatted.

## 6 · Does any existing behavior change?

No. The field is added to a returned object literal. It is not read by `sendTransition`, not passed to the
kernel, not consulted by any predicate, and not present in any comparison. Control flow, the effect call, the
idempotency path, and every outcome classification are untouched.

## 7 · Threat analysis (both directions)

**If applied:** the request id becomes visible to any code holding a `GovernedSendResult`. The id contains the
idempotency hash and a timestamp — no credential, no recipient, no content. It already flows to the CST kernel
and its logs. The observer that will consume it (`actionRecord`) is tenant-scoped and stores fingerprints, not
content. Residual risk: an id is a correlation handle; it is already treated as such elsewhere (`transitionId`
is stored today), so this adds no new class of exposure. A hostile renderer cannot reach it — `GovernedSendResult`
never crosses the IPC boundary as a whole.

**If NOT applied:** `request_time` stays ABSENT forever and `ActionRecord.requestId` stays `''`. The temporal
model remains honestly incomplete — which is a legitimate resting state, and is where the system sits today.
The risk of not applying is nil; the cost is a permanently unfillable §14 field.

## 8 · Backward compatibility

Total. Optional field, additive to an interface, assigned unconditionally at one return site. No consumer
destructures exhaustively; no exhaustive `switch`; no serialization contract asserts a closed shape. Older
callers compile unchanged.

## 9 · Historical-record behavior

**Nothing is back-filled, ever.** Records written before this lands keep `requestId: ''` and
`requestTime: null`. The NP-015 absent≠null discipline is preserved and pinned: a historical row is honestly
missing the value, and no migration invents one.

## 10 · Test plan

1. The existing REALITY pin in `temporalModel.test.ts` **inverts by design**: it currently asserts
   `outcome.requestId === undefined`, `rec.requestId === ''`, `rec.requestTime === null`. After the gate it must
   assert the real id flows through and `requestTime` parses — the pin flipping is the acceptance test.
2. A new pin: `result.requestId === request-shaped` and identical to the id the kernel branded (same string, not
   merely same shape).
3. A no-behavior-change pin: the full `cst/sendTransition.negative.test.ts` suite (H-A…H-K hostile alphabet)
   runs unmodified and green.
4. Full main suite + UI suite.
5. `verify-e2e-strip` at the next window where `out/` is not ceremony-reserved.

**Note on `requestTimeFrom`:** production ids embed `time.now()` which is a NUMBER (epoch ms), not ISO, so the
current strict ISO matcher answers null on its own. **RULED (operator, 20 Aug 2026): the matcher extension folds
IN as this gate's NON-FROZEN ACCOMPANIMENT** — see §15.

## 15 · NON-FROZEN ACCOMPANIMENT (ruled to land WITH this gate, not before it)

**Ruling, quoted:** *"EXTEND the requestTime parser to read the kernel's epoch-embedded id — because that epoch
is the request-construction instant, the ONE thing the frozen clock truthfully measured."*

**Semantics, stated plainly (to be repeated verbatim in the closing evidence):**

> `requestTime` is **the kernel's request-construction instant, embedded at mint, read verbatim.** It is
> **never** a proxy for authorization time or execution time.

This is precisely what NP-019 proved the frozen clock DOES measure honestly: `SystemTime`'s base is
`Date.now()` at construction, and the request id is minted from it in the same breath. Every LATER phase stamp
repeats that same base and therefore measures nothing — which is why `authorization_time` and `execution_time`
stay ABSENT while this one value is real.

**Conditions honored (each ruled):**
1. **Conservative parse anchored to the documented id format.** `req:<idem>:<stamp>` — accept a trailing
   digits-only epoch, in a plausible range (bounded below by a fixed floor and above by a fixed ceiling, so a
   counter like `1`, a truncated id, or a far-future/garbage number yields **null, never a guess**). The
   existing ISO branch is retained unchanged, so both mint formats are read and neither is inferred.
2. **Pinned via the REALITY pin against real kernel-minted ids on the real path** — the existing
   `F-N19-2` describe block inverts: it currently asserts `requestId === ''` / `requestTime === null`; after
   this bracket it asserts the real id flows through and `requestTime` equals the epoch the kernel actually
   minted (compared against the id's own embedded value, not a recomputed clock).
3. **Evidence states the semantics plainly** — the sentence above, verbatim.

**Files:** `apps/desktop/src/main/connectors/actionRecord.ts` (`requestTimeFrom`) +
`apps/desktop/src/main/temporalModel.test.ts` (the REALITY pin inversion). Both PROCEED-class; gate-detector to
be run before either edit. They land in the accompaniment commit AFTER the isolated frozen commit, per the §2.2
choreography — never mixed into it.

## 11 · Proof no alternate path is used

`grep` for `GovernedSendResult` construction: the type is constructed at exactly ONE site — the single `return`
in `governedSend` (line ~284). `governedAction.ts` builds its own separate result type and is untouched. There
is no second producer to keep in sync.

## 12 · Proof no authority semantics change

`requestId` is not an input to any authority derivation. `deriveAuthority` takes `(capabilityId, target)`;
`mutationAssuranceFor` takes `(connectorId, capabilityId?)`; the CST kernel's authorization gauntlet reads
`req.approval`, `req.actor`, `req.target`, `decision.*` — never the caller's returned object. The field is
written on the way OUT, after every decision is final.

## 13 · Proof no execution behavior changes

The assignment occurs AFTER `await kernel.run(request, effect)` returns — the effect has already happened or
not. `effectCalls`, `providerAck`, the at-most-once latch, and the idempotency store are untouched. No new
branch, no new await, no new throw path.

## 14 · Proof no frozen surface beyond the one requested field is touched

The diff is two hunks in one file: one interface member + one object-literal property. `packages/shared`,
`runtimeCore.ts`, `connectors/index.ts`, `enterprise/index.ts`, `tenancy/tenantContext.ts` and `auth/` are not
touched. Within `cst/`, no other file and no other symbol changes. `gate-detector.sh` will be run on the path
before any edit, per standing law.

---

## Choreography if the token is given

Clean checkpoint → `freeze-baseline.sh` re-record → `verify-freeze.sh` INTACT #1 (committed) → apply EXACTLY the
diff above → full suites green → ONE isolated frozen-only commit → re-record → INTACT #2 (committed) → evidence
doc quoting the token verbatim and recording both baselines. **It never mixes into the reconciliation slice.**

**Token required (literal):**
`AUTHORIZED: FG-12 — GovernedSendResult.requestId additive optional field, per gate doc`

**Read-only confirmations requested before the token:**
1. `grep -n "requestId" apps/desktop/src/main/cst/sendTransition.ts` — shows the request-side id exists and the
   result type has none.
2. `bash certification/verify-freeze.sh` — INTACT.
3. `git status --short` — tree clean.
