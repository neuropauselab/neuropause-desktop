# SLICE 19 — Counter truth (closes F-5) · EVIDENCE

**Status: CORE CLOSED — TEST-VERIFIED (non-frozen). Display swap is one FG gate away.** The untruthful
"Microsoft 365 writes" counter is replaced, in LOGIC, by five states derived from the single S34a source of truth; the
F-5 mismatch is reproduced and made truthful. Surfacing the states in the renderer touches the FROZEN
`ConnectorSyncSnapshot`, so it is presented as a gate (below), not taken silently. FREEZE INTACT.

## Definition pass (written BEFORE code)
`certification/source-update/S19-COUNTER-DEFINITION-PASS.md`. Headline: the old "Writes"/"Last write" counter's
authoritative source (`SyncStateStore.writeCount`, incremented only in `M365Executor.execute`) is DISJOINT from the
governed `mail.send` path (which returns via `mapSendOutcome`, never calling `health.recordRun`). So the S15 send —
AUTHORIZED ✓ ACKNOWLEDGED ✓ EXTERNALLY OBSERVED ✓ — displayed "0 / never". A single generic number cannot be truthful:
a consequential send is five facts, each a different layer of truth.

## The five states — one source of truth (`connectors/m365WriteStates.ts`, non-frozen)
`deriveWriteStates(records)` folds S34a `ActionRecord[]` → nested counts (each TRUE only on its own evidence):
| state | source (ActionRecord field) |
|---|---|
| REQUESTED | the record exists |
| AUTHORIZED | `verdict === 'ALLOW'` |
| EXECUTED | `executed === true` |
| PROVIDER_ACKNOWLEDGED | `outcome === 'ACKNOWLEDGED'` |
| EXTERNALLY_OBSERVED | `verification.terminal === 'VERIFIED_SUCCESS'` |
`m365WriteStates(tenantId)` reads `actionRecord.query({tenantId})` and derives — **one source of truth, no parallel
counting** (we did NOT re-add a `health.recordRun` to the frozen send path). EXTERNALLY_OBSERVED is reported honestly as
0 until S16 `verifyEffect` feeds `recordVerification` (its field exists; the feeder is an unwired non-frozen follow-on) —
never a false success.

## F-5 reproduced, then made truthful (`m365WriteStates.test.ts`, 7 tests)
- **OLD counter (the bug, still true of the sync snapshot):** a governed send that bypassed the executor leaves the
  account's write metrics unset → the panel projection `writeCount ?? 0 = 0`, `lastWriteAt ?? null = never`. Pinned.
- **NEW reader (truthful):** the SAME acknowledged send, derived from the ActionRecord it actually wrote →
  `requested/authorized/executed/providerAcknowledged = 1`, `externallyObserved = 0` (honest). Pinned.
- Plus: the funnel nests (DENIED → requested 1, authorized 0); externally-observed counts ONLY on VERIFIED_SUCCESS (a
  VERIFIED_FAILED never counts as observed); `lastAt` is the latest; the store-backed reader is tenant-isolated.

## Proofs (RUN against the new baseline)
- `m365WriteStates.test.ts` — **7** (derivation funnel, verified-only, nesting, lastAt, F-5 regression ×2, store-backed
  tenant-isolated). Full main + typecheck node + lint clean.

## Remaining — the display swap (FROZEN, needs an FG gate)
`ConnectorSyncSnapshot` (the type `M365WritePanel` reads) is in FROZEN `packages/shared/src/types/connectors.ts`. To
REPLACE the displayed "Writes = 0 / never" with the five truthful states, the counts must reach the renderer — either by
adding the five fields to `ConnectorSyncSnapshot` (join them in the non-frozen `unified/sync` snapshot from
`m365WriteStates`) or via a new IPC channel — both FROZEN (`packages/shared`). This is presented as a gate (the counter
TRUTH is established + tested here; the user-visible swap awaits the token). Until then the panel still shows the old
number — honestly flagged, not silently left as "closed".

## Honest label
The counter's TRUTH (the single source of truth + the F-5 regression + the truthful derivation) is TEST-VERIFIED and
non-frozen. The renderer DISPLAY of the five states is an explicit, gated follow-on — F-5's user-visible symptom persists
until that gate lands. Nothing here claims the panel is fixed; it claims the truthful counter now EXISTS and is proven.
