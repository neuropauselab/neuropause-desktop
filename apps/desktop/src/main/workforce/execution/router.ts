/**
 * P8.3 — Workforce execution router (pure).
 *
 * Turns an approved, binding-carrying `JobProposal` into an `ExecutionRequest` for
 * the EXISTING ExecuteEngine, and aggregates the resulting `ExecutionSession`(s)
 * into a single job outcome. No execution logic lives here — it only shapes the
 * request (routing to the workforce action executor, carrying the binding + the
 * job's correlation id, and setting `confirmed: true` because the human approval
 * IS the confirmation) and reads the engine's terminal session state.
 */
import type { ExecutionRequest, ExecutionSession, Job, JobProposal } from '@neuropause/shared';

/** The engine kind the workforce action executor is registered on. */
export const WORKFORCE_ACTION_KIND = 'connector' as const;

export interface WorkforceExecutionOutcome {
  ok: boolean;
  summary: string | null;
  error: string | null;
  /** ExecutionSession id (the last session), or '' when none ran. */
  executionId: string;
  /** Which executor ran the action (infra/m365/automation), or 'unknown'. */
  executor: string;
}

/**
 * Build the ExecutionRequest for an approved binding-carrying proposal, or null if
 * the proposal has no binding. `confirmed: true` + `params.binding` are IN-PROCESS
 * only (the public ExecuteRun IPC cannot supply them).
 */
export function bindingToRequest(job: Job, proposal: JobProposal): ExecutionRequest | null {
  const binding = proposal.execution;
  if (!binding) return null;
  return {
    kind: WORKFORCE_ACTION_KIND,
    targetId: job.id,
    label: proposal.title,
    params: { binding, jobId: job.id, proposalId: proposal.id },
    confirmed: true,
    correlationId: job.correlationId ?? job.id,
  };
}

/** Aggregate one-or-more terminal sessions into a single job outcome (any failure fails the job). */
export function aggregateOutcome(sessions: ExecutionSession[], executor: string): WorkforceExecutionOutcome {
  if (sessions.length === 0) {
    return { ok: false, summary: null, error: 'No execution ran', executionId: '', executor };
  }
  const failed = sessions.find((s) => s.state !== 'completed');
  const last = sessions[sessions.length - 1];
  return {
    ok: !failed,
    summary: failed ? null : (last.resultSummary ?? 'Executed'),
    error: failed ? (failed.error ?? 'Execution failed') : null,
    executionId: last.id,
    executor,
  };
}
