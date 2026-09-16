# S19 — Counter truth · DEFINITION PASS (written BEFORE any code)

Per Consolidated Directive v3 §4.1: for each "Microsoft 365 writes" counter, state what it CLAIMS to measure, its
authoritative source, and whether the S15 event satisfies that definition. No code until this is written down.

## The counter today
- **Displayed:** `renderer/.../connectors/M365WritePanel.tsx` — "Writes" = `snap.writeCount ?? 0`; "Last write" =
  `snap.lastWriteAt ? … : 'never'` (L122‑123), under the header **"Microsoft 365 writes"**.
- **Source:** `unified/sync/syncStateStore.ts` `AccountSyncState.writeCount` / `lastWriteAt`, surfaced via the
  `connectors:sync-state` snapshot.
- **The ONLY writer:** `connectors/m365/executor.ts:137‑144` (`M365Executor.execute` success branch) calls
  `health.recordRun({ writeCount: cur+1, lastWriteAt })`. (`connectorService.recordWrite` only appends to the activity
  feed — NOT this counter; it is a red herring.)

## What it CLAIMS vs what it MEASURES (the lie)
- **Claim:** "N Microsoft 365 writes have happened" (a completed write, with a last‑write time).
- **Authoritative source:** `SyncStateStore.writeCount`, incremented ONLY inside `M365Executor.execute`.
- **Does the S15 event satisfy the definition? NO.** The governed `mail.send` (frozen `connectors/index.ts` L601‑636)
  runs through `governedSend` and returns via `mapSendOutcome`; it **never calls `health.recordRun`**. So the S15 first
  real send — AUTHORIZED ✓, ACKNOWLEDGED ✓ (Graph 202), EXTERNALLY OBSERVED ✓ (VERIFIED_SUCCESS) — left `writeCount = 0`
  and `lastWriteAt = null`. The displayed number reads **"0 / never"** for a fully acknowledged, externally‑confirmed
  send. **The counter's source is disjoint from the path it claims to count** — that is F‑5, precisely.
- **Deeper defect:** a single generic "writes" number has no honest definition of "write". A consequential send is not
  one fact but FIVE, each with a different layer of truth. Collapsing them into one number, sourced from a code path the
  governed send doesn't take, cannot be truthful by construction.

## The replacement — FIVE states, each its own definition + authoritative source + S15 verdict
Authoritative envelope: `GovernedSendResult` (`cst/sendTransition.ts`) → recorded per send by S34a
`ActionRecord` (`connectors/actionRecord.ts`): `verdict`, `executed`, `outcome`, `verification`.

| State | CLAIMS to measure | Authoritative source (ActionRecord field) | S15 event satisfies? |
|---|---|---|---|
| **REQUESTED** | a governed send was requested | the record EXISTS (one per governed request) | YES — a record is written |
| **AUTHORIZED** | governance admitted it (verdict ALLOW) | `verdict === 'ALLOW'` | YES — authorized |
| **EXECUTED** | the effect ran exactly once | `executed === true` | YES — executed once |
| **PROVIDER_ACKNOWLEDGED** | the provider accepted it (Graph 202) | `outcome === 'ACKNOWLEDGED'` | YES — 202 |
| **EXTERNALLY_OBSERVED** | an independent oracle corroborated the effect | `verification.terminal === 'VERIFIED_SUCCESS'` | YES externally (S16 returned VERIFIED_SUCCESS) — **but NOT yet derivable from the store**: `recordVerification` has no production caller (S16 `verifyEffect` is unwired), so the field is `null` in production |

These NEST honestly (requested ≥ authorized ≥ executed ≥ acknowledged ≥ externally‑observed) — a funnel, never a single
inflated number. Each state is TRUE only when its own layer's evidence says so; UNKNOWN/UNAVAILABLE never becomes a count.

## One source of truth — no parallel counting
All five states derive from the **single S34a `ActionRecord` store** (already fed by the FG‑5 observer emit). Four derive
today; **EXTERNALLY_OBSERVED's field exists but its feeder is missing** — S16 `verifyEffect` must call
`recordVerification`. So S19 reports EXTERNALLY_OBSERVED honestly as **"0 / not yet observed"** until that non‑frozen
feeder is wired (a follow‑on), never as a false success. **We do NOT re‑add a `health.recordRun` to the frozen mail.send
branch** — that would re‑introduce a second, parallel counter (and a frozen touch). Derive, don't double‑count.

## Truthful‑surfaces rule (S19 doctrine) + the regression
- Every displayed state count must PROVABLY derive from the ActionRecord store, pinned by a test (the S34a store is the
  source; a pure `deriveWriteStates(records)` reader is the derivation).
- **Regression (reproduce F‑5, then make it truthful):** an ACKNOWLEDGED governed `mail.send` — the OLD counter reads
  `writeCount === 0` / `lastWriteAt === null` (the bug, still true of the sync snapshot); the NEW five‑state reader over
  the ActionRecord store reports `requested ≥ 1, authorized ≥ 1, executed ≥ 1, providerAcknowledged ≥ 1` (and
  `externallyObserved` only once the verification feeder runs). The displayed truth now derives from the send that
  actually happened.

## Frozen boundary
- The five‑state reader is a NON‑FROZEN pure fold over `actionRecord.query` — no frozen touch.
- Surfacing the counts: if it can ride the existing `connectors:sync-state` snapshot join in NON‑FROZEN
  `unified/sync/*` without changing a shared type, no gate; if a new shared type/IPC channel is required
  (`packages/shared/channels.ts` is frozen), that is a separate FG gate, flagged — NOT taken silently.
