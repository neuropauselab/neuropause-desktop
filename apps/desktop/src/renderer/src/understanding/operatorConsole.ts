/**
 * NeuroPause OS — Wave 1 / Increment 3 — the OPERATOR model (renderer, presentation only).
 *
 * Pure mapping from the EXISTING durable governance evidence (HoldRecord + DecisionRecord, from
 * `ipc.holds`/`ipc.decisionRecords`) onto an operator-facing state + an evidence timeline. It creates NO store,
 * NO IPC, NO effect, and touches NO frozen surface — it only re-presents facts the certified path already produced.
 *
 * Honesty invariants (enforced by construction here):
 *  - UNKNOWN ≠ SUCCESS ≠ FAILURE: a `verification_unavailable` hold is OUTCOME_UNKNOWN, never success or failure.
 *  - ACKNOWLEDGED ≠ VERIFIED_SUCCESS: the external effect line is ALWAYS `NOT_VERIFIED` (no postcondition oracle).
 *  - Only states the data substantiates are produced (holds carry no "escalated" reason, so none is invented).
 *  - Missing facts are shown as NOT_OBSERVED / NOT_VERIFIED / NOT_AVAILABLE — never fabricated.
 *  - Operator-facing labels are plain words; technical identifiers travel in `technical`/the timeline detail.
 */
import type { DecisionRecord, HoldRecord } from '@neuropause/shared';

/** Operator-facing lifecycle state derived from a durable hold. */
export type OperatorHoldState =
  | 'APPROVAL_REQUIRED'
  | 'OUTCOME_UNKNOWN'
  | 'HELD'
  | 'RESOLVED';

export interface OperatorHoldView {
  readonly state: OperatorHoldState;
  /** Plain-words, operator-facing. */
  readonly label: string;
  /** The technical reason id, for the details/evidence view. */
  readonly technical: string;
  /** True when the operator must reconcile external state before any further action. */
  readonly reconciliationRequired: boolean;
  /** True when this item needs operator attention now (open + actionable). */
  readonly needsAttention: boolean;
}

/** Classify a durable hold into an honest operator state. Never invents a state the reason cannot substantiate. */
export function classifyHold(hold: HoldRecord): OperatorHoldView {
  if (hold.status === 'resolved') {
    return { state: 'RESOLVED', label: 'Resolved', technical: hold.reason, reconciliationRequired: false, needsAttention: false };
  }
  switch (hold.reason) {
    case 'verification_unavailable':
      return {
        state: 'OUTCOME_UNKNOWN',
        label: 'Outcome uncertain — the external result could not be confirmed',
        technical: hold.reason,
        reconciliationRequired: true,
        needsAttention: true,
      };
    case 'external_unavailable':
      return {
        state: 'HELD',
        label: 'On hold — a required system was unavailable',
        technical: hold.reason,
        reconciliationRequired: true,
        needsAttention: true,
      };
    case 'approval_required':
      return {
        state: 'APPROVAL_REQUIRED',
        label: 'Approval required before this can run',
        technical: hold.reason,
        reconciliationRequired: false,
        needsAttention: true,
      };
    default:
      return {
        state: 'HELD',
        label: 'On hold and requires reconciliation',
        technical: hold.reason,
        reconciliationRequired: true,
        needsAttention: true,
      };
  }
}

/** Whether a fact in the evidence timeline was actually observed, or is honestly absent. */
export type TimelineFact = 'OBSERVED' | 'NOT_OBSERVED' | 'NOT_VERIFIED' | 'NOT_AVAILABLE';

export interface TimelineStep {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly fact: TimelineFact;
}

/**
 * Build a reconstructable evidence timeline for one consequential decision, in lifecycle order. Only facts that
 * exist are marked OBSERVED; the external effect is ALWAYS NOT_VERIFIED (acknowledgement ≠ verification); a hold's
 * reconciliation/disposition is NOT_OBSERVED until it is actually resolved. Nothing is fabricated.
 */
export function buildEvidenceTimeline(rec: DecisionRecord, hold: HoldRecord | null): readonly TimelineStep[] {
  const steps: TimelineStep[] = [
    { key: 'request', label: 'Requested', value: rec.requestedAction, fact: 'OBSERVED' },
    {
      key: 'actor',
      label: 'Actor',
      value: rec.actor ?? 'Not recorded',
      fact: rec.actor ? 'OBSERVED' : 'NOT_AVAILABLE',
    },
    { key: 'identity', label: 'Subject / identity', value: rec.subject, fact: 'OBSERVED' },
    {
      key: 'governance',
      label: 'Governance assessment',
      value: `${rec.assessment.risk} — ${rec.assessment.recommendation}`,
      fact: 'OBSERVED',
    },
    { key: 'executed', label: 'Executed', value: rec.executed, fact: 'OBSERVED' },
    {
      key: 'effect',
      label: 'External effect',
      value: 'Acknowledgement only — the external effect was not independently verified',
      fact: 'NOT_VERIFIED',
    },
  ];

  if (hold) {
    const v = classifyHold(hold);
    steps.push({ key: 'hold', label: 'Hold', value: v.label, fact: 'OBSERVED' });
    const reconciled = hold.status === 'resolved';
    steps.push({
      key: 'reconciliation',
      label: 'Reconciliation',
      value: reconciled ? (hold.resolvedNote ?? hold.resolvedOutcome ?? 'Resolved') : 'Not yet reconciled',
      fact: reconciled ? 'OBSERVED' : 'NOT_OBSERVED',
    });
    steps.push({
      key: 'disposition',
      label: 'Final disposition',
      value: reconciled ? (hold.resolvedOutcome ?? 'Resolved') : 'Open — an operator decision is required',
      fact: reconciled ? 'OBSERVED' : 'NOT_OBSERVED',
    });
  } else {
    steps.push({ key: 'disposition', label: 'Final disposition', value: rec.outcome, fact: 'OBSERVED' });
  }
  return steps;
}

/** The operator ATTENTION set: open holds that need action, most recent first. Pure, tenant-scoping is upstream. */
export function attentionHolds(open: readonly HoldRecord[]): readonly HoldRecord[] {
  return [...open]
    .filter((h) => h.status === 'open')
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
