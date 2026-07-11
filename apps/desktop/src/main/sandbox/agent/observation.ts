/**
 * AI Sandbox — AI QA Agent (S4): the observation engine.
 *
 * The agent observes ONLY through the existing systems — it reads the outcome the executor
 * returned (which itself came from real assertions against real ERP/timeline/graph/KPI
 * state via S1/S2/S3). It never reads hidden state. Pure projection of a run result into a
 * {@link QaObservation}.
 */
import type { QaObservation, QaTask } from '@neuropause/shared';
import type { QaRunResult } from './ports';

export function observe(task: QaTask, result: QaRunResult): QaObservation {
  return {
    taskId: task.id,
    executionId: result.executionId,
    status: result.status,
    outcome: result.outcome,
    assertions: result.assertions,
    metrics: result.metrics,
    artifacts: result.artifacts,
    timelinePhases: result.timelinePhases,
    knowledgeGraphRefs: result.knowledgeGraphRefs,
    error: result.error,
  };
}

/** Knowledge-graph node ids the run touched (for the bug report), read from the result. */
export function graphRefs(result: QaRunResult): string[] {
  return result.knowledgeGraphRefs;
}
