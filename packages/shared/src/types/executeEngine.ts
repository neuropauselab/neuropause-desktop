/**
 * Execute Engine core (V5.4).
 *
 * The unified execution model: every executable object in NeuroPause (task, worker,
 * automation, decision, workflow, memory query, connector action, voice, runtime,
 * executive command) is described by one ExecutionRequest and runs as one
 * ExecutionSession through one pipeline. This file is the PURE, unit-tested core:
 * the planner (request → plan) and the session state machine. The engine that owns
 * sessions, dispatches to subsystems, and emits events lives in main — it
 * orchestrates existing subsystem logic and never duplicates it.
 */

/** Every kind of thing the engine can execute. Future plugins extend this. */
export type ExecutionKind =
  | 'task'
  | 'worker'
  | 'automation'
  | 'decision'
  | 'workflow'
  | 'memory'
  | 'connector'
  | 'voice'
  | 'runtime'
  | 'executive';

/** Lifecycle state of a session or step. */
export type ExecutionState =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

/** A request to execute something. Uniform across all subsystems. */
export interface ExecutionRequest {
  kind: ExecutionKind;
  /** Target object id for kinds that act on a specific thing (automation/worker/decision id). */
  targetId?: string;
  /** Free-form input (task text, connector action payload, voice transcript, …). */
  input?: string;
  /** Human-readable label; derived from the request when omitted. */
  label?: string;
  /**
   * P8.3 — structured params for kinds that carry more than free-form text (e.g. an
   * approved worker action's execution binding). IN-PROCESS ONLY — the public
   * `ExecuteRun` IPC schema does not accept this, so a renderer cannot supply it.
   */
  params?: Record<string, unknown>;
  /**
   * P8.3 — human-confirmation flag forwarded to the confirmation-gated executors.
   * IN-PROCESS ONLY (never on the public IPC schema); set true solely by the trusted
   * dispatcher after a human approval, so mutating executors still require confirmation.
   */
  confirmed?: boolean;
  /** P8.3 — groups this execution's events into a larger chain (the originating job/goal id). */
  correlationId?: string;
}

export interface ExecutionStep {
  id: string;
  label: string;
  state: ExecutionState;
}

/** The resolved plan for a request — pure output of the planner. */
export interface ExecutionPlan {
  kind: ExecutionKind;
  label: string;
  steps: ExecutionStep[];
}

/** A live (or historical) execution. */
export interface ExecutionSession {
  /**
   * The organization this belongs to (P13C Round 2).
   *
   * OPTIONAL so a file written before this round still parses. Absent means
   * UNRESOLVED — visible to nobody, never back-filled to the active or first
   * organization, because that guess is the defect the field exists to remove.
   */
  tenantId?: string | null;
  id: string;
  kind: ExecutionKind;
  label: string;
  state: ExecutionState;
  steps: ExecutionStep[];
  /** Index of the currently-running step, or -1. */
  currentStep: number;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  error: string | null;
  /** Compact result summary for the dashboard. */
  resultSummary: string | null;
  /** Full structured output preserved for the API (V5.6). Dashboard uses summary. */
  result: unknown | null;
  /** P8.3 — the chain id this session belongs to (the originating job/goal id), or null. */
  correlationId?: string | null;
}

/** Aggregate stats for the Execute dashboard. */
export interface ExecutionStats {
  active: number;
  queued: number;
  completed: number;
  failed: number;
  cancelled: number;
  successRate: number | null;
  averageRuntimeMs: number | null;
}

const TERMINAL: ExecutionState[] = ['completed', 'failed', 'cancelled', 'interrupted'];

/** Whether a state is terminal (no further transitions). Pure. */
export function isTerminalState(state: ExecutionState): boolean {
  return TERMINAL.includes(state);
}

/**
 * Mark any non-terminal session as interrupted — used at startup to recover
 * sessions that were in-flight when the app stopped. Interrupted sessions are NOT
 * rerun; they're recorded as recovered. Pure.
 */
export function recoverInterrupted(
  sessions: ExecutionSession[],
  nowIso: string,
): ExecutionSession[] {
  return sessions.map((s) =>
    isTerminalState(s.state)
      ? s
      : {
          ...s,
          state: 'interrupted' as ExecutionState,
          completedAt: s.completedAt ?? nowIso,
          error: s.error ?? 'Interrupted by application restart',
          currentStep: -1,
        },
  );
}

/** Per-kind step templates — meaningful stages, not fake progress. Pure. */
function stepsForKind(kind: ExecutionKind): string[] {
  switch (kind) {
    case 'task':
      return ['Resolve intent', 'Run AI', 'Summarize'];
    case 'automation':
      return ['Match rule', 'Execute actions', 'Record run'];
    case 'worker':
      return ['Assign job', 'Run worker', 'Collect result'];
    case 'decision':
      return ['Validate', 'Apply decision', 'Record'];
    case 'workflow':
      return ['Plan steps', 'Run steps', 'Finalize'];
    case 'memory':
      return ['Parse query', 'Search memory'];
    case 'connector':
      return ['Authorize', 'Call connector', 'Record'];
    case 'voice':
      return ['Transcribe intent', 'Dispatch', 'Respond'];
    case 'runtime':
      return ['Prepare', 'Execute command'];
    case 'executive':
      return ['Compose', 'Deliver'];
    default:
      return ['Prepare', 'Execute', 'Record'];
  }
}

/** A default human label for a request. Pure. */
export function defaultExecutionLabel(req: ExecutionRequest): string {
  if (req.label && req.label.trim()) return req.label.trim();
  const noun: Record<ExecutionKind, string> = {
    task: 'Task',
    worker: 'Worker',
    automation: 'Automation',
    decision: 'Decision',
    workflow: 'Workflow',
    memory: 'Memory query',
    connector: 'Connector action',
    voice: 'Voice command',
    runtime: 'Runtime command',
    executive: 'Executive command',
  };
  const base = noun[req.kind] ?? 'Execution';
  if (req.input && req.input.trim()) {
    const t = req.input.trim();
    return `${base}: ${t.length > 60 ? `${t.slice(0, 57)}…` : t}`;
  }
  if (req.targetId) return `${base} ${req.targetId}`;
  return base;
}

/** Resolve a request into an execution plan (PURE — orchestration only). */
export function planExecution(req: ExecutionRequest): ExecutionPlan {
  const labels = stepsForKind(req.kind);
  const steps: ExecutionStep[] = labels.map((label, i) => ({
    id: `step_${i}`,
    label,
    state: 'queued',
  }));
  return { kind: req.kind, label: defaultExecutionLabel(req), steps };
}

/** Compute dashboard stats from live + historical sessions. Pure. */
export function computeExecutionStats(
  active: ExecutionSession[],
  history: ExecutionSession[],
): ExecutionStats {
  const completed = history.filter((s) => s.state === 'completed').length;
  const failed = history.filter((s) => s.state === 'failed').length;
  const cancelled = history.filter((s) => s.state === 'cancelled').length;
  const finishedWithOutcome = completed + failed;
  const durations = history.filter((s) => s.durationMs !== null).map((s) => s.durationMs as number);
  return {
    active: active.filter((s) => s.state === 'running' || s.state === 'waiting').length,
    queued: active.filter((s) => s.state === 'queued').length,
    completed,
    failed,
    cancelled,
    successRate:
      finishedWithOutcome > 0 ? Math.round((completed / finishedWithOutcome) * 100) : null,
    averageRuntimeMs:
      durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : null,
  };
}
