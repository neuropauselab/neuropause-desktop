/**
 * P8.6 — Enterprise Workforce Center: the pure view-model.
 *
 * All non-trivial Center logic lives here (the house `*Model.ts` pattern — see
 * operationsCenter/opsModel.ts) so it is unit-tested under Node while the panels stay
 * thin JSX. Nothing here does I/O; every function is a pure projection over the data
 * the WorkforceProvider already loads (workers, jobs, installs, intelligence,
 * delegation plans). No new runtime, registry, or governance.
 */
import type {
  DelegationPlan,
  Job,
  JobStatus,
  MemoryScope,
  Worker,
  WorkerHealthState,
  WorkerInstallDetail,
  WorkerInstallSummary,
  WorkerPermissionScope,
  WorkerRole,
  WorkerSummary,
} from '@neuropause/shared';
import type { WorkforceIntelligence } from '../workforce/intelligenceTypes';

/** The Workforce Center's sub-tabs. */
export type CenterTab = 'overview' | 'workers' | 'installs' | 'execution' | 'health' | 'delegation';

/* ── virtualization ──────────────────────────────────────────────────────── */

export interface WindowRange {
  start: number;
  end: number;
  padTop: number;
  padBottom: number;
}

/**
 * Compute the visible row window for a fixed-row-height virtualized list. Pure so it
 * unit-tests without a DOM; the VirtualList component feeds it scrollTop/viewport.
 */
export function windowRange(
  scrollTop: number,
  viewportH: number,
  rowH: number,
  count: number,
  overscan = 6,
): WindowRange {
  if (count <= 0 || rowH <= 0 || viewportH <= 0) return { start: 0, end: 0, padTop: 0, padBottom: 0 };
  const first = Math.max(0, Math.floor(scrollTop / rowH) - overscan);
  const visible = Math.ceil(viewportH / rowH) + overscan * 2;
  const start = Math.min(first, Math.max(0, count - 1));
  const end = Math.min(count, start + visible);
  return { start, end, padTop: start * rowH, padBottom: Math.max(0, (count - end) * rowH) };
}

/* ── search ──────────────────────────────────────────────────────────────── */

/** Filter workers by name / role / id / (installed) capability tags. Reuses list data. */
export function searchWorkforce(
  workers: WorkerSummary[],
  installs: WorkerInstallSummary[],
  query: string,
): WorkerSummary[] {
  const q = query.trim().toLowerCase();
  if (!q) return workers;
  const capsById = new Map(installs.map((i) => [i.id, i.capabilities.map((c) => c.toLowerCase())]));
  return workers.filter(
    (w) =>
      w.name.toLowerCase().includes(q) ||
      w.role.toLowerCase().includes(q) ||
      w.id.toLowerCase().includes(q) ||
      (capsById.get(w.id) ?? []).some((c) => c.includes(q)),
  );
}

/* ── execution ───────────────────────────────────────────────────────────── */

export const JOB_STATUSES: JobStatus[] = [
  'queued',
  'running',
  'awaiting_approval',
  'succeeded',
  'failed',
  'cancelled',
];

/** Count jobs by status (every status key present, zero-filled). */
export function jobStatusCounts(jobs: Job[]): Record<JobStatus, number> {
  const base: Record<JobStatus, number> = {
    queued: 0,
    running: 0,
    awaiting_approval: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
  };
  for (const j of jobs) base[j.status] = (base[j.status] ?? 0) + 1;
  return base;
}

