/**
 * AI Sandbox — Execution store (S1): the execution registry, the run-status state
 * machine, the per-execution timeline, and run-history queries. Status changes go
 * through `canTransitionExecution` so the lifecycle can never move illegally (e.g.
 * a terminal run never re-opens). The timeline is a bounded, append-only log per
 * execution. Electron-free.
 */
import { randomUUID } from 'node:crypto';
import {
  canTransitionExecution,
  isTerminalExecutionStatus,
  type Execution,
  type ExecutionPriority,
  type ExecutionStatus,
  type ExecutionTimelineEntry,
  type ExecutionTrigger,
  type LogLevel,
  type RunHistoryPage,
  type RunHistoryQuery,
  type TimelinePhase,
} from '@neuropause/shared';
import { PersistentStore } from './persistentStore';

interface ExecutionFile {
  executions: Execution[];
  timeline: ExecutionTimelineEntry[];
}

export interface ExecutionCreateInput {
  workspaceId: string;
  scenarioId: string;
  scenarioVersion: number;
  trigger: ExecutionTrigger;
  priority: ExecutionPriority;
}

const MAX_EXECUTIONS = 5000;
const MAX_TIMELINE_PER_EXECUTION = 1000;

export class SandboxExecutionStore extends PersistentStore<ExecutionFile> {
  private executions = new Map<string, Execution>();
  private timeline = new Map<string, ExecutionTimelineEntry[]>();

  constructor(filePath: string, private readonly now: () => number = Date.now) {
    super(filePath, 'sandbox-executions');
  }

  protected snapshot(): ExecutionFile {
    return { executions: [...this.executions.values()], timeline: [...this.timeline.values()].flat() };
  }
  protected hydrate(data: Partial<ExecutionFile>): void {
    for (const e of data.executions ?? []) if (e?.id) this.executions.set(e.id, e);
    for (const t of data.timeline ?? []) {
      if (!t?.executionId) continue;
      const list = this.timeline.get(t.executionId) ?? [];
      list.push(t);
      this.timeline.set(t.executionId, list);
    }
  }

  create(input: ExecutionCreateInput): Execution {
    const iso = new Date(this.now()).toISOString();
    const execution: Execution = {
      id: `sbe_${randomUUID()}`,
      // P13C N3 — the run's owner, stamped once at creation and never
      // re-resolved: an execution that outlives a tenant switch is still the
      // enqueuing tenant's.
      tenantId: this.requireTenant(),
      workspaceId: input.workspaceId,
      scenarioId: input.scenarioId,
      scenarioVersion: input.scenarioVersion,
      status: 'queued',
      trigger: input.trigger,
      priority: input.priority,
      queuedAt: iso,
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      attempt: 1,
      resultId: null,
      reportId: null,
      error: null,
    };
    this.executions.set(execution.id, execution);
    this.prune();
    this.appendTimeline(execution.id, 'queued', 'info', 'Execution queued');
    this.changed();
    return execution;
  }

  /** The execution, IF it is the caller's. */
  get(id: string): Execution | null {
    const e = this.executions.get(id) ?? null;
    return e !== null && this.mine(e) ? e : null;
  }

  /** Unscoped, for the ENGINE's queue drain only. Never answers a request. */
  unscopedForEngine(id: string): Execution | null {
    return this.executions.get(id) ?? null;
  }
  /** Every execution, for the ENGINE's pump. Each run then uses its own principal. */
  allForEngine(): Execution[] {
    return [...this.executions.values()];
  }

  /** Unscoped ownership counts, for the migration inventory only. */
  ownershipCounts(): { total: number; assigned: number; unresolved: number } {
    return this.countOwnership([...this.executions.values()]);
  }
  /** The caller's executions. Was every execution on the install. */
  all(): Execution[] {
    return this.onlyMine([...this.executions.values()]);
  }
  count(): number {
    return this.all().length;
  }

  /**
   * Move an execution to a new status if the transition is legal. Stamps startedAt
   * on `running` and finishedAt + durationMs on any terminal status. Returns null if
   * the execution is unknown or the transition is illegal.
   */
  transition(id: string, to: ExecutionStatus, opts: { error?: string | null } = {}): Execution | null {
    /**
     * Unscoped BY DESIGN, and safe because of where it is called from.
     *
     * The engine drives every transition while running inside that execution's
     * OWN background principal, so the scoped accessor would be correct but
     * redundant. What protects the interactive path is `cancel`, which resolves
     * the id through the scoped `get` before asking the engine to act — so a
     * caller cannot reach this with a foreign id.
     */
    const e = this.executions.get(id);
    if (!e || !canTransitionExecution(e.status, to)) return null;
    const nowMs = this.now();
    const iso = new Date(nowMs).toISOString();
    const startedAt = to === 'running' ? iso : e.startedAt;
    let finishedAt = e.finishedAt;
    let durationMs = e.durationMs;
    if (isTerminalExecutionStatus(to)) {
      finishedAt = iso;
      durationMs = e.startedAt ? Math.max(0, nowMs - Date.parse(e.startedAt)) : 0;
    }
    const next: Execution = { ...e, status: to, startedAt, finishedAt, durationMs, error: opts.error ?? e.error };
    this.executions.set(id, next);
    this.changed();
    return next;
  }

