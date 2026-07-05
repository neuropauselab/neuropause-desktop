/**
 * ExecuteEngine (V5.4) — the main-side execution orchestrator.
 *
 * Owns execution sessions and history, dispatches each request to the subsystem
 * executor registered for its kind, tracks live state, and emits execution.*
 * platform events. It ORCHESTRATES existing subsystem logic (automation runner,
 * founder AI, …) through injected executors — it never duplicates that logic.
 */
import {
  computeExecutionStats,
  defaultExecutionLabel,
  planExecution,
  type ExecutionKind,
  type ExecutionRequest,
  type ExecutionSession,
  type ExecutionStats,
} from '@neuropause/shared';
import { createLogger } from './logger';

const log = createLogger('execute-engine');

/** A subsystem executor. `setStep` advances the visible step index; the return
 *  reports success + a compact summary or an error. */
export type ExecutionExecutor = (
  req: ExecutionRequest,
  ctx: { setStep: (index: number) => void },
) => Promise<{ ok: boolean; summary?: string; result?: unknown; error?: string }>;

export interface ExecuteEngineDeps {
  publish?: (input: {
    type: string;
    category: string;
    source: string;
    priority?: string;
    metadata?: Record<string, string | number | boolean | null>;
  }) => void;
  now?: () => number;
}

const MAX_HISTORY = 200;

export class ExecuteEngine {
  private readonly executors = new Map<ExecutionKind, ExecutionExecutor>();
  private readonly sessions = new Map<string, ExecutionSession>();
  private readonly history: ExecutionSession[] = [];
  private seq = 0;
  private readonly now: () => number;

  constructor(private readonly deps: ExecuteEngineDeps = {}) {
    this.now = deps.now ?? Date.now;
  }

  /** Register the executor for a kind. Subsystems compose in here. */
  register(kind: ExecutionKind, executor: ExecutionExecutor): void {
    this.executors.set(kind, executor);
    log.info('executor registered', { kind });
  }

  registeredKinds(): ExecutionKind[] {
    return [...this.executors.keys()];
  }

  /** Run a request through the pipeline: plan → dispatch → track → record. */
  async execute(req: ExecutionRequest): Promise<ExecutionSession> {
    const plan = planExecution(req);
    const id = `exec_${this.now()}_${this.seq++}`;
    const session: ExecutionSession = {
      id,
      kind: req.kind,
      label: plan.label,
      state: 'running',
      steps: plan.steps.map((s) => ({ ...s })),
      currentStep: 0,
      startedAt: new Date(this.now()).toISOString(),
      completedAt: null,
      durationMs: null,
      error: null,
      resultSummary: null,
      result: null,
    };
    if (session.steps[0]) session.steps[0].state = 'running';
    this.sessions.set(id, session);
    const startedMs = this.now();
    this.emit('execution.started', 'normal', { kind: req.kind, label: session.label, id });

    const setStep = (index: number): void => {
      if (session.state !== 'running') return;
      session.steps.forEach((s, i) => {
        if (i < index) s.state = 'completed';
        else if (i === index) s.state = 'running';
      });
      session.currentStep = Math.min(index, session.steps.length - 1);
    };

    try {
      const executor = this.executors.get(req.kind);
      if (!executor) {
        this.finish(session, startedMs, false, null, `No executor registered for '${req.kind}'`);
        return session;
      }
      const res = await executor(req, { setStep });
      this.finish(
        session,
        startedMs,
        res.ok,
        res.ok ? (res.summary ?? null) : null,
        res.ok ? null : (res.error ?? 'Execution failed'),
        res.ok ? (res.result ?? null) : null,
      );
    } catch (err) {
      this.finish(
        session,
        startedMs,
        false,
        null,
        err instanceof Error ? err.message : String(err),
      );
    }
    return session;
  }

  private finish(
    session: ExecutionSession,
    startedMs: number,
    ok: boolean,
    summary: string | null,
    error: string | null,
    result: unknown = null,
  ): void {
    session.state = ok ? 'completed' : 'failed';
    session.completedAt = new Date(this.now()).toISOString();
    session.durationMs = this.now() - startedMs;
    session.resultSummary = summary;
    session.result = result;
    session.error = error;
    session.steps.forEach((s) => {
      if (s.state === 'running' || s.state === 'queued') s.state = ok ? 'completed' : 'failed';
    });
    session.currentStep = -1;

    this.sessions.delete(session.id);
    this.history.unshift({ ...session, steps: session.steps.map((s) => ({ ...s })) });
    if (this.history.length > MAX_HISTORY) this.history.length = MAX_HISTORY;

    this.emit(ok ? 'execution.completed' : 'execution.failed', ok ? 'normal' : 'high', {
      kind: session.kind,
      label: session.label,
      id: session.id,
      durationMs: session.durationMs,
      ok,
    });
    log.info('execution finished', { kind: session.kind, ok, durationMs: session.durationMs });
  }

  activeSessions(): ExecutionSession[] {
    return [...this.sessions.values()];
  }

  getHistory(): ExecutionSession[] {
    return [...this.history];
  }

  stats(): ExecutionStats {
    return computeExecutionStats(this.activeSessions(), this.history);
  }

  /** Cancel a live session (best-effort — marks state; executors are cooperative). */
  cancel(id: string): ExecutionSession | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    session.state = 'cancelled';
    session.completedAt = new Date(this.now()).toISOString();
    session.currentStep = -1;
    this.sessions.delete(id);
    this.history.unshift({ ...session });
    if (this.history.length > MAX_HISTORY) this.history.length = MAX_HISTORY;
    this.emit('execution.cancelled', 'normal', { kind: session.kind, id, label: session.label });
    return session;
  }

  private emit(
    type: string,
    priority: string,
    metadata: Record<string, string | number | boolean | null>,
  ): void {
    // Label helps the timeline; ensure a value even when only a target id is set.
    if (!metadata.label && 'kind' in metadata) {
      metadata.label = defaultExecutionLabel({ kind: metadata.kind as ExecutionKind });
    }
    this.deps.publish?.({
      type,
      category: 'runtime',
      source: 'execute-engine',
      priority,
      metadata,
    });
  }
}
