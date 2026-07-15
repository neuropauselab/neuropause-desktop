/**
 * AI Workforce — Delegation & Task-Graph model (P8).
 *
 * A worker with a goal decomposes it into a set of interdependent tasks, then the
 * workforce DELEGATES each task to the best-fit worker and schedules the whole
 * graph. This module is the shared, pure contract for that: the task-graph inputs,
 * the owner-assignment scoring (deterministic, evidence-listed), and the resulting
 * DelegationPlan (assignments · waves · critical path · deadlines · load).
 *
 * It intentionally holds ONLY types + the pure per-candidate scoring — the graph
 * topology + critical-path scheduling reuse the existing workforce planners
 * (`planGoal`, `criticalPath`), which live in the main process. No new graph, no
 * new scheduler: this is the delegation layer on top of what already exists.
 *
 * Types + pure helpers only (Node-free).
 */
import type { WorkerRole, WorkerPermissionScope, WorkerHealthState, WorkerLifecycle } from './worker';

/** One task in a goal's decomposition — the unit that gets delegated + scheduled. */
export interface DelegationTaskInput {
  id: string;
  title: string;
  /** Preferred worker role for this task (drives the role-match score). */
  role?: WorkerRole;
  /** Permission scopes the task exercises; a worker must grant ALL to be eligible. */
  requiredScopes?: WorkerPermissionScope[];
  /** Ids of tasks that must finish first (the dependency edges). */
  dependsOn?: string[];
  /** Higher runs earlier within a wave. Default 0. */
  priority?: number;
  /** Relative effort/duration (default 1) — drives the schedule + deadlines. */
  effort?: number;
}

/** A goal to delegate: an id, a human title, and its task decomposition. */
export interface DelegationGoalInput {
  id: string;
  title: string;
  tasks: DelegationTaskInput[];
}

/** The subset of a Worker the assignment scorer reasons over. */
export interface DelegationCandidate {
  id: string;
  name: string;
  role: WorkerRole;
  /** 0..1. */
  trustScore: number;
  healthState: WorkerHealthState;
  lifecycle: WorkerLifecycle;
  /** Granted permission scopes (used for capability matching). */
  grantedScopes: WorkerPermissionScope[];
}

/** The decomposed score for one (task, worker) pairing, with human reasons. */
export interface AssignmentScore {
  /** 0..1 composite. */
  total: number;
  roleMatch: number;
  scopeCoverage: number;
  trust: number;
  health: number;
  availability: number;
  reasons: string[];
}

/** One task's delegation outcome — its owner (or null), match, and schedule slot. */
export interface DelegationAssignment {
  taskId: string;
  taskTitle: string;
  /** null when no eligible worker exists. */
  workerId: string | null;
  workerName: string | null;
  role: WorkerRole | null;
  /** 0..1. */
  matchScore: number;
  reasons: string[];
  /** Schedule in relative effort units (from the forward pass). */
  startOffset: number;
  finishOffset: number;
  onCriticalPath: boolean;
  dependsOn: string[];
  /** Parallel wave index (all tasks in a wave can run concurrently). */
  wave: number;
}

/** Per-worker load rollup for balancing insight. */
export interface DelegationWorkerLoad {
  workerId: string;
  workerName: string;
  role: WorkerRole;
  taskCount: number;
  effort: number;
}

export type DelegationError = 'cycle' | 'duplicate_task' | 'unknown_dependency';

/** The complete delegation plan for a goal. */
export interface DelegationPlan {
  goalId: string;
  goalTitle: string;
  assignments: DelegationAssignment[];
  /** Topological waves of task ids (parallelizable within a wave). */
  waves: string[][];
  /** Zero-slack task ids — the critical path. */
  criticalPath: string[];
  /** Total duration along the critical path (relative units). */
  estimatedDuration: number;
  totalTasks: number;
  assignedTasks: number;
  unassigned: string[];
  load: DelegationWorkerLoad[];
  /** 0..1 overall plan confidence (mean match × coverage). */
  confidence: number;
  /** Set when the task graph is malformed; assignments/waves are then empty. */
  error: DelegationError | null;
  errorDetail: string | null;
  generatedAt: string;
}

// Non-finite (NaN/±Infinity) maps to 0 so a corrupt trustScore can never poison a
// score (NaN would silently win the argmax and break the 0..1 confidence invariant).
const clamp01 = (n: number): number => (!Number.isFinite(n) ? 0 : n < 0 ? 0 : n > 1 ? 1 : n);

/** How available a worker is by lifecycle state (stopped/errored are ineligible). */
const LIFECYCLE_WEIGHT: Record<WorkerLifecycle, number> = {
  idle: 1,
  registered: 0.9,
  running: 0.7,
  paused: 0.3,
  stopped: 0,
  errored: 0,
};

const HEALTH_WEIGHT: Record<WorkerHealthState, number> = {
  healthy: 1,
  degraded: 0.6,
  unhealthy: 0.2,
  unknown: 0.5,
};

/**
 * Whether a worker may take a task at all: not stopped/errored, and — when the
 * task declares required scopes — it grants every one of them. Pure.
 */
export function isEligible(task: DelegationTaskInput, worker: DelegationCandidate): boolean {
  if (worker.lifecycle === 'stopped' || worker.lifecycle === 'errored') return false;
  const required = task.requiredScopes ?? [];
  if (required.length === 0) return true;
  const granted = new Set(worker.grantedScopes);
  return required.every((s) => granted.has(s));
}

/**
 * Deterministic per-candidate fitness for a task: a weighted blend of role match,
 * required-scope coverage, trust, health, and availability, each in 0..1, with a
 * human-readable list of the factors that drove it. Pure — same inputs, same score.
 */
export function scoreCandidate(task: DelegationTaskInput, worker: DelegationCandidate): AssignmentScore {
  const reasons: string[] = [];

  const exactRole = task.role != null && task.role === worker.role;
  const roleMatch = task.role == null ? 0.7 : exactRole ? 1 : 0.35;
  if (exactRole) reasons.push(`role match (${worker.role})`);
  else if (task.role != null) reasons.push(`cross-role (${worker.role} for ${task.role})`);

  const required = task.requiredScopes ?? [];
  const granted = new Set(worker.grantedScopes);
  const covered = required.filter((s) => granted.has(s)).length;
  const scopeCoverage = required.length === 0 ? 1 : covered / required.length;
  if (required.length > 0) {
    reasons.push(scopeCoverage === 1 ? 'all required scopes granted' : `${covered}/${required.length} scopes`);
  }

  const trust = clamp01(worker.trustScore);
  if (trust >= 0.8) reasons.push('high trust');
  else if (trust < 0.4) reasons.push('low trust');

  const health = HEALTH_WEIGHT[worker.healthState];
  const availability = LIFECYCLE_WEIGHT[worker.lifecycle];
  if (availability < 0.5) reasons.push(`limited availability (${worker.lifecycle})`);

  const total = clamp01(
    0.34 * roleMatch + 0.24 * scopeCoverage + 0.18 * trust + 0.12 * health + 0.12 * availability,
  );
  return { total, roleMatch, scopeCoverage, trust, health, availability, reasons };
}
