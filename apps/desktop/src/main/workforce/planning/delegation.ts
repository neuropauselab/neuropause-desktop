/**
 * AI Workforce — Delegation engine (P8, pure).
 *
 * Turns a goal's task decomposition + the live worker roster into a governed
 * DelegationPlan: it REUSES the existing pure planners — `planGoal` (Kahn
 * topological waves + cycle detection) and `criticalPath` (CPM slack/bottlenecks)
 * — for the graph + schedule, and adds the delegation layer on top: assign each
 * task to the best-fit eligible worker (role × scope × trust × health ×
 * availability, load-balanced), compute per-task start/finish/deadline, and roll
 * up load + confidence.
 *
 * No new graph, no new scheduler, no new runtime — this is assignment + scheduling
 * over what already exists. Pure + deterministic: same goal + roster → same plan.
 */
import type {
  DelegationGoalInput,
  DelegationPlan,
  DelegationAssignment,
  DelegationCandidate,
  DelegationWorkerLoad,
  Worker,
  WorkflowSpec,
  WorkflowStep,
} from '@neuropause/shared';
import { isEligible, scoreCandidate } from '@neuropause/shared';
import { planGoal, type Goal } from './goalPlanner';
import { criticalPath } from './workflowAnalysis';

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Clamp a timestamp into the valid Date range so a bad `nowMs` never throws. */
const DATE_MAX = 8.64e15;
const safeIso = (ms: number): string =>
  new Date(Number.isFinite(ms) ? Math.max(-DATE_MAX, Math.min(DATE_MAX, ms)) : 0).toISOString();

/**
 * Strict total order for owner selection: higher score wins; exact ties break to
 * the least effort-loaded worker, then the least task-count, then lexical id.
 * Transitive + order-independent (no epsilon), so the same roster → the same owner.
 */
function candidateWins(
  c: DelegationCandidate,
  cTotal: number,
  best: DelegationCandidate,
  bestTotal: number,
  loadEffort: Map<string, number>,
  loadCount: Map<string, number>,
): boolean {
  if (cTotal !== bestTotal) return cTotal > bestTotal;
  const cE = loadEffort.get(c.id) ?? 0;
  const bE = loadEffort.get(best.id) ?? 0;
  if (cE !== bE) return cE < bE;
  const cC = loadCount.get(c.id) ?? 0;
  const bC = loadCount.get(best.id) ?? 0;
  if (cC !== bC) return cC < bC;
  return c.id < best.id;
}

/** Project a full Worker down to the fields the delegation scorer needs. */
export function toDelegationCandidate(w: Worker): DelegationCandidate {
  return {
    id: w.identity.id,
    name: w.identity.name,
    role: w.identity.role,
    trustScore: w.trustScore,
    healthState: w.health.state,
    lifecycle: w.lifecycle,
    grantedScopes: w.permissions.filter((p) => p.granted).map((p) => p.scope),
  };
}

/**
 * Plan the delegation of a goal across the given workers as of `nowMs`. Reuses
 * `planGoal` for the topological waves and `criticalPath` for CPM scheduling; a
 * malformed graph (cycle / duplicate / unknown dependency) returns an error plan
 * with every task listed unassigned (never throws).
 */
