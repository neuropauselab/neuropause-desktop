/**
 * P13C ROUND 52 — GATE 3. THE W-10 REFUSAL-LOG THROTTLE, MADE TESTABLE.
 *
 * The resolver-side bracket math (refusalIndex, firstRefusalAfterSuccess,
 * recovery) lives in the injectable `tenantContext.ts` and is pinned by
 * `refusalDiagnostic.test.ts`. The EMISSION policy — "the transition always
 * prints; after that, one line per reason per minute, each carrying how many
 * it stands for; recovery always prints" — was inlined in the `onRefusal`
 * callback in `enterprise/index.ts`, which imports Electron and so was never
 * unit-tested. This module extracts that decision as a pure function so the
 * throttle, the suppression counter, and the LOST-vs-refused label selection
 * are covered off the Electron path. Behaviour is byte-equivalent to the
 * previous inline logic.
 */

/** Per-reason throttle state: when the reason last emitted, and how many
 *  occurrences have been suppressed since. */
export interface RefusalLogState {
  lastAtMs: number;
  suppressed: number;
}

/** One line per reason per minute (the transition and recovery always print). */
export const REFUSAL_LOG_INTERVAL_MS = 60_000;

export interface RefusalLogDecision {
  /** Whether this refusal should print a log line now. */
  emit: boolean;
  /** How many occurrences this line stands for (only meaningful when `emit`). */
  suppressedSinceLastLine: number;
  /** The line to print: LOST closes/opens the bracket, else the steady line. */
  label: 'Tenant resolution LOST — first refusal after a working session' | 'Tenant refused';
}

/**
 * Decide whether a refusal emits, mutating the per-reason throttle state.
 *
 *  - `firstRefusalAfterSuccess` ALWAYS emits (the "LOST" transition — the
 *    measurement), and resets the reason's window, carrying the count it stands
 *    for.
 *  - otherwise, within the interval of the reason's last line, it is suppressed
 *    (the counter increments) and does not emit;
 *  - once the interval has passed (or the reason has never printed), it emits,
 *    carrying the suppressed count and resetting it to zero.
 */
export function decideRefusalLog(
  states: Map<string, RefusalLogState>,
  reason: string,
  firstRefusalAfterSuccess: boolean,
  nowMs: number,
  intervalMs: number = REFUSAL_LOG_INTERVAL_MS,
): RefusalLogDecision {
  const state = states.get(reason);
  if (!firstRefusalAfterSuccess && state !== undefined && nowMs - state.lastAtMs < intervalMs) {
    state.suppressed += 1;
    return { emit: false, suppressedSinceLastLine: 0, label: 'Tenant refused' };
  }
  const suppressed = state?.suppressed ?? 0;
  states.set(reason, { lastAtMs: nowMs, suppressed: 0 });
  return {
    emit: true,
    suppressedSinceLastLine: suppressed,
    label: firstRefusalAfterSuccess
      ? 'Tenant resolution LOST — first refusal after a working session'
      : 'Tenant refused',
  };
}
