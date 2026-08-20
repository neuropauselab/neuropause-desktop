# NP-015 · NINE-TIMESTAMP COMPLETION — CLOSING EVIDENCE
## NP-012 §3 ruling, slice 3 of 6. ARCHITECTURE-SPEC §14's temporal model reaches the evidence record. Includes the NP-014 call-site landing under the operator's explicit go.

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

**Status: TEST-VERIFIED.** Zero external effects; ceremony surfaces untouched; NP-000 = HOLD unchanged.

## The authorizations, quoted verbatim (operator, 20 Aug 2026)

The NP-014 remainder:

> GO — the presented s16VerifyRun.ts provenance diff is AUTHORIZED exactly as shown. Apply it, restore the
> call-site source pin to the suite, full main green, evidence quoting this go.

The NP-015 envelope:

> NP-015 COMBINED RULING (as you proposed): the sensitive-class diffs at this same call site and in
> verification/ are PRE-AUTHORIZED within this exact envelope:
> - ADDITIVE ONLY: event_time / effect_time / request_time fields on the ActionRecord verification payload and
>   its types;
> - effect_time populated ONLY from provider read-back data where the oracle supplies it — honestly null
>   otherwise, never derived or approximated;
> - ZERO behavior change to the read-back logic, matching, or anything in latch/send-path proximity;
> - the applied diffs are PRESENTED verbatim (before/after) in the completion report regardless of
>   pre-authorization.
> Anything outside that envelope → STOP and present first, exactly as today.

Both honored. The NP-014 diff was applied byte-identical to the presented text (verified by `git diff`), and
the call-site source pin is restored (`constitutionalInvariants.test.ts`, RULE-012, suite back to 26 tests).

## What landed

**The governing discipline, stated once and pinned everywhere:** *a time we were not told is ABSENT, not
approximated.* Every field below is either read from a stamp someone else really made, or null.

1. **`request_time`** — `ActionRecord.requestTime` (PROCEED-class file). READ from the kernel-minted
   `requestId` (`req:<idem>:<stamp>`) by `requestTimeFrom()`, a strict end-anchored ISO matcher that also
   requires `Date.parse` to succeed.

   > **⚠ CORRECTION (NP-019, same day — F-N19-2, self-caught).** This description overstated what the field
   > does TODAY. Driving the REAL `governedSend` into the REAL observer showed that `TransitionOutcome` carries
   > **no `requestId` field at all** (it lives on the transition REQUEST and never comes back), so the observer
   > stores `requestId: ''` and **`requestTime` is structurally NULL on every real governed send**. The FIELD
   > behaved exactly as designed — null, never a guess — but the sentence above describes a path that does not
   > fire in production. Root cause, recorded as a standing lesson: the pins below used a hand-built
   > `GovernedSendResult` fixture carrying `outcome.requestId` — **a fixture more generous than reality** — which
   > is why a green suite hid it. A REALITY pin driving the real path now asserts the true shape
   > (`requestId === ''`, `requestTime === null`). The real fix requires surfacing the requestId on
   > `GovernedSendResult` in FROZEN `cst/sendTransition.ts`, so it is PRESENTED as an FG gate, never worked
   > around. See `…NP-019-TEMPORAL-SEMANTIC-MAPPING-EVIDENCE.md`. Deliberately strict because BOTH halves of the id carry colons (the idem
   may, and an ISO stamp always does), so neither a left- nor a right-split is safe. A legacy id, an epoch
   clock port, or a truncated id yields **null**, never a guess. It never re-clocks.
2. **`event_time`** — `ActionRecord.eventTime`, supplied only by a caller that genuinely observed the
   occasioning event (`ObserveContext.eventTime`, optional). **Null on today's only production path**: the
   governed send carries no upstream event stamp — an operator's confirm is not timestamped into the payload.
   Present-and-null is the honest state; the concept is modeled, the value is absent, and nothing fabricates
   one from the request or the clock. §14's own warning is why the two stay distinct: temporal precedence is
   not causal evidence.
3. **`effect_time`** — `ActionRecordVerification.effectTime`, fed by the new `VerifyResult.observedEffectAt`,
   which carries the corroborated Sent Items row's `sentDateTime` **verbatim**. Null on every non-corroborated
   path (bounce, HOLD, no match). The optional-AND-nullable typing is deliberate: **ABSENT** = written before
   the field existed (never back-filled — the S15/S16 chain is untouched); **NULL** = this verification ran and
   the oracle supplied no effect time.
4. **`verification_time` / `record_time`** — already existed (`verification.at`, `record.at`); their doc
   comments now name their §14 role so nobody re-purposes them.

**A property discovered while pinning, not assumed:** a Sent Items row whose `sentDateTime` does not parse
CANNOT corroborate at all — the timestamp window is part of the corroboration tuple, so it HOLDs. Therefore a
VERIFIED_SUCCESS always carries a real provider instant; there is no success path that could want a borrowed
one. That is now a pin rather than a hope.

