/**
 * AI Sandbox — AI QA Agent (S4): the decision engine.
 *
 * Deterministic policies decide the next move — proceed / retry / alternative / abort /
 * escalate / ask-for-approval — from the task, attempt count, and reflection. Deterministic
 * policy runs BEFORE any LLM reasoning (per the mandate). Safety is encoded here: a
 * destructive task is gated behind approval unless the agent explicitly allows it, and a
 * permission failure escalates rather than being retried into a pass.
 */
import type { QaAgentDefinition, QaDecision, QaObservation, QaReflection, QaTask } from '@neuropause/shared';

export interface DecisionContext {
  task: QaTask;
  attempt: number;
  /** null before the first run (pre-execution safety gate). */
  observation: QaObservation | null;
  reflection: QaReflection | null;
  agent: QaAgentDefinition;
  approvalGranted: boolean;
}

export function decide(ctx: DecisionContext): QaDecision {
  const id = ctx.task.id;

  // Pre-execution: safety approval gate for destructive tasks.
  if (ctx.observation === null) {
    if (ctx.task.destructive && !ctx.agent.constraints.allowDestructive && !ctx.approvalGranted) {
      return { kind: 'approve', reason: 'destructive task requires approval before execution', taskId: id };
    }
    return { kind: 'proceed', reason: 'cleared to run', taskId: id };
  }

  // Post-execution.
  if (ctx.observation.outcome === 'pass') return { kind: 'proceed', reason: 'task passed', taskId: id };

  const rc = ctx.reflection;
  const cls = rc?.failureClass ?? 'unknown';
  const transient = cls === 'timeout' || cls === 'flaky' || cls === 'environment';

  if (transient && ctx.attempt < ctx.task.retry.maxAttempts) {
    return { kind: 'retry', reason: `transient ${cls} — retrying (attempt ${ctx.attempt + 1}/${ctx.task.retry.maxAttempts})`, taskId: id };
  }
  if (cls === 'permission') {
    return { kind: 'escalate', reason: 'RBAC/permission boundary — a real security result, escalating for review', taskId: id };
  }
  if (cls === 'environment') {
    return { kind: 'alternative', reason: 'environment unavailable — needs an alternative channel/host', taskId: id };
  }
  return { kind: 'abort', reason: `unrecoverable ${cls} — filing a bug and moving on`, taskId: id };
}
