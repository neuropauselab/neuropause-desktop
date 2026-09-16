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
import type { DecisionRecord, ExecutionSession, HoldRecord, Job, JobProposal } from '@neuropause/shared';

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

/* ── Wave 2 / Increment 2 — the AI/worker EXECUTION lifecycle, made observable from existing records ──────────
 *
 * An assistant plan step stamps `step.executionId = ExecutionSession.id` (and the conversation's audit array),
 * so the AI → execution link is reconstructable from durable records (conversation ↔ `ipc.execute.sessions`).
 * A governed consequential worker action is `kind: 'connector'` and carries `decisionId` (the BoundDecisionClaim
 * decision). CRITICAL HONESTY: the worker M365 executor COLLAPSES a lost-response (UNKNOWN) into a generic
 * failure and raises NO hold (that fix is a separate FROZEN gate). So a governed consequential session marked
 * `failed` MAY be an unconfirmed (UNKNOWN) outcome — it must be treated as possibly-uncertain and reconciled, per
 * the G2-A operating rule. This model surfaces that honestly; it NEVER reports VERIFIED_SUCCESS, and a `completed`
 * session is ACKNOWLEDGED (provider-accepted), never independently verified. */

export type OperatorExecutionState =
  | 'PENDING'
  | 'EXECUTING'
  | 'ACKNOWLEDGED'
  | 'OUTCOME_UNCERTAIN'
  | 'EXECUTION_FAILED'
  | 'INTERRUPTED'
  | 'CANCELLED';

export interface OperatorExecutionView {
  readonly state: OperatorExecutionState;
  readonly label: string;
  readonly detail: string;
  readonly reconciliationRequired: boolean;
  readonly needsAttention: boolean;
}

/** A governed consequential worker action carries a decisionId and rides the `connector` execution kind. */
function isGovernedConsequential(session: ExecutionSession): boolean {
  return session.kind === 'connector' && typeof session.decisionId === 'string' && session.decisionId.length > 0;
}

/**
 * Classify an ExecutionSession into an honest operator state. Reuses the existing `ipc.execute.sessions/history`
 * records — no new store. Never fabricates VERIFIED_SUCCESS; a governed consequential `failed` is treated as
 * possibly-UNKNOWN (reconcile), reflecting the worker executor's UNKNOWN-collapse limitation.
 */
export function classifyExecutionSession(session: ExecutionSession): OperatorExecutionView {
  const summary = session.resultSummary ?? session.error ?? '';
  switch (session.state) {
    case 'queued':
    case 'waiting':
    case 'paused':
      return { state: 'PENDING', label: 'Pending', detail: summary || 'Queued.', reconciliationRequired: false, needsAttention: false };
    case 'running':
      return { state: 'EXECUTING', label: 'Executing', detail: summary || 'In progress…', reconciliationRequired: false, needsAttention: false };
    case 'completed':
      return {
        state: 'ACKNOWLEDGED',
        label: 'Acknowledged',
        detail: isGovernedConsequential(session)
          ? (summary || 'Completed — the external effect was not independently verified.')
          : (summary || 'Completed.'),
        reconciliationRequired: false,
        needsAttention: false,
      };
    case 'failed':
      if (isGovernedConsequential(session)) {
        // The worker executor cannot distinguish a lost response (UNKNOWN) from a definite failure — treat as
        // possibly-uncertain and reconcile. This is NOT a proven failure and NEVER a success.
        return {
          state: 'OUTCOME_UNCERTAIN',
          label: 'Outcome uncertain',
          detail:
            summary ||
            'A governed action did not confirm success. For a network-uncertain M365 action this may be an unconfirmed outcome — verify the external state before any retry; do not blindly retry.',
          reconciliationRequired: true,
          needsAttention: true,
        };
      }
      return { state: 'EXECUTION_FAILED', label: 'Failed', detail: summary || 'Execution failed.', reconciliationRequired: false, needsAttention: true };
    case 'interrupted':
      return {
        state: 'INTERRUPTED',
        label: 'Interrupted',
        detail: summary || 'Interrupted at shutdown and not re-run. Reconcile before deciding the next action.',
        reconciliationRequired: isGovernedConsequential(session),
        needsAttention: true,
      };
    case 'cancelled':
      return { state: 'CANCELLED', label: 'Cancelled', detail: summary || 'Cancelled.', reconciliationRequired: false, needsAttention: false };
  }
}

/**
 * The AI → execution link: the durable ExecutionSessions an assistant turn produced, by matching the conversation's
 * stamped `executionId`s (`step.executionId` / `audit.executionIds`) against `ipc.execute.sessions/history`. Pure;
 * no authority, no IPC. Returns them newest-first.
 */
