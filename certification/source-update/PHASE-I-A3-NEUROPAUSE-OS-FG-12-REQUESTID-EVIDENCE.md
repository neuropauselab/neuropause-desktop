# FG-12 · `GovernedSendResult.requestId` — CLOSING EVIDENCE
## The TWELFTH frozen gate; the freeze never broken. F-N19-2 closes with this bracket.

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

**Status: TEST-VERIFIED.** Token honored; choreography walked; INTACT both sides. Zero external effects;
ceremony surfaces untouched; NP-000 = HOLD unchanged.

## The token (quoted verbatim, as given by the operator, 20 Aug 2026)

> AUTHORIZED: FG-12 — GovernedSendResult requestId field, per gate doc

Given after the operator ran the gate doc's three read-only confirmations, reported in their words: *"requestId
exists only on the request side (the import and the mint at line 206), no requestId member on
GovernedSendResult — genuinely additive; FREEZE INTACT with evidence-only commits since the baseline; tree
clean."*

*Recorded for exactness:* the gate doc's suggested string read `…GovernedSendResult.requestId additive optional
field…`; the token as given reads `…GovernedSendResult requestId field…`. Same gate, same subject, same doc,
issued with five enumerated conditions — noted here for the trail rather than treated as ambiguity.

## The bracket

- **INTACT #1:** `CERT-c2ff48a` @ commit `c2ff48a`, worktree clean (excludes `certification/`), verify-freeze
  INTACT — captured before any change.
- **FROZEN commit (isolated): `e9de0c0`** — EXACTLY the presented diff, nothing else, one file
  (`cst/sendTransition.ts`): the optional `readonly requestId?: string` on `GovernedSendResult`, and
  `requestId: request.requestId` — **verbatim from the transition request's own id**, never a
  downstream-manufactured identifier. Full main **871/9131→9128/3 green AT this commit** and typecheck clean
  before committing.
- **INTACT #2:** `BASELINE-b35d8c98e7df` @ `58a83c6` — re-recorded over green.
- **NON-FROZEN accompaniment: `74f0d89`** — lands AFTER, never mixed in (condition 3).

**A note worth recording: the frozen-only commit was GREEN on its own.** The REALITY pin asserted
`outcome.requestId === undefined` and `rec.requestId === ''`; FG-12 surfaces the id on the **RESULT**, leaving
the kernel's outcome envelope untouched, and the observer still read the outcome at that moment — so the pin
held. It inverted only when the accompaniment adapted the observer. The bracket therefore never passed through
a red state, and the gate's own acceptance test still fired exactly where it should.

## Conditions honored

1. **Choreography** — INTACT #1 → exactly the presented diff → suites green → isolated frozen commit → INTACT #2
   → accompaniment → evidence quoting the token. As above.
2. **ADDITIVE-OPTIONAL** — absent ⇒ exactly today's shape. No historical record changes (nothing is
   back-filled). No other frozen line moves: the committed diff is two hunks in one file, and the outcome
   envelope, the idempotency key, the effect path and every predicate are untouched.
3. **Accompaniment AFTER, never mixed** — separate commit, three parts: the observer adaptation (reads the id
   from the RESULT where FG-12 surfaced it, with the outcome kept as a fallback so a caller predating the field
   behaves identically); the §15 matcher extension; the REALITY pin inversion.
4. **The semantics line, verbatim:**

   > **`requestTime` is the kernel's request-construction instant, embedded at mint, read verbatim. It is never
   > a proxy for authorization time or execution time.**

   This is precisely the value NP-019 proved the frozen logical clock DOES measure honestly: `SystemTime`'s base
   is `Date.now()` at construction and the id is minted from it in the same breath. Every later phase stamp
   merely repeats that base and measures nothing — which is why `authorization_time` and `execution_time` remain
   ABSENT while this one is real.
5. **F-N19-2 CLOSES with this bracket.** The finding's fix is this gate. **The correction trail stays** — the
   NP-015 evidence keeps its ⚠ CORRECTION block, and CLAUDE §2 #17 keeps the law it produced.

## The matcher extension (§15) — conservative by construction

The ISO branch is unchanged. A second branch reads the production epoch mint: **digits ONLY, anchored at the
end, inside a plausible range** (floor 2001-09-09, ceiling 2286-11-20). Pinned to yield **null, never a guess**,
for: a counter (`:1`), a seconds-precision stamp, an out-of-range number, a non-digit-contaminated stamp, a
pre-stamp legacy id, and a shaped-but-unreal ISO. Representation is converted (epoch → ISO); **the instant is
never re-clocked**.

## The acceptance test — the REALITY pin inverted

It was written asserting the broken shape (`requestId === ''`, `requestTime === null`). It now asserts the
populated one, and **compares `request_time` against the id's OWN EMBEDDED VALUE** — extracted from the stored
id itself, never a clock read at assertion time — so it can only pass if the stored instant really is the one
the kernel minted. Two companion pins landed with it: the outcome envelope is still untouched by FG-12, and an
id with no parseable stamp still stores null (the gate did not weaken the discipline).

## Verification (all RUN)

Full main **871 files / 9131 passed / 3 skipped** (was 9128 — the delta is exactly the three new REALITY-pin
assertions) · UI **42 / 279** · typecheck node clean · lint clean · honesty scan **0 findings** · gate-detector
run on both accompaniment paths BEFORE editing (PROCEED) · verify-freeze INTACT at both brackets · zero external
effects.

## What now exists (claim-honest)

`request_time` populates on the real governed-send path for the first time, sourced from the kernel's own mint
and proven against the id itself. Of the §14 nine, the record now carries **request_time · event_time
(honestly null on this path) · effect_time · verification_time · record_time**; `authorization_time` and
`execution_time` remain **ABSENT** because NP-019 proved no honest source exists for them — and this gate did
not change that.
