# FG-7 — GATE DOC · the five-state write display on ConnectorSyncSnapshot (S19 display, closes F-5 end-to-end)

**Status: PRESENTED — awaiting the literal token. No frozen byte changes until the token arrives.**

## The token this gate waits for (verbatim)
```
AUTHORIZED: FG-7 — ConnectorSyncSnapshot five-state display, per gate doc
```
Silence is not consent; only the token is consent. A diff that changes after the token needs a new token.

## Gate-ledger note
FG-1 contracts/channels · FG-2 runtimeCore · FG-3 assistant envelope · FG-4 connectors guard · FG-5 action-record emit ·
FG-6 local AuthStatus. FG-7 is the S19 display: it carries the truthful five states (already derived non-frozen by
`m365WriteStates`) to the renderer, which requires the frozen `ConnectorSyncSnapshot` type to declare the field.

## 1 · Why
S19 established the counter TRUTH: the old "Writes = writeCount" is DISJOINT from the governed send (F-5), and the five
states (REQUESTED/AUTHORIZED/EXECUTED/PROVIDER_ACKNOWLEDGED/EXTERNALLY_OBSERVED) derive from the single S34a ActionRecord
store (`connectors/m365WriteStates.ts`, non-frozen, tested). But `ConnectorSyncSnapshot` — the type `M365WritePanel`
reads — lives in FROZEN `packages/shared/src/types/connectors.ts`. To REPLACE the displayed "0 / never" with the truthful
states, the snapshot must carry them. That one additive field is the only frozen touch.

## 2 · The frozen change — ONE additive optional field, verbatim
`packages/shared/src/types/connectors.ts`, in `ConnectorSyncSnapshot`, after the P2.4 write metrics:
```
   lastWriteLatencyMs?: number | null;
   apiQuotaRemaining?: number | null;
+  /**
+   * S19 — the five TRUTHFUL write states, DERIVED from the S34a ActionRecord store
+   * (one source of truth). Present once any governed M365 write has been recorded;
+   * optional for older state and older builds. Replaces the disjoint `writeCount`
+   * in the panel (F-5): each number provably derives from a governed send that
+   * actually happened, not from a code path the send skips.
+   */
+  writeStates?: {
+    requested: number;
+    authorized: number;
+    executed: number;
+    providerAcknowledged: number;
+    externallyObserved: number;
+  } | null;
   /** P4.1 — true when the account's sync exhausted its retry budget and was dead-lettered (needs replay). */
   deadLettered?: boolean;
```
**Additive-only:** an optional field. Every existing producer/consumer compiles and behaves unchanged (absent ⇒ the
panel falls back exactly as today); no field is removed or retyped.

## 3 · Non-frozen accompaniment (NOT token-gated)
- **`unified/sync/index.ts` `snapshots()`** (non-frozen) — join `m365WriteStates(activeTenantId)` into each M365
  snapshot's `writeStates` before broadcast/return. One source of truth (the ActionRecord); no `recordRun`, no parallel
  counter.
- **`M365WritePanel.tsx`** (renderer, non-frozen) — RETIRE the generic "Writes = writeCount / Last write = never" metric;
  render the five states from `snap.writeStates` (REQUESTED → AUTHORIZED → EXECUTED → PROVIDER_ACKNOWLEDGED →
  EXTERNALLY_OBSERVED, the honest funnel). Absent ⇒ "no governed writes yet", never a fabricated 0.
- **Truthful-surface tests** — a `*Model`-style test pins every displayed number derives from `writeStates` (its source),
  and the renderer full-suite rule (CLAUDE §3) applies: the FULL main suite runs before the renderer commit lands.

## 4 · Threat analysis — both directions
**Frozen → the rest.** An additive optional field cannot break a producer or consumer — older persisted snapshots and
older builds simply omit it (the panel falls back as today). It carries DERIVED COUNTS only — no capability, token,
recipient, or authority. Nothing downstream gains power from reading it.
**The rest → frozen.** `writeStates` is populated ONLY by the non-frozen join from the ActionRecord source of truth; the
renderer merely displays it. No authority flows through the field; a hostile renderer reading it changes nothing.

## 5 · Verification plan
- Truthful-surface test: `writeStates` counts equal `deriveWriteStates(records)` for the tenant; the panel shows exactly
  those numbers (no independent recomputation).
- F-5 end-to-end: an ACKNOWLEDGED governed send now displays `providerAcknowledged ≥ 1` (not "0 / never").
- EXTERNALLY_OBSERVED shown honestly as 0 until S16 feeds `recordVerification` — never a false success.
- Full main + UI + typecheck + lint + verify-e2e-strip green (renderer rule).
- **Read-only confirmations for you:** `sed -n '358,388p' packages/shared/src/types/connectors.ts` (the field is
  additive/optional) · `bash certification/verify-freeze.sh | tail -3`.

## 6 · Landing choreography (after the token)
Checkpoint (clean) → re-record → INTACT #1 → apply the §2 additive field + the non-frozen join + the panel swap + tests
→ FULL main + UI + typecheck + lint + verify-e2e-strip green → isolated frozen commit → re-record → INTACT #2 → evidence
(token verbatim, both baselines, the truthful-surface derivation, the retired old counter).