export function correlateAssistantExecutions(
  executionIds: readonly string[],
  sessions: readonly ExecutionSession[],
): readonly ExecutionSession[] {
  const wanted = new Set(executionIds);
  return sessions.filter((s) => wanted.has(s.id));
}

/* ── Wave 2 / Increment 3 — Hold ↔ ExecutionSession correlation (AUTHORITATIVE join only) ─────────────────────
 *
 * The ONLY honest join key is the governed `decisionId`: a worker OUTCOME_UNKNOWN hold records it
 * (HoldRecord.decisionId) and the ExecutionSession stamps the same value (session.decisionId). If a hold has no
 * decisionId (e.g. an IPC hold, or a non-governed producer) or no session carries it, the link is NOT established —
 * we say so (`NOT_LINKED`) rather than guessing from timestamps / action names / actor / order. */

export type HoldLinkState = 'LINKED' | 'NOT_LINKED';

export interface HoldSessionLink {
  readonly linkState: HoldLinkState;
  /** The correlated session, when an authoritative decisionId join exists; otherwise null. */
  readonly session: ExecutionSession | null;
  /** Honest reason when not linked. */
  readonly reason: string;
}

/**
 * Join a hold to its ExecutionSession using ONLY the authoritative governed `decisionId`. Never guesses. Returns
 * `NOT_LINKED` with an honest reason when the hold has no decisionId or no session carries it.
 */
export function linkHoldToSession(
  hold: HoldRecord,
  sessions: readonly ExecutionSession[],
): HoldSessionLink {
  const decisionId = hold.decisionId;
  if (typeof decisionId !== 'string' || decisionId.length === 0) {
    return {
      linkState: 'NOT_LINKED',
      session: null,
      reason: 'Reconciliation link not established — this hold carries no governed decision id.',
    };
  }
  const session = sessions.find((s) => s.decisionId === decisionId) ?? null;
  if (!session) {
    return {
      linkState: 'NOT_LINKED',
      session: null,
      reason: 'Reconciliation link not established — no execution record with this decision id is available.',
    };
  }
  return { linkState: 'LINKED', session, reason: '' };
}

/* ── Wave 2 / Increment 4 — the full AI → proposal → approval → governance → execution → outcome lifecycle ─────
 *
 * Composes the EXISTING durable records (assistant request text, workforce Job/JobProposal, ExecutionSession,
 * HoldRecord) into one operator-facing lifecycle, joined ONLY by authoritative ids and NEVER across tenants:
 *   Job.executionId ↔ ExecutionSession.id · JobProposal.verdict.requestId ↔ ExecutionSession.decisionId ·
 *   ExecutionSession.decisionId ↔ HoldRecord.decisionId.
 * Every stage carries an honest evidence fact; missing/unlinked facts are said, never fabricated. It NEVER turns
 * ACKNOWLEDGED into VERIFIED_SUCCESS, UNKNOWN into success, approval into a governance verdict, or a verdict into
 * execution success. Pure — no IPC, no authority, no effect. */

export type LifecycleFact = TimelineFact | 'NOT_LINKED';

export interface LifecycleStage {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly fact: LifecycleFact;
}

export interface OperatorActionLifecycle {
  readonly stages: readonly LifecycleStage[];
  /** True when any stage requires the operator to reconcile before continuing. */
  readonly reconciliationRequired: boolean;
}

/** Two records belong to the same tenant (or both are tenant-unscoped). Never compose across tenants. */
function sameTenant(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? null) === (b ?? null);
}

/** The Job whose executionId authoritatively equals this session's id — same tenant only. Never guessed. */
export function correlateJobForSession(session: ExecutionSession, jobs: readonly Job[]): Job | null {
  return jobs.find((j) => j.executionId === session.id && sameTenant(j.tenantId, session.tenantId)) ?? null;
}

/** The JobProposal whose governed requestId equals this session's decisionId — the exact governed proposal. */
export function correlateProposalForSession(session: ExecutionSession, job: Job | null): JobProposal | null {
  if (!job || typeof session.decisionId !== 'string' || session.decisionId.length === 0) return null;
  return job.proposals.find((p) => p.verdict.requestId === session.decisionId) ?? null;
}

/**
 * Build the composed operator lifecycle. Inputs are already tenant-scoped by the main-process IPC; the correlation
 * helpers additionally refuse cross-tenant joins. `requestText` is the product-level user request (assistant turn),
 * not chain-of-thought. Any input may be null — its stage(s) then read NOT_AVAILABLE / NOT_LINKED honestly.
 */
