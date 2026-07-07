/**
 * Goal planning engine (V7.0, pure). Decomposes a goal's tasks + their
 * dependencies into a deterministic execution plan: ordered "waves" of tasks that
 * can run in parallel (all dependencies satisfied by earlier waves), with cycle and
 * unknown-dependency detection. PURE — it produces a plan and NEVER executes
 * anything; the existing workforce runtime/orchestrator consumes the plan and runs
 * it. Deterministic: same goal → same plan, with ties broken by priority then id.
 */

export interface PlannedTask {
  id: string;
  description?: string;
  /** Ids of tasks that must complete before this one. */
  dependsOn?: string[];
  /** Higher runs earlier within a wave. Default 0. */
  priority?: number;
  maxRetries?: number;
}

export interface Goal {
  id: string;
  tasks: PlannedTask[];
}

export interface ExecutionPlan {
  goalId: string;
  /** Each wave is a set of task ids runnable in parallel. */
  waves: string[][];
  /** Flattened topological order. */
  order: string[];
}

export type PlanResult =
  | { ok: true; plan: ExecutionPlan }
  | { ok: false; error: 'unknown_dependency' | 'duplicate_task' | 'cycle'; detail: string };

/** Produce a deterministic execution plan, or an error for malformed input. */
export function planGoal(goal: Goal): PlanResult {
  const tasks = goal.tasks;

  // Unique ids.
  const ids = new Set<string>();
  for (const t of tasks) {
    if (ids.has(t.id))
      return { ok: false, error: 'duplicate_task', detail: `duplicate task id: ${t.id}` };
    ids.add(t.id);
  }

  // Dependencies must reference known tasks.
  for (const t of tasks) {
    for (const dep of t.dependsOn ?? []) {
      if (!ids.has(dep)) {
        return {
          ok: false,
          error: 'unknown_dependency',
          detail: `${t.id} depends on unknown task ${dep}`,
        };
      }
    }
  }

  // In-degrees + dependents (edge dep → task).
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const t of tasks) inDegree.set(t.id, 0);
  for (const t of tasks) {
    for (const dep of t.dependsOn ?? []) {
      inDegree.set(t.id, (inDegree.get(t.id) ?? 0) + 1);
      const list = dependents.get(dep);
      if (list) list.push(t.id);
      else dependents.set(dep, [t.id]);
    }
  }

  const priorityOf = new Map(tasks.map((t) => [t.id, t.priority ?? 0]));
  const waves: string[][] = [];
  const order: string[] = [];
  const done = new Set<string>();

  while (done.size < tasks.length) {
    const wave = tasks
      .filter((t) => !done.has(t.id) && (inDegree.get(t.id) ?? 0) === 0)
      .map((t) => t.id)
      .sort((a, b) => priorityOf.get(b)! - priorityOf.get(a)! || (a < b ? -1 : a > b ? 1 : 0));

    if (wave.length === 0) {
      const stuck = tasks
        .filter((t) => !done.has(t.id))
        .map((t) => t.id)
        .sort();
      return { ok: false, error: 'cycle', detail: `dependency cycle among: ${stuck.join(', ')}` };
    }

    waves.push(wave);
    for (const id of wave) {
      order.push(id);
      done.add(id);
      for (const dependent of dependents.get(id) ?? []) {
        inDegree.set(dependent, (inDegree.get(dependent) ?? 0) - 1);
      }
    }
  }

  return { ok: true, plan: { goalId: goal.id, waves, order } };
}
