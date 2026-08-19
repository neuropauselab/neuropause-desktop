# SLICE 19 — Counter truth (closes F-5) · EVIDENCE

**Status: CLOSED — F-5 fixed END-TO-END (reproduction → truthful derivation → truthful display).** The untruthful
"Microsoft 365 writes" counter is retired; the panel now shows five states, each provably derived from the single S34a
ActionRecord source of truth. The display swap landed via **FG-7** (one additive optional `ConnectorSyncSnapshot`
field). FREEZE INTACT (both brackets recorded).

## The FG-7 token (honored, verbatim) + bracket
```
AUTHORIZED: FG-7 — ConnectorSyncSnapshot five-state display, per gate doc
```
Checkpoint `BASELINE-58024ee849b0` (INTACT #1) → the additive field + non-frozen join + panel swap + tests → INTACT #2
`BASELINE-959735ab2a6a`. Gate doc: `FG-7-WRITESTATE-DISPLAY-GATE.md`.

## The display (F-5's user-visible symptom, now fixed)
- FROZEN: one additive optional `ConnectorSyncSnapshot.writeStates` (five counts) — no field removed/renamed/retyped.
- Non-frozen: `unified/sync` joins `m365WriteStates(tenant, connector, account)` (async, tenant resolved sync in the
  principal context) onto each M365 snapshot — ONE source of truth, no parallel counting. `M365WritePanel` RETIRES the
  disjoint "Writes / Last write" and shows REQUESTED/AUTHORIZED/EXECUTED/PROVIDER_ACKNOWLEDGED/EXTERNALLY_OBSERVED;
  absent → "No governed writes yet" (honest absence, never a fake 0); EXTERNALLY_OBSERVED shows 0 until
  `recordVerification` feeds it. Truthful-surface tests (`ui-tests/m365WriteStatesDisplay.test.tsx`, 3): each displayed
  number equals `snap.writeStates`; the fallback shows honest absence + the old counter is gone.

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

## F-5 — fully closed (walked)
1. **Reproduced:** an ACKNOWLEDGED governed send left the old `writeCount` at 0 / `lastWriteAt` never (the counter's
   source was disjoint from the send path) — pinned by `m365WriteStates.test.ts`.
2. **Truthful derivation:** the same send, derived from the ActionRecord it wrote, → requested/authorized/executed/
   providerAcknowledged ≥ 1 (one source of truth) — pinned.
3. **Truthful display:** the panel now shows those five states, each equal to its source; the old disjoint counter is
   retired — pinned by the ui-tests. F-5's user-visible symptom is gone.

## Honest label
S19 CLOSED. The counter is TRUTHFUL end-to-end: five states, each provably derived from the single S34a ActionRecord,
displayed. EXTERNALLY_OBSERVED is honestly 0 until the S16 verification feeder (`recordVerification`) is wired — a small
non-frozen follow-on, never inferred or padded.
