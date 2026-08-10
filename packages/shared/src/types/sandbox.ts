/**
 * AI Sandbox — Sandbox Core (S1).
 *
 * The reusable substrate every future sandbox feature (test runner, AI evaluation,
 * Playwright/desktop automation, …) builds on. S1 ships the domain model + the pure,
 * deterministic core of it — workspaces, versioned scenarios, an execution lifecycle
 * (queue → run → status → timeline), an artifact model (screenshots/video/logs/
 * reports/results) + datasets, report generation, and a dashboard rollup. There is
 * NO executor here (no AI, no Playwright, no desktop automation): the engine runs
 * whatever executor a later stage registers, exactly like the existing ExecuteEngine
 * orchestrates injected subsystem executors. Types + pure helpers only; the stores +
 * engine live in `main/sandbox` and reuse the existing persistence + event-bus + RBAC.
 */

/* ─────────────────────────── Workspace ─────────────────────────── */

export interface SandboxWorkspaceSettings {
  /** Default per-execution wall-clock budget (ms). */
  defaultTimeoutMs: number;
  /** How many executions may run at once in this workspace. */
  maxConcurrency: number;
  /** Run/artifact retention window in days (0 = keep everything). */
  retentionDays: number;
}

export interface SandboxWorkspace {
  /**
   * The organization this belongs to (P13C N3).
   *
   * OPTIONAL so a sandbox file written before P13C still parses. Absent means
   * UNRESOLVED — the record belongs to no tenant and is visible to none, which
   * is the same fail-closed reading Programs 12 and 13A/B applied to pre-boundary
   * rows. It is deliberately not back-filled to the first or active organization:
   * that guess is the defect this field exists to remove.
   *
   * Tenant-level, not workspace-level. The `workspaceId` on these records is a
   * SANDBOX workspace (`sbw_…`), a different namespace from the enterprise
   * workspace in `TenantScope`; conflating them would deny every read.
   */
  tenantId?: string | null;
  id: string;
  name: string;
  description: string;
  settings: SandboxWorkspaceSettings;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_WORKSPACE_SETTINGS: SandboxWorkspaceSettings = {
  defaultTimeoutMs: 60_000,
  maxConcurrency: 2,
  retentionDays: 30,
};

/* ─────────────────────────── Scenario (registry + versioning + metadata) ─────────────────────────── */

export interface ScenarioMetadata {
  tags: string[];
  category: string | null;
  owner: string | null;
  /** Free-form key/value labels (flat scalars). */
  labels: Record<string, string>;
}

export const EMPTY_SCENARIO_METADATA: ScenarioMetadata = { tags: [], category: null, owner: null, labels: {} };

export interface Scenario {
  /**
   * The organization this belongs to (P13C N3).
   *
   * OPTIONAL so a sandbox file written before P13C still parses. Absent means
   * UNRESOLVED — the record belongs to no tenant and is visible to none, which
   * is the same fail-closed reading Programs 12 and 13A/B applied to pre-boundary
   * rows. It is deliberately not back-filled to the first or active organization:
   * that guess is the defect this field exists to remove.
   *
   * Tenant-level, not workspace-level. The `workspaceId` on these records is a
   * SANDBOX workspace (`sbw_…`), a different namespace from the enterprise
   * workspace in `TenantScope`; conflating them would deny every read.
   */
  tenantId?: string | null;
  id: string;
  workspaceId: string;
  /** Stable, human key unique within a workspace (e.g. `checkout-happy-path`). */
  key: string;
  name: string;
  description: string;
  metadata: ScenarioMetadata;
  /** The highest version number registered (0 until the first version is added). */
  latestVersion: number;
  versionCount: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A scenario's definition is opaque to the core — later stages give it meaning. */
export type ScenarioSpec = Record<string, unknown>;

export interface ScenarioVersion {
  /**
   * The organization this belongs to (P13C N3).
   *
   * OPTIONAL so a sandbox file written before P13C still parses. Absent means
   * UNRESOLVED — the record belongs to no tenant and is visible to none, which
   * is the same fail-closed reading Programs 12 and 13A/B applied to pre-boundary
   * rows. It is deliberately not back-filled to the first or active organization:
   * that guess is the defect this field exists to remove.
   *
   * Tenant-level, not workspace-level. The `workspaceId` on these records is a
   * SANDBOX workspace (`sbw_…`), a different namespace from the enterprise
   * workspace in `TenantScope`; conflating them would deny every read.
   */
  tenantId?: string | null;
  id: string;
  scenarioId: string;
  /** Monotonic 1-based version number. */
  version: number;
  spec: ScenarioSpec;
  /** Deterministic content hash of the spec (drift + dedupe). */
  checksum: string;
  changelog: string;
  createdAt: string;
}

/* ─────────────────────────── Execution lifecycle ─────────────────────────── */

export type ExecutionStatus =
  | 'queued'
  | 'running'
  | 'passed'
  | 'failed'
  | 'error'
  | 'cancelled'
  | 'timed_out';

export const TERMINAL_EXECUTION_STATUSES: readonly ExecutionStatus[] = [
  'passed',
  'failed',
  'error',
  'cancelled',
  'timed_out',
];

export type ExecutionTrigger = 'manual' | 'api' | 'scheduled' | 'ci';
export type ExecutionPriority = 'low' | 'normal' | 'high';

export const EXECUTION_PRIORITIES: readonly ExecutionPriority[] = ['low', 'normal', 'high'];

export interface Execution {
  /**
   * The organization this belongs to (P13C N3).
   *
   * OPTIONAL so a sandbox file written before P13C still parses. Absent means
   * UNRESOLVED — the record belongs to no tenant and is visible to none, which
   * is the same fail-closed reading Programs 12 and 13A/B applied to pre-boundary
   * rows. It is deliberately not back-filled to the first or active organization:
   * that guess is the defect this field exists to remove.
   *
   * Tenant-level, not workspace-level. The `workspaceId` on these records is a
   * SANDBOX workspace (`sbw_…`), a different namespace from the enterprise
   * workspace in `TenantScope`; conflating them would deny every read.
   */
  tenantId?: string | null;
  id: string;
  workspaceId: string;
  scenarioId: string;
  /** The scenario version this run pinned. */
  scenarioVersion: number;
  status: ExecutionStatus;
  trigger: ExecutionTrigger;
  priority: ExecutionPriority;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  attempt: number;
  /** Set once a result / report is produced. */
  resultId: string | null;
  reportId: string | null;
  error: string | null;
}

export type TimelinePhase =
  | 'queued'
  | 'started'
  | 'step'
  | 'artifact'
  | 'log'
  | 'result'
  | 'report'
  | 'passed'
  | 'failed'
  | 'error'
  | 'cancelled'
  | 'timed_out';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ExecutionTimelineEntry {
  id: string;
  executionId: string;
  at: string;
  phase: TimelinePhase;
  level: LogLevel;
  message: string;
  /** Optional flat context (scalars). */
  data: Record<string, string | number | boolean | null>;
}

/* ─────────────────────────── Artifacts (outputs) + datasets (inputs) ─────────────────────────── */

export type ArtifactKind = 'screenshot' | 'video' | 'log' | 'report' | 'result' | 'trace' | 'other';

export const ARTIFACT_KINDS: readonly ArtifactKind[] = ['screenshot', 'video', 'log', 'report', 'result', 'trace', 'other'];

export interface Artifact {
  /**
   * The organization this belongs to (P13C N3).
   *
   * OPTIONAL so a sandbox file written before P13C still parses. Absent means
   * UNRESOLVED — the record belongs to no tenant and is visible to none, which
   * is the same fail-closed reading Programs 12 and 13A/B applied to pre-boundary
   * rows. It is deliberately not back-filled to the first or active organization:
   * that guess is the defect this field exists to remove.
   *
   * Tenant-level, not workspace-level. The `workspaceId` on these records is a
   * SANDBOX workspace (`sbw_…`), a different namespace from the enterprise
   * workspace in `TenantScope`; conflating them would deny every read.
   */
  tenantId?: string | null;
  id: string;
  executionId: string;
  workspaceId: string;
  kind: ArtifactKind;
  name: string;
  mimeType: string;
  sizeBytes: number;
  /**
   * Where the bytes live. Binary artifacts (screenshots/video) carry a `storageRef`
   * a later stage wrote; textual artifacts (logs/reports/results) may carry their
   * content `inline`. Exactly the record is owned by the core — never the capture.
   */
  storageRef: string | null;
  inline: string | null;
  createdAt: string;
  metadata: Record<string, string | number | boolean | null>;
}

export interface Dataset {
  /**
   * The organization this belongs to (P13C N3).
   *
   * OPTIONAL so a sandbox file written before P13C still parses. Absent means
   * UNRESOLVED — the record belongs to no tenant and is visible to none, which
   * is the same fail-closed reading Programs 12 and 13A/B applied to pre-boundary
   * rows. It is deliberately not back-filled to the first or active organization:
   * that guess is the defect this field exists to remove.
   *
   * Tenant-level, not workspace-level. The `workspaceId` on these records is a
   * SANDBOX workspace (`sbw_…`), a different namespace from the enterprise
   * workspace in `TenantScope`; conflating them would deny every read.
   */
  tenantId?: string | null;
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  /** Row count if known (a dataset is a named input fixture). */
  rows: number;
  /** Column/field names if known. */
  schema: string[];
  storageRef: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ─────────────────────────── Result + report ─────────────────────────── */

export type RunOutcome = 'pass' | 'fail' | 'error';

export interface RunAssertions {
  total: number;
  passed: number;
  failed: number;
}

export interface RunResult {
  /**
   * The organization this belongs to (P13C N3).
   *
   * OPTIONAL so a sandbox file written before P13C still parses. Absent means
   * UNRESOLVED — the record belongs to no tenant and is visible to none, which
   * is the same fail-closed reading Programs 12 and 13A/B applied to pre-boundary
   * rows. It is deliberately not back-filled to the first or active organization:
   * that guess is the defect this field exists to remove.
   *
   * Tenant-level, not workspace-level. The `workspaceId` on these records is a
   * SANDBOX workspace (`sbw_…`), a different namespace from the enterprise
   * workspace in `TenantScope`; conflating them would deny every read.
   */
  tenantId?: string | null;
  id: string;
  executionId: string;
  outcome: RunOutcome;
  summary: string;
  assertions: RunAssertions;
  /** Deterministic numeric metrics (durationMs, steps, custom …). */
  metrics: Record<string, number>;
  createdAt: string;
}

export interface ReportSection {
  heading: string;
  body: string;
  items: string[];
}

export interface SandboxReport {
  /**
   * The organization this belongs to (P13C N3).
   *
   * OPTIONAL so a sandbox file written before P13C still parses. Absent means
   * UNRESOLVED — the record belongs to no tenant and is visible to none, which
   * is the same fail-closed reading Programs 12 and 13A/B applied to pre-boundary
   * rows. It is deliberately not back-filled to the first or active organization:
   * that guess is the defect this field exists to remove.
   *
   * Tenant-level, not workspace-level. The `workspaceId` on these records is a
   * SANDBOX workspace (`sbw_…`), a different namespace from the enterprise
   * workspace in `TenantScope`; conflating them would deny every read.
   */
  tenantId?: string | null;
  id: string;
  executionId: string;
  scenarioId: string;
  workspaceId: string;
  title: string;
  status: ExecutionStatus;
  summary: string;
  sections: ReportSection[];
  generatedAt: string;
}

/* ─────────────────────────── Queue + history + dashboard ─────────────────────────── */

export interface QueueEntry {
  executionId: string;
  scenarioId: string;
  priority: ExecutionPriority;
  enqueuedAt: string;
}

export interface ExecutionQueueState {
  pending: QueueEntry[];
  running: string[];
  depth: number;
  concurrency: number;
}

export interface RunHistoryQuery {
  workspaceId?: string;
  scenarioId?: string;
  status?: ExecutionStatus;
  limit?: number;
  cursor?: string | null;
}

export interface RunHistoryPage {
  executions: Execution[];
  nextCursor: string | null;
  total: number;
}

/** Lightweight change signal broadcast to the renderer for live refresh (the rich,
 *  per-execution history lives in the execution store's timeline, not on a shared bus). */
export interface SandboxEvent {
  /** P13C N3 — the owning tenant, so an unfiltered fan-out is filterable. */
  tenantId?: string | null;
  kind: 'queued' | 'started' | 'passed' | 'failed' | 'error' | 'cancelled' | 'timed_out' | 'artifact';
  executionId: string;
  workspaceId: string;
  scenarioId: string;
  status: ExecutionStatus;
  at: string;
}

export interface SandboxDashboard {
  workspaces: number;
  scenarios: number;
  executions: { total: number; byStatus: Record<string, number> };
  /** Passed / (passed + failed + error + timed_out), 0–1; null when no finished runs. */
  passRate: number | null;
  queue: { depth: number; running: number };
  artifacts: { total: number; byKind: Record<string, number> };
  recentRuns: Execution[];
  generatedAt: string;
}

/* ═══════════════════════════ Pure helpers ═══════════════════════════ */

const PRIORITY_RANK: Record<ExecutionPriority, number> = { high: 0, normal: 1, low: 2 };

/** Whether a status is terminal (a run in this state never changes again). */
export function isTerminalExecutionStatus(status: ExecutionStatus): boolean {
  return TERMINAL_EXECUTION_STATUSES.includes(status);
}

/** The legal execution status transitions. Guards the store's state machine. */
export function canTransitionExecution(from: ExecutionStatus, to: ExecutionStatus): boolean {
  if (from === to) return false;
  if (isTerminalExecutionStatus(from)) return false;
  if (from === 'queued') return to === 'running' || to === 'cancelled' || to === 'error';
  // from 'running'
  return to === 'passed' || to === 'failed' || to === 'error' || to === 'cancelled' || to === 'timed_out';
}

/** Map a run outcome to the terminal execution status. */
export function statusFromOutcome(outcome: RunOutcome): 'passed' | 'failed' | 'error' {
  return outcome === 'pass' ? 'passed' : outcome === 'fail' ? 'failed' : 'error';
}

/**
 * Deterministic, dependency-free content hash of a scenario spec (stable across key
 * order). FNV-1a over the canonical JSON — enough to detect drift / dedupe versions.
 */
export function checksumSpec(spec: ScenarioSpec): string {
  const canonical = canonicalJson(spec);
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i += 1) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

/**
 * Order a queue for scheduling: highest priority first, then oldest-enqueued first
 * (FIFO within a priority). Pure — returns a new array.
 */
export function orderQueue(entries: readonly QueueEntry[]): QueueEntry[] {
  return [...entries].sort((a, b) => {
    const pr = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (pr !== 0) return pr;
    return a.enqueuedAt < b.enqueuedAt ? -1 : a.enqueuedAt > b.enqueuedAt ? 1 : 0;
  });
}

/** How many, and which, pending entries may start given the running count + concurrency. */
export function runnableEntries(
  pending: readonly QueueEntry[],
  runningCount: number,
  concurrency: number,
): QueueEntry[] {
  const slots = Math.max(0, concurrency - runningCount);
  return orderQueue(pending).slice(0, slots);
}

/** Compute the workspace dashboard rollup from the raw store data. Pure. */
export function composeSandboxDashboard(input: {
  workspaces: number;
  scenarios: number;
  executions: readonly Execution[];
  queue: { depth: number; running: number };
  artifacts: readonly { kind: ArtifactKind }[];
  recentLimit?: number;
  generatedAt: string;
}): SandboxDashboard {
  const byStatus: Record<string, number> = {};
  let passed = 0;
  let finished = 0;
  for (const e of input.executions) {
    byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;
    if (e.status === 'passed') {
      passed += 1;
      finished += 1;
    } else if (e.status === 'failed' || e.status === 'error' || e.status === 'timed_out') {
      finished += 1;
    }
  }
  const byKind: Record<string, number> = {};
  for (const a of input.artifacts) byKind[a.kind] = (byKind[a.kind] ?? 0) + 1;

  const recentRuns = [...input.executions]
    .sort((a, b) => (a.queuedAt < b.queuedAt ? 1 : a.queuedAt > b.queuedAt ? -1 : 0))
    .slice(0, input.recentLimit ?? 10);

  return {
    workspaces: input.workspaces,
    scenarios: input.scenarios,
    executions: { total: input.executions.length, byStatus },
    passRate: finished > 0 ? passed / finished : null,
    queue: input.queue,
    artifacts: { total: input.artifacts.length, byKind },
    recentRuns,
    generatedAt: input.generatedAt,
  };
}