export function buildActionLifecycle(input: {
  readonly session: ExecutionSession;
  readonly job?: Job | null;
  readonly proposal?: JobProposal | null;
  readonly hold?: HoldRecord | null;
  readonly requestText?: string | null;
}): OperatorActionLifecycle {
  const { session, proposal = null, hold = null, requestText = null } = input;
  const exec = classifyExecutionSession(session);
  const stages: LifecycleStage[] = [];

  // REQUEST + AI (product-level only; no chain-of-thought).
  stages.push(
    requestText
      ? { key: 'request', label: 'Request', value: requestText, fact: 'OBSERVED' }
      : { key: 'request', label: 'Request', value: 'Not recorded on this action', fact: 'NOT_AVAILABLE' },
  );
  stages.push(
    proposal
      ? { key: 'ai', label: 'AI', value: 'NeuroPause generated an action proposal (AI proposed — it did not execute).', fact: 'OBSERVED' }
      : { key: 'ai', label: 'AI', value: 'No AI proposal record linked', fact: 'NOT_LINKED' },
  );

  // PROPOSAL.
  stages.push(
    proposal
      ? { key: 'proposal', label: 'Proposal', value: `${proposal.title}${proposal.sideEffects ? ' (consequential)' : ''}`, fact: 'OBSERVED' }
      : { key: 'proposal', label: 'Proposal', value: 'No linked proposal', fact: 'NOT_LINKED' },
  );

  // APPROVAL — human, distinct from the AI proposal.
  if (proposal?.approval) {
    const a = proposal.approval;
    stages.push({ key: 'approval', label: 'Approval', value: a.decision === 'approved' ? `Approved by ${a.decidedBy}` : `Rejected by ${a.decidedBy}`, fact: 'OBSERVED' });
  } else if (proposal) {
    stages.push({ key: 'approval', label: 'Approval', value: 'Approval required — not yet decided', fact: 'NOT_OBSERVED' });
  } else {
    stages.push({ key: 'approval', label: 'Approval', value: 'No linked approval', fact: 'NOT_LINKED' });
  }

  // GOVERNANCE — the verdict, never inferred from execution.
  stages.push(
    proposal
      ? { key: 'governance', label: 'Governance', value: proposal.verdict.decision, fact: 'OBSERVED' }
      : { key: 'governance', label: 'Governance', value: 'No linked governance verdict', fact: 'NOT_LINKED' },
  );

  // ADMISSION — only when the session carries a governed decisionId.
  stages.push(
    typeof session.decisionId === 'string' && session.decisionId.length > 0
      ? { key: 'admission', label: 'Admission', value: 'Admitted (single-use governed decision)', fact: 'OBSERVED' }
      : { key: 'admission', label: 'Admission', value: 'No governed admission recorded', fact: 'NOT_OBSERVED' },
  );

  // EXECUTION + OUTCOME (external effect never verified).
  stages.push({ key: 'execution', label: 'Execution', value: exec.label, fact: 'OBSERVED' });
  stages.push({ key: 'effect', label: 'External effect', value: 'Not independently verified', fact: 'NOT_VERIFIED' });

  // HOLD / RECONCILIATION / DISPOSITION — only from an authoritative hold.
  let reconcile = exec.reconciliationRequired;
  if (hold) {
    const hv = classifyHold(hold);
    reconcile = reconcile || hv.reconciliationRequired;
    stages.push({ key: 'hold', label: 'Hold', value: hv.label, fact: 'OBSERVED' });
    const resolved = hold.status === 'resolved';
    stages.push({ key: 'reconciliation', label: 'Reconciliation', value: resolved ? 'Reconciled' : 'Reconciliation required — verify external state; do not blindly retry', fact: resolved ? 'OBSERVED' : 'NOT_OBSERVED' });
    stages.push({ key: 'disposition', label: 'Disposition', value: resolved ? `Resolved (${hold.resolvedOutcome ?? 'recorded'}) — an operator decision, not proof of external effect` : 'Open', fact: resolved ? 'OBSERVED' : 'NOT_OBSERVED' });
  } else if (reconcile) {
    // OUTCOME_UNCERTAIN with no durable hold (e.g. not yet raised) — still say reconciliation is required.
    stages.push({ key: 'reconciliation', label: 'Reconciliation', value: 'Reconciliation required — verify external state; do not blindly retry', fact: 'NOT_OBSERVED' });
  }

  return { stages, reconciliationRequired: reconcile };
}
