/**
 * Workflow planning bridge (V7.1). Connects the tested V7.0 goal planner to the
 * real Workflow Orchestrator: it maps a `WorkflowSpec`'s steps onto planner tasks
 * and runs `planGoal`, so a workflow's dependency DAG is validated (cycles,
 * unknown dependencies, duplicate ids) and laid out into execution waves BEFORE the
 * orchestrator runs it.
 *
 * The orchestrator already executes ready steps in waves; what it lacks is up-front
 * validation — a cyclic workflow would otherwise stall in `running` forever, since
 * cyclic steps never become ready. This bridge closes that gap by reusing the
 * planner rather than duplicating any execution logic. It is pure: it plans, it
 * never runs anything.
 */
import type { WorkflowSpec } from '@neuropause/shared';
import { planGoal, type PlanResult } from './goalPlanner';

/** Validate + plan a workflow's DAG using the V7.0 planner. Returns the wave plan
 *  (`ok: true`) or a structured error (`cycle` / `unknown_dependency` /
 *  `duplicate_task`). The orchestrator rejects a workflow whose plan fails. */
export function planWorkflow(spec: WorkflowSpec): PlanResult {
  return planGoal({
    id: spec.id,
    tasks: spec.steps.map((step) => ({
      id: step.id,
      dependsOn: step.dependsOn,
      maxRetries: step.retry,
    })),
  });
}
