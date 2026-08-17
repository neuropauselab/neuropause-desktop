/**
 * NeuroPause OS — Wave 1 (P0-SAFE) — honest M365 write outcome model (renderer, presentation only).
 *
 * The certified main-process path (`governedSend`/`governedAction` → `mapSendOutcome`/`mapActionOutcome`,
 * `connectors/index.ts`) already transports a semantic outcome class in `ConnectorWriteResult.data.outcome`
 * plus `ok` and `requiresConfirmation`. Until now the renderer collapsed all of that into a binary
 * "Sent / Not sent" string, so an operator could not distinguish DENIED / HELD / OUTCOME_UNKNOWN from a
 * plain failure — the pilot-critical gap named by the G2 / G2-A audits.
 *
 * This module is PURE presentation mapping. It does NOT change the governance decision, does NOT call any
 * IPC, and touches NO frozen surface. It NEVER fabricates VERIFIED_SUCCESS: the strongest success state the
 * runtime can honestly report is ACKNOWLEDGED (provider accepted; delivery NOT independently verified). An
 * UNKNOWN (transmitted, response lost) is reported as OUTCOME_UNKNOWN and is never shown as success or as a
 * definite failure — reconcile before any retry.
 */
import type { ConnectorWriteResult } from '@neuropause/shared';

/** The honest, operator-facing lifecycle state of one consequential M365 write. */
export type M365WriteState =
  | 'EXECUTING' // transient, UI-local: the request is in flight
  | 'APPROVAL_REQUIRED' // refused pending explicit human confirmation (requiresConfirmation)
  | 'ACKNOWLEDGED' // provider accepted for delivery — NOT independently verified (never VERIFIED_SUCCESS)
  | 'OUTCOME_UNKNOWN' // transmitted but no response — must reconcile, must NOT blind-retry
  | 'EXECUTION_FAILED' // definite provider rejection
  | 'HELD' // governance HOLD (e.g. prior identical unconfirmed send)
  | 'ESCALATED' // escalated for human review
  | 'DENIED'; // authorization refused (actor/tenant/account/scope/token)

/** Visual tone — deliberately distinguishes UNKNOWN (warn) from FAILED/DENIED (error) and ACK (ok). */
export type M365OutcomeTone = 'ok' | 'warn' | 'error' | 'info' | 'pending';

export interface M365OutcomeView {
  readonly state: M365WriteState;
  readonly label: string;
  /** One-line honest explanation for the operator. */
  readonly detail: string;
  readonly tone: M365OutcomeTone;
  /** True when the operator must reconcile the external state before any further action. */
  readonly reconciliationRequired: boolean;
}

/** The in-flight state shown while the IPC call is pending. */
export const EXECUTING_VIEW: M365OutcomeView = {
  state: 'EXECUTING',
  label: 'Executing',
  detail: 'Submitting the governed action…',
  tone: 'pending',
  reconciliationRequired: false,
};

function outcomeClass(result: ConnectorWriteResult): string | null {
  const raw = result.data?.outcome;
  return typeof raw === 'string' ? raw : null;
}

/**
 * Map a completed `ConnectorWriteResult` from the certified IPC path onto an honest operator-facing state.
 * Primary key is `data.outcome` (the semantic class the governed path stamps). When it is absent (e.g. the
 * non-cohort read-only executor fallback), fall back to `requiresConfirmation` / `ok` — still never inventing
 * a success stronger than ACKNOWLEDGED.
 */
export function classifyWriteOutcome(result: ConnectorWriteResult): M365OutcomeView {
  const cls = outcomeClass(result);
  const msg = result.message ?? '';

  // Governance refused pending explicit human confirmation.
  if (result.requiresConfirmation === true) {
    return {
      state: 'APPROVAL_REQUIRED',
      label: 'Approval required',
      detail: msg || 'This action modifies data and needs explicit confirmation before it runs.',
      tone: 'info',
      reconciliationRequired: false,
    };
  }

  switch (cls) {
    case 'ACKNOWLEDGED':
      return {
        state: 'ACKNOWLEDGED',
        label: 'Acknowledged',
        detail: msg || 'Accepted by Microsoft Graph (queued; delivery not independently verified).',
        tone: 'ok',
        reconciliationRequired: false,
      };
    case 'UNKNOWN':
      return {
        state: 'OUTCOME_UNKNOWN',
        label: 'Outcome unknown',
        detail:
          msg ||
          'The request was transmitted but no response was received; it was NOT retried. Reconcile the external state before any retry.',
        tone: 'warn',
        reconciliationRequired: true,
      };
    case 'EXECUTION_FAILED':
      return {
        state: 'EXECUTION_FAILED',
        label: 'Execution failed',
        detail: msg || 'The provider rejected the request.',
        tone: 'error',
        reconciliationRequired: false,
      };
    case 'HOLD':
      return {
        state: 'HELD',
        label: 'Held',
        detail: msg || 'Held for reconciliation — a prior identical action is unconfirmed and was not re-run.',
        tone: 'warn',
        reconciliationRequired: true,
      };
    case 'ESCALATE':
      return {
        state: 'ESCALATED',
        label: 'Escalated',
        detail: msg || 'Escalated for human review.',
        tone: 'info',
        reconciliationRequired: false,
      };
    case 'DENIED':
      return {
        state: 'DENIED',
        label: 'Denied',
        detail: msg || 'Not authorized — reconnect this account or check its permissions.',
        tone: 'error',
        reconciliationRequired: false,
      };
    case 'VERIFIED_NOOP':
      // The kernel allowed but nothing executed (no effect). Honest: not a delivery, not a failure.
      return {
        state: 'ACKNOWLEDGED',
        label: 'No change',
        detail: msg || 'Nothing to do — the action produced no effect.',
        tone: 'info',
        reconciliationRequired: false,
      };
    default:
      // No semantic class available (e.g. read-only fallback). Use ok/message honestly; success here is
      // still only ACKNOWLEDGED — never VERIFIED_SUCCESS.
      if (result.ok) {
        return {
          state: 'ACKNOWLEDGED',
          label: 'Acknowledged',
          detail: msg || 'Accepted (not independently verified).',
          tone: 'ok',
          reconciliationRequired: false,
        };
      }
      return {
        state: 'EXECUTION_FAILED',
        label: 'Failed',
        detail: msg || 'The action did not complete.',
        tone: 'error',
        reconciliationRequired: false,
      };
  }
}
