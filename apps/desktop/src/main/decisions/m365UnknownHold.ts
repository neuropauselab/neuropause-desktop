/**
 * NeuroPause OS — Wave 1 / Increment 2A — map an AUTHORITATIVE M365 IPC OUTCOME_UNKNOWN onto the existing
 * `raiseHold` input. PURE and non-frozen: no store, no IPC, no effect. Extracted here so the runtime root's
 * wiring is a trivial one-liner and the mapping is unit-testable in isolation.
 *
 * Honesty rules encoded here:
 *  - reason is `verification_unavailable` ("Cannot verify the outcome") — the exact ABSENCE semantics of an
 *    UNKNOWN (transmitted, response lost). It is NOT a failure and NOT a success.
 *  - `subject` is the caller-supplied reconstructable identity (the CST transitionId), so a repeated identical
 *    UNKNOWN dedupes to ONE hold via `HoldStore.open`'s per-subject idempotency.
 *  - the resolution text forbids blind retry: any further action requires a NEW governed decision.
 *  - no secrets, tokens, or raw parameter values are placed on the hold — only the action id and account label.
 */
import type { RaiseHoldInput } from './raiseHold';

/** The authoritative context of an M365 UNKNOWN outcome (all values sourced main-process, never from the renderer). */
export interface M365UnknownHoldContext {
  readonly tenantId: string;
  readonly actor: string | null;
  readonly connectorId: string;
  readonly accountId: string;
  readonly actionId: string;
  /** Reconstructable identity of the consequential transition (CST transitionId) — the dedupe key. */
  readonly subject: string;
  readonly label: string;
  /**
   * The governed-decision id, when this UNKNOWN came from a claim-bearing (worker) execution — recorded on the
   * hold so it correlates to the ExecutionSession (same decisionId). Absent for the IPC path (unchanged).
   */
  readonly decisionId?: string;
}

/** Build the `raiseHold` input for an M365 OUTCOME_UNKNOWN. Pure; the caller passes it to `raiseHold`. */
export function buildM365UnknownHoldInput(ctx: M365UnknownHoldContext): RaiseHoldInput {
  return {
    reason: 'verification_unavailable',
    why: 'A Microsoft 365 action was transmitted but its outcome could not be confirmed — it was not retried.',
    known: [`Action: ${ctx.actionId}`, `Account: ${ctx.connectorId} / ${ctx.accountId}`],
    unknown: ['Whether the action actually took effect at Microsoft 365.'],
    resolution:
      'Check the external Microsoft 365 state and record what you find. Do not blindly retry — any further action requires a new governed decision.',
    ifProceeding: '',
    title: ctx.label,
    subject: ctx.subject,
    requestedAction: ctx.label,
    executed: 'Nothing confirmed — the outcome is unknown.',
    ...(ctx.decisionId ? { decisionId: ctx.decisionId } : {}),
  };
}
