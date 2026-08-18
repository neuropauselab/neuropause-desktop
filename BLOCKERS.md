# BLOCKERS.md — active blockers (living, untracked)
Per CLAUDE.md §3: a blocker is logged after 3 genuine fix attempts OR when a human gate is required. Format: symptom · attempts/why · hypothesis · what unblocks.

## OPEN
- (none)

## GOVERNANCE / DECISIONS PENDING
- (none)

## RESOLVED
- **B-2 · FG-3 — the assistant→panel mail-intent carrier needs a frozen `AssistantEnvelope` field (human gate).** RESOLVED by token `AUTHORIZED: FG-3 — AssistantEnvelope.mailIntent additive optional field, per gate doc`. Landed `de64dd0` (one additive optional field + coupled non-frozen wiring); INTACT bracket 92a99c8 → 1ed71cc (BASELINE-52d9a12099f3). Rule-4 one surface via the S12 feed (D-7).
- **B-1 · FG-2 — handler registration needs a frozen `runtimeCore.ts` line (human gate).** RESOLVED by token `AUTHORIZED: FG-2 — runtimeCore capability registration, two additive lines (import + push), per gate doc`. Landed as `5534c45` (2 frozen lines + a pre-authorized non-frozen typing-fix fallback — TS2345 contravariance exposed on wiring; see the FG-2 gate doc EXECUTION RECORD). INTACT #3 `2668ab8` / break `5534c45` / INTACT #4 `aff5d13` (BASELINE-0df776a6a740). The channel is now live-registered, data-only.
- **Living-docs freeze scope.** RESOLVED per DECISIONS.md D-5: the four root docs are now TRACKED and excluded from the freeze source spec by exact filename; committed from FG-2 onward. Supersedes D-4.
