/**
 * Workflow analysis (V7.2, pure). Static analysis of a `WorkflowSpec`'s DAG —
 * health scoring and critical-path computation — over the SAME spec the
 * Orchestrator executes. No execution, no I/O: it inspects structure so operators
 * can see risk (bottlenecks, over-parallelism, long chains) before a run and reason
 * about duration and slack. Reuses the validated wave plan from the goal planner
 * (V7.1) rather than recomputing dependency logic.
 */
import type { WorkflowSpec, WorkflowStep } from '@neuropause/shared';
import { planWorkflow } from './workflowPlanning';

export type HealthIssueKind =
  'invalid' | 'excessive_parallelism' | 'long_chain' | 'isolated_step' | 'approval_bottleneck';

export interface WorkflowHealthIssue {
  kind: HealthIssueKind;
  detail: string;
  severity: 'low' | 'medium' | 'high';
}

export interface WorkflowHealth {
  /** 0..100; 100 is a clean, well-shaped workflow. */
  score: number;
  issues: WorkflowHealthIssue[];
  stepCount: number;
  /** Largest number of steps runnable in one wave. */
  maxParallelism: number;
  /** Number of waves = longest dependency depth. */
  depth: number;
}

export interface HealthThresholds {
  maxParallelism: number;
  maxDepth: number;
}

const DEFAULT_THRESHOLDS: HealthThresholds = { maxParallelism: 8, maxDepth: 8 };

const SEVERITY_PENALTY: Record<WorkflowHealthIssue['severity'], number> = {
  low: 5,
  medium: 10,
  high: 20,
};

function dependentsMap(steps: readonly WorkflowStep[]): Map<string, string[]> {
  const dependents = new Map<string, string[]>();
  for (const s of steps) {
    for (const dep of s.dependsOn) {
      const list = dependents.get(dep);
      if (list) list.push(s.id);
      else dependents.set(dep, [s.id]);
    }
  }
  return dependents;
}

/**
 * Score a workflow's structural health and surface issues. An invalid DAG (cycle /
 * unknown dep / duplicate) scores 0. Otherwise deductions accrue for excessive
 * parallelism, over-long dependency chains, isolated (disconnected) steps, and
 * approval steps that gate most of the workflow.
 */
export function analyzeWorkflowHealth(
  spec: WorkflowSpec,
  thresholds: HealthThresholds = DEFAULT_THRESHOLDS,
): WorkflowHealth {
  const stepCount = spec.steps.length;
  const plan = planWorkflow(spec);
  if (!plan.ok) {
    return {
      score: 0,
      issues: [{ kind: 'invalid', detail: plan.detail, severity: 'high' }],
      stepCount,
      maxParallelism: 0,
      depth: 0,
    };
  }

  const waves = plan.plan.waves;
  const maxParallelism = waves.reduce((m, w) => Math.max(m, w.length), 0);
  const depth = waves.length;
  const issues: WorkflowHealthIssue[] = [];

  if (maxParallelism > thresholds.maxParallelism) {
    issues.push({
      kind: 'excessive_parallelism',
      detail: `a wave runs ${maxParallelism} steps in parallel (> ${thresholds.maxParallelism})`,
      severity: 'medium',
    });
  }
  if (depth > thresholds.maxDepth) {
    issues.push({
      kind: 'long_chain',
      detail: `dependency depth is ${depth} (> ${thresholds.maxDepth})`,
      severity: 'medium',
    });
  }

  // Isolated steps: no deps and nothing depends on them, in a multi-step workflow.
  if (stepCount > 1) {
    const dependents = dependentsMap(spec.steps);
    for (const s of spec.steps) {
      if (s.dependsOn.length === 0 && (dependents.get(s.id)?.length ?? 0) === 0) {
        issues.push({
          kind: 'isolated_step',
          detail: `step "${s.id}" is disconnected`,
          severity: 'low',
        });
      }
    }
  }

  // Approval bottleneck: an approval step most other steps transitively depend on.
  const dependents = dependentsMap(spec.steps);
  for (const s of spec.steps) {
    if (s.kind !== 'approval') continue;
    const downstream = transitiveDependents(s.id, dependents);
    if (downstream >= Math.ceil((stepCount - 1) / 2) && downstream > 0) {
      issues.push({
        kind: 'approval_bottleneck',
        detail: `approval "${s.id}" gates ${downstream} downstream steps`,
        severity: 'high',
      });
    }
  }

  const penalty = issues.reduce((sum, i) => sum + SEVERITY_PENALTY[i.severity], 0);
  return { score: Math.max(0, 100 - penalty), issues, stepCount, maxParallelism, depth };
}

function transitiveDependents(id: string, dependents: Map<string, string[]>): number {
  const seen = new Set<string>();
  const stack = [...(dependents.get(id) ?? [])];
  while (stack.length > 0) {
    const next = stack.pop()!;
    if (seen.has(next)) continue;
    seen.add(next);
    for (const d of dependents.get(next) ?? []) stack.push(d);
  }
  return seen.size;
}

export interface CriticalPathResult {
  /** Step ids on the critical path (zero slack), in topological order. */
  path: string[];
  /** Total duration along the critical path. */
  estimatedDuration: number;
  /** Slack (latest start − earliest start) per step. */
  slack: Record<string, number>;
  /** Zero-slack steps — delaying any of them delays the whole workflow. */
  bottlenecks: string[];
}

/**
 * Critical Path Method over the DAG. `durationOf` estimates each step's duration
 * (default 1 per step). Returns the critical path, total duration, and per-step
 * slack. An invalid DAG returns an empty result. Pure.
 */
export function criticalPath(
  spec: WorkflowSpec,
  durationOf: (step: WorkflowStep) => number = () => 1,
): CriticalPathResult {
  const plan = planWorkflow(spec);
  if (!plan.ok) return { path: [], estimatedDuration: 0, slack: {}, bottlenecks: [] };

  const order = plan.plan.order;
  const byId = new Map(spec.steps.map((s) => [s.id, s]));
  const dur = (id: string): number => durationOf(byId.get(id)!);
  const dependents = dependentsMap(spec.steps);

  // Forward pass: earliest start/finish.
  const earliestStart = new Map<string, number>();
  const earliestFinish = new Map<string, number>();
  for (const id of order) {
    const deps = byId.get(id)!.dependsOn;
    const es = deps.reduce((m, d) => Math.max(m, earliestFinish.get(d) ?? 0), 0);
    earliestStart.set(id, es);
    earliestFinish.set(id, es + dur(id));
  }
  const total = order.reduce((m, id) => Math.max(m, earliestFinish.get(id) ?? 0), 0);

  // Backward pass: latest finish/start.
  const latestFinish = new Map<string, number>();
  const latestStart = new Map<string, number>();
  for (const id of [...order].reverse()) {
    const deps = dependents.get(id) ?? [];
    const lf =
      deps.length === 0
        ? total
        : deps.reduce((m, d) => Math.min(m, latestStart.get(d) ?? total), total);
    latestFinish.set(id, lf);
    latestStart.set(id, lf - dur(id));
  }

  const slack: Record<string, number> = {};
  const bottlenecks: string[] = [];
  for (const id of order) {
    const s = (latestStart.get(id) ?? 0) - (earliestStart.get(id) ?? 0);
    slack[id] = Math.round(s * 1000) / 1000;
    if (slack[id] === 0) bottlenecks.push(id);
  }

  return { path: bottlenecks.slice(), estimatedDuration: total, slack, bottlenecks };
}
