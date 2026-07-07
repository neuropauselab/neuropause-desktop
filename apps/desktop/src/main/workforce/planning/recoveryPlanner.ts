/**
 * Recovery planner (V7.2.1, pure). Given a workflow spec and a partially-executed
 * run, computes what to re-run on recovery: preserve every already-succeeded step,
 * and replay only the unfinished ones (failed / skipped / pending / awaiting) as a
 * fresh dependency-ordered sub-plan. Dependencies on preserved (succeeded) steps
 * are treated as satisfied, so a replay branch starts from the first unfinished
 * step — never rerunning completed work. Reuses the V7.0 planner for the subgraph
 * rather than duplicating dependency logic. Pure: it plans recovery, never executes.
 */
import type { WorkflowRun, WorkflowSpec } from '@neuropause/shared';
import { planGoal } from './goalPlanner';

export interface RecoveryPlan {
  /** Steps to replay, dependency-ordered. */
  toReplay: string[];
  /** Already-succeeded steps that are preserved (not re-run). */
  preserved: string[];
  /** Replay execution waves (parallelizable groups). */
  waves: string[][];
}

export type RecoveryResult = { ok: true; plan: RecoveryPlan } | { ok: false; error: string };

/**
 * Build the recovery plan for a run. Succeeded steps are preserved; everything else
 * is replayed, with preserved dependencies dropped (already satisfied) so branches
 * resume from their first unfinished step. Returns an error only if the replay
 * subgraph is somehow malformed (shouldn't happen for a spec that originally
 * validated, but guarded).
 */
export function planRecovery(spec: WorkflowSpec, run: WorkflowRun): RecoveryResult {
  const statusById = new Map(run.stepRuns.map((r) => [r.stepId, r.status]));
  const isPreserved = (id: string): boolean => statusById.get(id) === 'succeeded';

  const preserved = spec.steps.filter((s) => isPreserved(s.id)).map((s) => s.id);
  const replaySteps = spec.steps.filter((s) => !isPreserved(s.id));
  const replaySet = new Set(replaySteps.map((s) => s.id));

  const plan = planGoal({
    id: `${spec.id}:recovery`,
    tasks: replaySteps.map((s) => ({
      id: s.id,
      // Preserved (succeeded) dependencies are already satisfied — drop them so the
      // branch can start; keep only dependencies that are themselves being replayed.
      dependsOn: s.dependsOn.filter((d) => replaySet.has(d)),
    })),
  });

  if (!plan.ok) return { ok: false, error: plan.detail };

  return {
    ok: true,
    plan: { toReplay: plan.plan.order, preserved, waves: plan.plan.waves },
  };
}
