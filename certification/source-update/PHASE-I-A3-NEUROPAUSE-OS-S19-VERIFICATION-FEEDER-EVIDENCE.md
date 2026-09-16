# S19 · the recordVerification FEEDER (EXTERNALLY_OBSERVED becomes real) · EVIDENCE

**Status: LANDED — TEST-VERIFIED, non-frozen, no FG gate.** The S16 in-session verify path now feeds the S34a
ActionRecord, so `EXTERNALLY_OBSERVED` counts REAL verified effects. FREEZE INTACT.

## What landed
- **`s16VerifyRun.ts`** (compile-gated, non-frozen): after the `verifyEffect` terminal, it queries the ActionRecord for
  the send (by tenant + recipient) and, if a record exists, calls `actionRecord.recordVerification(transitionId,
  { terminal, internetMessageId, at })`.
- **Full-chain test** (`m365WriteStates.test.ts` → `FULL CHAIN (§2)`): observe an ACKNOWLEDGED send → `EXTERNALLY_OBSERVED
  = 0` (honest, unverified) → `recordVerification('…','VERIFIED_SUCCESS')` → `EXTERNALLY_OBSERVED = 1`, derived from the
  store alone. The panel then shows it via the FG-7 join (ui-tests already pin display ← writeStates).

## PROSPECTIVE-ONLY (binding rule, stated here)
The feeder attaches ONLY to an EXISTING transition record (the S34a attachment discipline — proven: an unknown
transition creates no phantom). The FG-5 observer began recording AFTER the S15 first real send, so **there is NO
ActionRecord for S15/S16** — the feeder finds none and attaches nothing. **The historical S15/S16 chain is NEVER
retro-inserted into the live ActionRecord** — a backfilled row would be a FABRICATED observation (the observer was not
running then). That chain stays in certification evidence (SLICE-15/16). Only FUTURE verified sends — recorded by the
observer, then verified in-session — feed the store and raise `EXTERNALLY_OBSERVED`. `s16VerifyRun` logs this explicitly
when it finds no record.

## Scope (honest)
This wires the IN-SESSION verify path (`s16VerifyRun`, compile-stripped from release — verify-e2e-strip PASS). A standing
PRODUCTION verification loop (a reconciler driving the oracle on every governed send) is S22 territory; until then,
`EXTERNALLY_OBSERVED` reflects effects verified via the operator's in-session read-back, honestly 0 otherwise — never
inferred, never padded.

## Proofs
`m365WriteStates.test.ts` (8, incl. the full-chain 0→1). Full main **8810 passed / 3 skipped** · typecheck node + lint
clean · verify-e2e-strip PASS (s16VerifyRun + its new actionRecord call stay stripped from release).