/** Filter + newest-first sort a job list for the execution history view. */
export function executionHistory(
  jobs: Job[],
  opts: { workerId?: string; status?: JobStatus } = {},
): Job[] {
  return jobs
    .filter((j) => (opts.workerId ? j.workerId === opts.workerId : true))
    .filter((j) => (opts.status ? j.status === opts.status : true))
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

/** The pending approval queue: proposals still awaiting a human decision. */
export interface ApprovalQueueItem {
  jobId: string;
  proposalId: string;
  workerId: string;
  title: string;
  risk: string;
}
export function approvalQueue(jobs: Job[]): ApprovalQueueItem[] {
  const out: ApprovalQueueItem[] = [];
  for (const j of jobs) {
    for (const p of j.proposals) {
      if (p.verdict.decision === 'require_approval' && !p.approval) {
        out.push({ jobId: j.id, proposalId: p.id, workerId: j.workerId, title: p.title, risk: p.risk });
      }
    }
  }
  return out;
}

/* ── health ──────────────────────────────────────────────────────────────── */

export interface HealthRow {
  id: string;
  name: string;
  role: WorkerRole;
  healthState: WorkerHealthState;
  trust: number;
  total: number;
  succeeded: number;
  failed: number;
  successRate: number;
  failureRate: number;
  avgLatencyMs: number | null;
  inFlight: number;
  /** Share of the current live workload across the roster (0..1). */
  utilization: number;
  lastActiveAt: string | null;
}

/**
 * Per-worker health/trust/latency/utilization rows. Success/latency come from the
 * intelligence fold; failure rate is derived (`failed/decided`); utilization is the
 * worker's share of the roster's current in-flight load (documented proxy — there is
 * no capacity model, so this is a relative "how busy right now").
 */
export function healthRows(workers: WorkerSummary[], intel: WorkforceIntelligence | null): HealthRow[] {
  const perf = new Map((intel?.workers ?? []).map((p) => [p.workerId, p]));
  const totalInFlight = (intel?.workers ?? []).reduce((n, p) => n + p.inFlight, 0);
  return workers.map((w) => {
    const p = perf.get(w.id);
    const succeeded = p?.succeeded ?? 0;
    const failed = p?.failed ?? 0;
    const decided = succeeded + failed;
    const inFlight = p?.inFlight ?? 0;
    return {
      id: w.id,
      name: w.name,
      role: w.role,
      healthState: w.healthState,
      trust: w.trustScore,
      total: p?.total ?? 0,
      succeeded,
      failed,
      successRate: p?.successRate ?? (decided ? succeeded / decided : 0),
      failureRate: decided ? failed / decided : 0,
      avgLatencyMs: p?.avgDurationMs ?? null,
      inFlight,
      utilization: totalInFlight > 0 ? inFlight / totalInFlight : 0,
      lastActiveAt: p?.lastActiveAt ?? null,
    };
  });
}

/* ── install lifecycle ───────────────────────────────────────────────────── */

export interface InstallActions {
  canEnable: boolean;
  canDisable: boolean;
  canRollback: boolean;
  canUpdate: boolean;
  canUninstall: boolean;
}

/** Which lifecycle actions apply to an installed package, from its state. */
export function installActions(s: WorkerInstallSummary): InstallActions {
  return {
    canEnable: s.state === 'disabled',
    canDisable: s.state === 'enabled',
    canRollback: s.canRollback,
    canUpdate: true,
    canUninstall: true,
  };
}

/* ── worker details ──────────────────────────────────────────────────────── */

export interface ExecutionBindingVM {
  skillId: string;
  executor: string;
  target: string;
  actionId: string | null;
}

export interface WorkerDetailVM {
  id: string;
  name: string;
  role: WorkerRole;
  version: string;
  publisher: string;
  signature: string;
  builtIn: boolean;
  healthState: WorkerHealthState;
  trust: number;
  memoryScope: MemoryScope;
  capabilities: string[];
  permissions: WorkerPermissionScope[];
  executionBindings: ExecutionBindingVM[];
  connectorUsage: string[];
  dependencies: string[];
  skills: { id: string; title: string; sideEffects: boolean; requires: WorkerPermissionScope[] }[];
  goals: string[];
}

function metaStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * Assemble the full Worker Details view-model by merging the live `Worker` (identity,
 * health, trust, permissions, skills, memory scope) with the optional install detail
 * (publisher, signature, execution bindings, connector usage, dependencies). Built-in
 * workers have no install detail → they render as first-party/built-in.
 */
export function assembleWorkerDetail(worker: Worker, detail: WorkerInstallDetail | null): WorkerDetailVM {
  const bindings: ExecutionBindingVM[] = (detail?.skills ?? [])
    .filter((s) => s.kind === 'infra' || s.kind === 'mail')
    .map((s) =>
      s.kind === 'mail'
        ? { skillId: s.id, executor: 'm365', target: 'microsoft-entra', actionId: 'mail.send' }
        : { skillId: s.id, executor: 'infra', target: s.target ?? '', actionId: s.actionId ?? null },
    );
  const connectorUsage = [
    ...new Set(bindings.map((b) => (b.executor === 'm365' ? 'Microsoft 365' : b.target || 'infrastructure'))),
  ];
  const publisher =
    detail?.author ??
    (typeof worker.metadata.author === 'string' ? worker.metadata.author : worker.identity.developer);
  const signature = worker.builtIn
    ? 'Built-in · first-party'
    : detail?.signed
      ? 'Signed · verified'
      : 'Unsigned';
  return {
    id: worker.identity.id,
    name: worker.identity.name,
    role: worker.identity.role,
    version: worker.identity.version,
    publisher,
    signature,
    builtIn: worker.builtIn,
    healthState: worker.health.state,
    trust: worker.trustScore,
    memoryScope: worker.memoryScope,
    capabilities: detail?.capabilities ?? metaStringArray(worker.metadata.capabilities),
    permissions: worker.permissions.filter((p) => p.granted).map((p) => p.scope),
    executionBindings: bindings,
    connectorUsage,
    dependencies: detail?.dependencies ?? [],
    skills: worker.skills.map((s) => ({
      id: s.id,
      title: s.title,
      sideEffects: s.sideEffects,
      requires: s.requires,
    })),
    goals: worker.goals,
  };
}

/* ── delegation graph layout ─────────────────────────────────────────────── */

export interface DelegationNode {
  taskId: string;
  title: string;
  x: number;
  y: number;
  wave: number;
  onCriticalPath: boolean;
  workerName: string | null;
  role: WorkerRole | null;
  assigned: boolean;
}
export interface DelegationEdge {
  from: string;
  to: string;
  critical: boolean;
}
export interface DelegationLayout {
  nodes: DelegationNode[];
  edges: DelegationEdge[];
  width: number;
  height: number;
}

/**
 * Lay a delegation plan out as a wave-columned DAG: each topological wave is a column,
 * tasks stack within it, and dependency edges connect them. Pure (deterministic
 * coordinates) so the visual is unit-tested. Critical-path tasks/edges are flagged.
 */
export function delegationLayout(
  plan: DelegationPlan,
  opts: { colWidth?: number; rowHeight?: number } = {},
): DelegationLayout {
  const colW = opts.colWidth ?? 210;
  const rowH = opts.rowHeight ?? 88;
  const padX = 90;
  const padY = 52;
  const critical = new Set(plan.criticalPath);
  const byId = new Map(plan.assignments.map((a) => [a.taskId, a]));

  const nodes: DelegationNode[] = [];
  plan.waves.forEach((wave, wi) => {
    wave.forEach((taskId, ri) => {
      const a = byId.get(taskId);
      nodes.push({
        taskId,
        title: a?.taskTitle ?? taskId,
        x: padX + wi * colW,
        y: padY + ri * rowH,
        wave: wi,
        onCriticalPath: critical.has(taskId) || (a?.onCriticalPath ?? false),
        workerName: a?.workerName ?? null,
        role: a?.role ?? null,
        assigned: Boolean(a?.workerId),
      });
    });
  });

  const known = new Set(nodes.map((n) => n.taskId));
  const edges: DelegationEdge[] = [];
  for (const a of plan.assignments) {
    for (const dep of a.dependsOn) {
      if (known.has(dep) && known.has(a.taskId)) {
        edges.push({ from: dep, to: a.taskId, critical: critical.has(dep) && critical.has(a.taskId) });
      }
    }
  }

  const maxRow = plan.waves.reduce((m, w) => Math.max(m, w.length), 1);
  const width = padX * 2 + Math.max(0, plan.waves.length - 1) * colW + 170;
  const height = padY * 2 + Math.max(0, maxRow - 1) * rowH + 64;
  return { nodes, edges, width, height };
}
