# BLOCKERS.md — active blockers (living, untracked)
Per CLAUDE.md §3: a blocker is logged after 3 genuine fix attempts OR when a human gate is required. Format: symptom · attempts/why · hypothesis · what unblocks.

## OPEN

### B-2 · FG-3 — the assistant→panel mail-intent carrier needs a frozen `AssistantEnvelope` field (human gate)
- **Symptom:** the Slice-13 assistant-initiated flow must render the proposal in the ONE existing `M365WritePanel` via the S12 feed (rule 4), but the trusted generator runs in MAIN and the panel in the RENDERER — the structured `{to,subject,body}` has no home on `AssistantEnvelope`.
- **Why (source-proven):** `AssistantEnvelope.draft` is `{kind,text,note}` and `navigation.query` is a bare string; carrying structured params through either would smuggle authority-relevant data through a string (routing around the frozen boundary — forbidden by the Slice-13 rules). `packages/shared` is a frozen surface (D-6). The envelope has no wire zod-schema and is built via `baseEnvelope`, so an additive-OPTIONAL field is safe (verified).
- **Minimum fix:** one additive optional field `mailIntent?: { to: string[]; subject: string; body: string } | null` on `AssistantEnvelope`.
- **Unblocks on:** token `AUTHORIZED: FG-3 — AssistantEnvelope.mailIntent additive optional field, per gate doc`. Gate presented (verbatim diff + threat analysis + verification plan); DECISIONS D-7. Non-frozen wiring prepped to land on token.

## GOVERNANCE / DECISIONS PENDING
- (none)

## RESOLVED
- **B-1 · FG-2 — handler registration needs a frozen `runtimeCore.ts` line (human gate).** RESOLVED by token `AUTHORIZED: FG-2 — runtimeCore capability registration, two additive lines (import + push), per gate doc`. Landed as `5534c45` (2 frozen lines + a pre-authorized non-frozen typing-fix fallback — TS2345 contravariance exposed on wiring; see the FG-2 gate doc EXECUTION RECORD). INTACT #3 `2668ab8` / break `5534c45` / INTACT #4 `aff5d13` (BASELINE-0df776a6a740). The channel is now live-registered, data-only.
- **Living-docs freeze scope.** RESOLVED per DECISIONS.md D-5: the four root docs are now TRACKED and excluded from the freeze source spec by exact filename; committed from FG-2 onward. Supersedes D-4.
