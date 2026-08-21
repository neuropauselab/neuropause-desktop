/**
 * S19 — counter truth for "Microsoft 365 writes" (closes F-5).
 *
 * The old counter (`SyncStateStore.writeCount`) is incremented ONLY inside
 * `M365Executor.execute`, which the governed `mail.send` path bypasses — so an
 * ACKNOWLEDGED send read "0 / never" (F-5). This replaces the single generic
 * number with FIVE states, each TRUE only when its own layer's evidence says so,
 * DERIVED from the single S34a ActionRecord store (one source of truth — no
 * parallel counting, no re-increment on the frozen send path).
 *
 * The states NEST (requested ≥ authorized ≥ executed ≥ acknowledged ≥
 * externally-observed) — a funnel, never one inflated number. EXTERNALLY_OBSERVED
 * is reported honestly: 0 until S16 `verifyEffect` feeds `recordVerification`.
 */
import type { ActionRecord } from './actionRecord';
import { actionRecord, EXECUTION_NOT_STARTED } from './actionRecord';
import { isSuccessTerminal } from '../verification/verificationTerminals';

export interface WriteStateCounts {
  /** A governed send was requested — one record exists. */
  readonly requested: number;
  /** Governance admitted it — verdict ALLOW. */
  readonly authorized: number;
  /** The effect ran exactly once — executed. */
  readonly executed: number;
  /** The provider accepted it — Graph 202 / ACKNOWLEDGED. */
  readonly providerAcknowledged: number;
  /** An independent oracle corroborated it — a success terminal (per the D-16 authority). */
  readonly externallyObserved: number;
  /** The most recent record time, or null when there are none. */
  readonly lastAt: string | null;
}

/** Pure derivation of the five states from action records (the testable core). */
export function deriveWriteStates(records: readonly ActionRecord[]): WriteStateCounts {
  /**
   * ROUTE A (F-P24) — GOVERNANCE ROWS ARE EXCLUDED, AND THE REASON IS CLAIM-LANGUAGE, NOT TIDINESS.
   *
   * These five states describe **WRITE ATTEMPTS THAT REACHED THE EXECUTOR.** A governance refusal never became
   * one — its execution is NOT_STARTED — so counting it as `requested` would claim a write was requested when
   * none was. **That is the F-5 defect in the very counter built to fix F-5**, which is why the filter is here
   * rather than at the call site: any caller of the pure core gets the truthful answer.
   *
   * WIDENING the funnel to show governance events as their own state is a DIFFERENT product decision — it would
   * make this counter mean "governance events" rather than "writes" — and is deliberately NOT taken here.
   */
  const attempted = records.filter((r) => r.outcome !== EXECUTION_NOT_STARTED);
  let requested = 0;
  let authorized = 0;
  let executed = 0;
  let providerAcknowledged = 0;
  let externallyObserved = 0;
  let lastAt: string | null = null;
  for (const r of attempted) {
    requested += 1;
    if (r.verdict === 'ALLOW') authorized += 1;
    if (r.executed === true) executed += 1;
    if (r.outcome === 'ACKNOWLEDGED') providerAcknowledged += 1;
    if (isSuccessTerminal(r.verification?.terminal)) externallyObserved += 1; // D-16 canonical authority
    if (lastAt === null || r.at > lastAt) lastAt = r.at;
  }
  return { requested, authorized, executed, providerAcknowledged, externallyObserved, lastAt };
}

/**
 * The five states for a tenant's Microsoft 365 writes, read from the single
 * ActionRecord source of truth. Every number here PROVABLY derives from a
 * governed send that actually happened — never from a code path the send skips.
 */
export async function m365WriteStates(
  tenantId: string,
  connectorId?: string,
  accountId?: string,
): Promise<WriteStateCounts> {
  const records = await actionRecord.query({ tenantId });
  // Today only governed mail.send emits to the action record; that IS the M365
  // write. Deriving from the recorded governed sends, not a disjoint counter.
  // Optional connector/account narrowing lets a per-account panel show its own states.
  return deriveWriteStates(
    records.filter(
      (r) =>
        r.actionId === 'mail.send' &&
        (connectorId === undefined || r.connectorId === connectorId) &&
        (accountId === undefined || r.accountId === accountId),
    ),
  );
}