  setResultRef(id: string, resultId: string): Execution | null {
    return this.patch(id, { resultId });
  }
  setReportRef(id: string, reportId: string): Execution | null {
    return this.patch(id, { reportId });
  }
  private patch(id: string, patch: Partial<Execution>): Execution | null {
    const e = this.executions.get(id);
    if (!e) return null;
    const next = { ...e, ...patch };
    this.executions.set(id, next);
    this.changed();
    return next;
  }

  /* ── timeline ── */

  appendTimeline(
    executionId: string,
    phase: TimelinePhase,
    level: LogLevel,
    message: string,
    data: Record<string, string | number | boolean | null> = {},
  ): ExecutionTimelineEntry {
    const entry: ExecutionTimelineEntry = {
      id: `sbt_${randomUUID()}`,
      executionId,
      at: new Date(this.now()).toISOString(),
      phase,
      level,
      message,
      data,
    };
    const list = this.timeline.get(executionId) ?? [];
    list.push(entry);
    if (list.length > MAX_TIMELINE_PER_EXECUTION) list.splice(0, list.length - MAX_TIMELINE_PER_EXECUTION);
    this.timeline.set(executionId, list);
    this.changed();
    return entry;
  }

  /**
   * An execution's timeline — gated on the EXECUTION.
   *
   * Log messages carry business data (the step, the assertion, the record the
   * scenario touched), so this is a content read. Gating on the parent means
   * one check, and it cannot disagree with `get`.
   */
  timelineFor(executionId: string, limit?: number): ExecutionTimelineEntry[] {
    if (this.get(executionId) === null) return [];
    const list = this.timeline.get(executionId) ?? [];
    return limit ? list.slice(-limit) : [...list];
  }

  /* ── run history ── */

  /**
   * Run history. AN OMITTED `workspaceId` NO LONGER WIDENS.
   *
   * It used to mean "every workspace on the install", so omitting the field was
   * the bypass — and `total` returned an install-wide count even when the page
   * itself was narrowed. The tenant filter is applied first and cannot be
   * turned off by any query field.
   */
  history(query: RunHistoryQuery = {}): RunHistoryPage {
    const all = this.onlyMine([...this.executions.values()])
      .filter((e) => (query.workspaceId ? e.workspaceId === query.workspaceId : true))
      .filter((e) => (query.scenarioId ? e.scenarioId === query.scenarioId : true))
      .filter((e) => (query.status ? e.status === query.status : true))
      .sort((a, b) => (a.queuedAt < b.queuedAt ? 1 : a.queuedAt > b.queuedAt ? -1 : 0));
    const total = all.length;
    const offset = Math.max(0, Number.parseInt(query.cursor ?? '', 10) || 0);
    const limit = Math.min(200, Math.max(1, query.limit ?? 50));
    const executions = all.slice(offset, offset + limit);
    const nextCursor = offset + limit < total ? String(offset + limit) : null;
    return { executions, nextCursor, total };
  }

  /**
   * Cap total executions, dropping the oldest terminal runs first.
   *
   * KNOWN LIMITATION, stated rather than hidden: the cap is INSTALL-WIDE, so a
   * noisy tenant can still evict another tenant's history. That is a retention
   * fairness problem rather than a disclosure — evicted rows are gone, not
   * shown to anyone — and fixing it properly means a per-tenant budget, which
   * is a capacity design and not this program's boundary work. Recorded in the
   * migration inventory.
   */
  private prune(): void {
    if (this.executions.size <= MAX_EXECUTIONS) return;
    const ordered = [...this.executions.values()].sort((a, b) => {
      const ta = isTerminalExecutionStatus(a.status) ? 0 : 1;
      const tb = isTerminalExecutionStatus(b.status) ? 0 : 1;
      if (ta !== tb) return ta - tb;
      return a.queuedAt < b.queuedAt ? -1 : a.queuedAt > b.queuedAt ? 1 : 0;
    });
    let over = this.executions.size - MAX_EXECUTIONS;
    for (const e of ordered) {
      if (over <= 0) break;
      this.executions.delete(e.id);
      this.timeline.delete(e.id);
      over -= 1;
    }
  }
}