## The applied sensitive-class diffs, verbatim (envelope condition 4)

`apps/desktop/src/main/verification/verifyEffect.ts` — one additive result field + its four construction sites:

```diff
   readonly attempts: number;
   readonly detail: string;
+  /** NP-015 — `effect_time` (§14) … verbatim from the corroborated Sent Items row … never our clock,
+   *  never the verification time, never inferred from the window … changes no matching, no schedule, no read. */
+  readonly observedEffectAt: string | null;
 }
-        return { state: 'VERIFY_FAILED', …, detail: `bounce/NDR observed: ${reason}` };
+        return { state: 'VERIFY_FAILED', …, detail: `bounce/NDR observed: ${reason}`, observedEffectAt: null };
-      return { state: 'VERIFIED_SUCCESS', …, detail: 'corroborated match in Sent Items (…)' };
+      return { state: 'VERIFIED_SUCCESS', …, detail: 'corroborated match in Sent Items (…)', observedEffectAt: hit.sentDateTime ?? null };
-  return { state: 'HOLD', …, detail: 'not observed after bounded backoff — UNKNOWN, …' };
+  return { state: 'HOLD', …, detail: 'not observed after bounded backoff — UNKNOWN, …', observedEffectAt: null };
```

`apps/desktop/src/main/e2e/s16VerifyRun.ts` — the call site (NP-014's authorized provenance object plus
NP-015's effect_time pass-through):

```diff
         at: new Date().toISOString(),
+        // NP-015 / §14: effect_time — the PROVIDER's own stamp for the matched
+        // Sent Items row, verbatim from the oracle. Null unless corroborated.
+        effectTime: result.observedEffectAt,
+        // NP-014 / RULE-012: verification evidence names its provenance.
+        provenance: {
+          source: 's16VerifyRun',
+          method: 'corroborated-read-back (recipient+subject+timestamp window; never id alone)',
+          oracle: 'm365ReadBack:sentItems+inbox',
+        },
       });
```

**Envelope compliance:** both diffs are ADDITIVE ONLY (one new result field, one new record field, one
pass-through); `matchesTuple`, `bounceReason`, the backoff schedule, the reader calls, the latch handling and
every send-path line are UNTOUCHED — the corroborated row was already found, and only a value it already
carried is carried out. No behavior changed on any path: the full verification suite runs unmodified and green.

## The pins — `src/main/temporalModel.test.ts` (13 tests)

request_time reads past the colons in both halves · answers null for epoch/counter/legacy/shaped-but-unreal
ids · is deterministic (never falls back to the clock) · effect_time is the provider's instant and explicitly
NOT the verification instant · HOLD and BOUNCE carry none · an untimeable row cannot corroborate · the record
holds request/event/record as three distinct instants with event honestly null on the send path · a caller
that DID observe an event has its stamp stored verbatim and ordered before the request · the full ordering
request → effect → verification → record asserted on one record · HOLD verification stores effect_time null ·
the production call site passes the oracle's instant through untouched and is source-pinned against re-clocking.

## Honest bounds (what this slice does NOT claim)

- **Three of nine landed.** `observation_time`, `proposal_time`, `authorization_time`, `execution_time` remain
  ABSENT from the record. Recorded finding, NOT built: the CST kernel's `TransitionOutcome.timeline` already
  stamps `decided` / `claimed` / `executionStarted` / `executionCompleted` / `verified` — a genuine source for
  authorization_time and execution_time exists and is a candidate follow-up. It sits OUTSIDE the ruled
  envelope, so no code touched it and no claim is made about it.
- `event_time` is structurally null in production today; the mapping's §14 row moves PARTIAL → PARTIAL
  (better-founded), never CONFIRMED.
- No historical record was back-filled; absent stays absent.
- `verify-e2e-strip` deliberately NOT re-run (it rebuilds `out/` as release; the armed ceremony build stays the
  LAST build). Seed chunk `e2eSeed-DzsziIdg.js` verified present after all work — the standing guard.

## Verification (all RUN)

`temporalModel.test.ts` 13/13 · `constitutionalInvariants.test.ts` 26/26 (call-site pin restored) · the full
`verification/` suite + actionRecord + m365WriteStates + s5MockLoop 76/76 unmodified · typecheck node clean ·
lint clean · honesty scan 0 findings · ceremony seed chunk `e2eSeed-DzsziIdg.js` verified present after all
work · **full main suite 868 files / 9074 passed / 3 skipped** (was 867/9060/3 — the delta is exactly the 13
new temporal pins plus the restored RULE-012 call-site pin; zero regressions, and the untouched verification
suite passing unmodified is itself the no-behavior-change proof).
