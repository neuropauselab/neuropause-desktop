/**
 * AI Sandbox — AI QA Agent (S4): the planner.
 *
 * Deterministic goal decomposition: a goal + its agent's checks become a dependency-ordered
 * {@link QaPlan} of tasks. The optional reasoner only supplies breadth hints (wide vs
 * narrow); the task set and ordering are fully deterministic and reproducible. Each task
 * carries a scenario spec the executor will run — the planner never runs anything.
 */
import {
  isDestructiveSpec,
  topoSortTasks,
  type QaAgentDefinition,
  type QaGoal,
  type QaPlan,
  type QaTask,
} from '@neuropause/shared';
import type { Reasoner } from './ports';
import type { QaCheck } from './agents';

export interface PlannerDeps {
  reasoner: Reasoner;
  now: () => number;
  defaultRetries?: number;
}

export interface PlanOutput {
  plan: QaPlan;
  hints: string[];
  planningMs: number;
  reasoningMs: number;
}

export async function planGoal(goal: QaGoal, agent: QaAgentDefinition, checks: QaCheck[], deps: PlannerDeps): Promise<PlanOutput> {
  const t0 = deps.now();
  const r0 = deps.now();
  const hints = await deps.reasoner.interpretGoal(goal, agent);
  const reasoningMs = deps.now() - r0;

  let selected = checks;
  if (hints.includes('breadth:narrow') && checks.length > 1) selected = checks.slice(0, 1);
  selected = selected.slice(0, Math.max(1, agent.constraints.maxTasks));

  const maxAttempts = Math.max(1, deps.defaultRetries ?? 2);
  const tasks: QaTask[] = selected.map((c) => ({
    id: `${goal.id}:${c.id}`,
    name: c.name,
    goalId: goal.id,
    spec: c.spec,
    expectations: c.expectations,
    dependsOn: c.dependsOn.map((d) => `${goal.id}:${d}`),
    priority: c.priority,
    destructive: c.destructive || isDestructiveSpec(c.spec),
    retry: { maxAttempts, backoffMs: 0 },
  }));

  const order = topoSortTasks(tasks);
  const plan: QaPlan = { goalId: goal.id, agent: agent.category, tasks, order };
  return { plan, hints, planningMs: deps.now() - t0, reasoningMs };
}