export function planDelegation(goal: DelegationGoalInput, workers: Worker[], nowMs: number): DelegationPlan {
  const generatedAt = safeIso(nowMs);
  const totalTasks = goal.tasks.length;
  const allIds = goal.tasks.map((t) => t.id);

  // 1. Topological plan (reuse planGoal). On a malformed graph, bail with an error plan.
  const planned: Goal = {
    id: goal.id,
    tasks: goal.tasks.map((t) => ({ id: t.id, dependsOn: t.dependsOn, priority: t.priority })),
  };
  const plan = planGoal(planned);
  if (!plan.ok) {
    return {
      goalId: goal.id,
      goalTitle: goal.title,
      assignments: [],
      waves: [],
      criticalPath: [],
      estimatedDuration: 0,
      totalTasks,
      assignedTasks: 0,
      unassigned: allIds,
      load: [],
      confidence: 0,
      error: plan.error,
      errorDetail: plan.detail,
      generatedAt,
    };
  }

  const waves = plan.plan.waves;
  const order = plan.plan.order;
  const waveOf = new Map<string, number>();
  waves.forEach((w, i) => w.forEach((id) => waveOf.set(id, i)));

  // 2. Critical path + forward schedule (reuse criticalPath for the CPM view).
  const byId = new Map(goal.tasks.map((t) => [t.id, t]));
  const effortOf = (id: string): number => {
    const e = byId.get(id)?.effort;
    return typeof e === 'number' && e >= 0 ? e : 1;
  };
  const spec: WorkflowSpec = {
    id: goal.id,
    name: goal.title,
    description: '',
    steps: goal.tasks.map((t): WorkflowStep => ({ id: t.id, kind: 'worker', dependsOn: t.dependsOn ?? [] })),
  };
  const cp = criticalPath(spec, (step) => effortOf(step.id));
  const onCritical = new Set(cp.bottlenecks);

  const start = new Map<string, number>();
  const finish = new Map<string, number>();
  for (const id of order) {
    const deps = byId.get(id)?.dependsOn ?? [];
    const s = deps.reduce((m, d) => Math.max(m, finish.get(d) ?? 0), 0);
    start.set(id, s);
    finish.set(id, s + effortOf(id));
  }

  // 3. Assign each task to the best eligible worker, load-balancing on ties.
  const candidates = workers.map(toDelegationCandidate);
  const loadEffort = new Map<string, number>();
  const loadCount = new Map<string, number>();
  const assignments: DelegationAssignment[] = [];
  const unassigned: string[] = [];

  for (const id of order) {
    const task = byId.get(id)!;
    const slot = {
      startOffset: start.get(id) ?? 0,
      finishOffset: finish.get(id) ?? 0,
      onCriticalPath: onCritical.has(id),
      dependsOn: task.dependsOn ?? [],
      wave: waveOf.get(id) ?? 0,
    };

    let best: { c: DelegationCandidate; total: number; reasons: string[] } | null = null;
    for (const c of candidates) {
      if (!isEligible(task, c)) continue;
      const score = scoreCandidate(task, c);
      if (best == null) {
        best = { c, total: score.total, reasons: score.reasons };
        continue;
      }
      // Strict TOTAL order (transitive → order-independent): higher score wins;
      // exact ties break to least effort-loaded, then least task-count, then id.
      if (candidateWins(c, score.total, best.c, best.total, loadEffort, loadCount)) {
        best = { c, total: score.total, reasons: score.reasons };
      }
    }

    if (best == null) {
      unassigned.push(id);
      assignments.push({
        taskId: id,
        taskTitle: task.title,
        workerId: null,
        workerName: null,
        role: null,
        matchScore: 0,
        reasons: ['no eligible worker'],
        ...slot,
      });
      continue;
    }

    loadEffort.set(best.c.id, (loadEffort.get(best.c.id) ?? 0) + effortOf(id));
    loadCount.set(best.c.id, (loadCount.get(best.c.id) ?? 0) + 1);
    assignments.push({
      taskId: id,
      taskTitle: task.title,
      workerId: best.c.id,
      workerName: best.c.name,
      role: best.c.role,
      matchScore: round3(best.total),
      reasons: best.reasons,
      ...slot,
    });
  }

  // 4. Load rollup + plan confidence.
  const load: DelegationWorkerLoad[] = candidates
    .filter((c) => (loadCount.get(c.id) ?? 0) > 0)
    .map((c) => ({
      workerId: c.id,
      workerName: c.name,
      role: c.role,
      taskCount: loadCount.get(c.id) ?? 0,
      effort: loadEffort.get(c.id) ?? 0,
    }))
    .sort((a, b) => b.effort - a.effort || (a.workerId < b.workerId ? -1 : a.workerId > b.workerId ? 1 : 0));

  const assigned = assignments.filter((a) => a.workerId != null);
  const avgScore = assigned.length ? assigned.reduce((s, a) => s + a.matchScore, 0) / assigned.length : 0;
  const coverage = totalTasks ? assigned.length / totalTasks : 0;

  return {
    goalId: goal.id,
    goalTitle: goal.title,
    assignments,
    waves,
    criticalPath: cp.path,
    estimatedDuration: cp.estimatedDuration,
    totalTasks,
    assignedTasks: assigned.length,
    unassigned,
    load,
    confidence: round3(avgScore * coverage),
    error: null,
    errorDetail: null,
    generatedAt,
  };
}
