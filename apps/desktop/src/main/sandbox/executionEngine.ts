/**
 * AI Sandbox — Execution engine (S1). The orchestrator that turns a queued scenario
 * run into a completed one: it dequeues by priority + per-workspace concurrency, runs
 * a REGISTERED executor (there is none in S1 — no AI, no Playwright, no desktop
 * automation), and drives the whole lifecycle around it — status transitions, the
 * per-execution timeline, artifact capture, the result, the generated report, run
 * history, and a live change broadcast. It is the sandbox analog of the existing
 * ExecuteEngine: it ORCHESTRATES an injected executor and never captures anything
 * itself, so every later stage plugs in by registering an executor.
 */
import { randomUUID } from 'node:crypto';
import {
  runnableEntries,
  statusFromOutcome,
  type Artifact,
  type ArtifactKind,
  type Dataset,
  type Execution,
  type ExecutionPriority,
  type ExecutionQueueState,
  type ExecutionTrigger,
  type LogLevel,
  type QueueEntry,
  type RunAssertions,
  type RunOutcome,
  type RunResult,
  type SandboxEvent,
  type Scenario,
  type ScenarioVersion,
} from '@neuropause/shared';
import { createLogger } from '../logger';
import { runAsPrincipal, tenantPrincipal } from '../tenancy/backgroundPrincipal';
import { generateReport } from './reportGenerator';
import type { SandboxWorkspaceStore } from './workspaceStore';
import type { SandboxScenarioStore } from './scenarioStore';
import type { SandboxExecutionStore } from './executionStore';
import type { SandboxArtifactStore } from './artifactStore';
import type { SandboxDatasetStore } from './datasetStore';

const log = createLogger('sandbox-engine');

/** What a registered executor receives — read the scenario/version/dataset, log to the
 *  timeline, mark steps, and attach artifacts. It performs NO capture itself. */
export interface SandboxRunContext {
  execution: Execution;
  scenario: Scenario;
  version: ScenarioVersion;
  dataset: Dataset | null;
  /** Cooperative cancellation flag — long executors should check it. */
  signal: { readonly cancelled: boolean };
  log: (message: string, level?: LogLevel) => void;
  step: (name: string) => void;
  attachArtifact: (input: {
    kind: ArtifactKind;
    name: string;
    mimeType?: string;
    sizeBytes?: number;
    storageRef?: string | null;
    inline?: string | null;
    metadata?: Record<string, string | number | boolean | null>;
  }) => Artifact;
}

export interface SandboxRunOutcome {
  outcome: RunOutcome;
  summary?: string;
  assertions?: RunAssertions;
  metrics?: Record<string, number>;
}

export type SandboxExecutor = (ctx: SandboxRunContext) => Promise<SandboxRunOutcome>;

export interface SandboxEngineDeps {
  workspaces: SandboxWorkspaceStore;
  scenarios: SandboxScenarioStore;
  executions: SandboxExecutionStore;
  artifacts: SandboxArtifactStore;
  datasets: SandboxDatasetStore;
  /** Renderer live-refresh signal. */
  broadcast?: (event: SandboxEvent) => void;
  now?: () => number;
}

export interface EnqueueInput {
  scenarioId: string;
  version?: number;
  trigger?: ExecutionTrigger;
  priority?: ExecutionPriority;
  datasetId?: string;
}

export class SandboxExecutionEngine {
  private executor: SandboxExecutor | null = null;
  private readonly running = new Set<string>();
  private readonly cancelSignals = new Map<string, { cancelled: boolean }>();
  private readonly datasetByExecution = new Map<string, string>();
  private readonly now: () => number;

  constructor(private readonly deps: SandboxEngineDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** A later stage registers the real executor here (Playwright / AI / desktop / …). */
  registerExecutor(executor: SandboxExecutor): void {
    this.executor = executor;
    log.info('sandbox executor registered');
  }
  hasExecutor(): boolean {
    return this.executor !== null;
  }

  /** Queue a scenario version for execution. Pins the latest version when none is given. */
  enqueue(input: EnqueueInput): Execution {
    const scenario = this.deps.scenarios.get(input.scenarioId);
    if (!scenario) throw new Error('Invalid request: scenario not found');
    const version = input.version
      ? this.deps.scenarios.getVersion(scenario.id, input.version)
      : this.deps.scenarios.latestVersion(scenario.id);
    if (!version) throw new Error('Invalid request: scenario has no version to run');

    const execution = this.deps.executions.create({
      workspaceId: scenario.workspaceId,
      scenarioId: scenario.id,
      scenarioVersion: version.version,
      trigger: input.trigger ?? 'manual',
      priority: input.priority ?? 'normal',
    });
    /**
     * P13C N3 — A DATASET MUST BE THE CALLER'S TO ATTACH.
     *
     * `datasetId` arrives in the payload and was pinned to the execution
     * unvalidated, so tenant B could attach tenant A's dataset to a B scenario
     * and read A's fixture rows through the run. `datasets.get` is scoped, so
     * resolving it here turns a supplied id into an owned one — and a foreign
     * id is refused rather than silently ignored, because silently dropping it
     * would run the scenario against no data and look like a product bug.
     */
    if (input.datasetId) {
      if (this.deps.datasets.get(input.datasetId) === null) {
        throw new Error('Invalid request: dataset not found');
      }
      this.datasetByExecution.set(execution.id, input.datasetId);
    }
    this.emit('queued', execution);
    this.pump();
    return execution;
  }

  queueState(workspaceId?: string): ExecutionQueueState {
    const pending: QueueEntry[] = this.deps.executions
      .all()
      .filter((e) => e.status === 'queued' && (workspaceId ? e.workspaceId === workspaceId : true))
      .map((e) => ({ executionId: e.id, scenarioId: e.scenarioId, priority: e.priority, enqueuedAt: e.queuedAt }));
    const running = [...this.running].filter((id) =>
      workspaceId ? this.deps.executions.get(id)?.workspaceId === workspaceId : true,
    );
    const concurrency = workspaceId
      ? this.deps.workspaces.get(workspaceId)?.settings.maxConcurrency ?? 0
      : this.deps.workspaces.list().reduce((sum, w) => sum + w.settings.maxConcurrency, 0);
    return { pending, running, depth: pending.length, concurrency };
  }

  /** Cancel a run: a queued run cancels immediately; a running run is asked to stop cooperatively. */
  cancel(id: string): Execution | null {
    const e = this.deps.executions.get(id);
    if (!e) return null;
    if (e.status === 'queued') {
      const cancelled = this.deps.executions.transition(id, 'cancelled');
      if (cancelled) {
        this.deps.executions.appendTimeline(id, 'cancelled', 'warn', 'Execution cancelled before start');
        this.emit('cancelled', cancelled);
      }
      return cancelled;
    }
    const signal = this.cancelSignals.get(id);
    if (signal) signal.cancelled = true;
    return this.deps.executions.get(id);
  }

  /**
   * Start every currently-runnable execution, respecting per-workspace concurrency.
   *
   * P13C N3 — THE QUEUE IS SHARED; THE EXECUTION CONTEXT IS NOT.
   *
   * `pump` is re-entered by whoever enqueues and by every run that finishes, so
   * it must be able to SEE the whole queue — otherwise tenant B's runs would sit
   * queued until tenant B happened to act, which is a stall dressed up as
   * isolation. It therefore reads `allForEngine()` deliberately.
   *
   * What was wrong before is not that it saw everything: it is that it then RAN
   * everything in the enqueuer's context. Tenant A calling enqueue started
   * tenant B's queued executions inside A's IPC call stack, and every store
   * those runs touched — memory, timeline, artifacts — resolved through A's
   * session. Each run now executes under a principal built from its OWN
   * execution row, which is the same rule Part 2a gave webhook deliveries.
   */
  private pump(): void {
    const queued = this.deps.executions.allForEngine().filter((e) => e.status === 'queued');
    const byWorkspace = new Map<string, Execution[]>();
    for (const e of queued) {
      const list = byWorkspace.get(e.workspaceId) ?? [];
      list.push(e);
      byWorkspace.set(e.workspaceId, list);
    }
    for (const [workspaceId, execs] of byWorkspace) {
      // Unscoped reads: scheduling decisions about a workspace this pump is not
      // "in". Neither value reaches a caller.
      const concurrency =
        this.deps.workspaces.unscopedForEngine(workspaceId)?.settings.maxConcurrency ?? 1;
      const runningInWs = [...this.running].filter(
        (id) => this.deps.executions.unscopedForEngine(id)?.workspaceId === workspaceId,
      ).length;
      const slots = concurrency - runningInWs;
      if (slots <= 0) continue;
      const entries: QueueEntry[] = execs.map((e) => ({ executionId: e.id, scenarioId: e.scenarioId, priority: e.priority, enqueuedAt: e.queuedAt }));
      for (const entry of runnableEntries(entries, 0, slots)) {
        if (this.running.has(entry.executionId)) continue;
        this.running.add(entry.executionId);
        void this.runOwned(entry.executionId).finally(() => {
          this.running.delete(entry.executionId);
          this.cancelSignals.delete(entry.executionId);
          this.datasetByExecution.delete(entry.executionId);
          this.pump();
        });
      }
    }
  }

  /**
   * Run `id` under the principal of the execution's OWN tenant.
   *
   * The principal is built from the stored row, not from anything ambient, so a
   * run started while tenant A was on screen still executes as the tenant that
   * enqueued it — and every scoped store it reaches answers for that tenant
   * without any of them changing.
   *
   * AN UNOWNED EXECUTION IS NOT RUN. Rows written before P13C carry no tenant;
   * executing one would mean choosing an organization for work that named none,
   * and it would then write artifacts under that choice. It is failed instead,
   * which is visible, rather than skipped, which is not.
   */
  private async runOwned(id: string): Promise<void> {
    const row = this.deps.executions.unscopedForEngine(id);
    if (!row) return;
    const principal = row.tenantId
      ? tenantPrincipal({ jobId: 'sandbox-execution', scope: { tenantId: row.tenantId, workspaceId: '' } })
      : null;
    if (principal === null) {
      this.deps.executions.transition(id, 'error', {
        error: 'This run predates tenant ownership and has no owner.',
      });
      return;
    }
    await runAsPrincipal(principal, () => this.run(id));
  }

  private async run(id: string): Promise<void> {
    const queuedExec = this.deps.executions.get(id);
    if (!queuedExec || queuedExec.status !== 'queued') return;

    const scenario = this.deps.scenarios.get(queuedExec.scenarioId);
    const version = scenario ? this.deps.scenarios.getVersion(scenario.id, queuedExec.scenarioVersion) : null;

    const started = this.deps.executions.transition(id, 'running');
    if (!started) return;
    this.deps.executions.appendTimeline(id, 'started', 'info', 'Execution started');
    this.emit('started', started);

    if (!scenario || !version) {
      this.finishTerminal(id, 'error', 'Scenario or version not found', scenario);
      return;
    }
    if (!this.executor) {
      this.finishTerminal(id, 'error', 'No sandbox executor registered', scenario);
      return;
    }

    const signal = { cancelled: false };
    this.cancelSignals.set(id, signal);
    const datasetId = this.datasetByExecution.get(id);
    const dataset = datasetId ? this.deps.datasets.get(datasetId) : null;

    const ctx: SandboxRunContext = {
      execution: started,
      scenario,
      version,
      dataset,
      signal: { get cancelled() { return signal.cancelled; } },
      log: (message, level = 'info') => void this.deps.executions.appendTimeline(id, 'log', level, message),
      step: (name) => void this.deps.executions.appendTimeline(id, 'step', 'info', name),
      attachArtifact: (input) => {
        const artifact = this.deps.artifacts.add({ ...input, executionId: id, workspaceId: started.workspaceId });
        this.deps.executions.appendTimeline(id, 'artifact', 'info', `Artifact: ${input.name}`, { kind: input.kind });
        this.emit('artifact', started);
        return artifact;
      },
    };

    let outcome: SandboxRunOutcome;
    try {
      outcome = await this.executor(ctx);
    } catch (err) {
      this.finishTerminal(id, 'error', err instanceof Error ? err.message : String(err), scenario);
      return;
    }

    if (signal.cancelled) {
      this.finishTerminal(id, 'cancelled', null, scenario);
      return;
    }
    const status = statusFromOutcome(outcome.outcome);
    this.finishTerminal(id, status, outcome.outcome === 'error' ? (outcome.summary ?? 'Execution error') : null, scenario, outcome);
  }

  /** Transition to a terminal status and produce the result + report + history + event. */
  private finishTerminal(
    id: string,
    status: 'passed' | 'failed' | 'error' | 'cancelled' | 'timed_out',
    error: string | null,
    scenario: Scenario | null,
    outcome?: SandboxRunOutcome,
  ): void {
    const finished = this.deps.executions.transition(id, status, { error });
    if (!finished || !scenario) return;

    let result: RunResult | null = null;
    if (outcome) {
      const steps = this.deps.executions.timelineFor(id).filter((t) => t.phase === 'step').length;
      result = {
        id: `sbrr_${randomUUID()}`,
        executionId: id,
        outcome: outcome.outcome,
        summary: outcome.summary ?? defaultSummary(outcome.outcome, scenario.name),
        assertions: outcome.assertions ?? { total: 0, passed: 0, failed: 0 },
        metrics: { durationMs: finished.durationMs ?? 0, steps, ...(outcome.metrics ?? {}) },
        createdAt: new Date(this.now()).toISOString(),
      };
      this.deps.artifacts.addResult(finished.workspaceId, result);
      this.deps.executions.setResultRef(id, result.id);
      this.deps.executions.appendTimeline(id, 'result', 'info', `Result: ${result.outcome}`);
    }

    const report = generateReport({
      execution: finished,
      scenario,
      result,
      artifacts: this.deps.artifacts.list(id),
      timeline: this.deps.executions.timelineFor(id),
      now: this.now,
    });
    this.deps.artifacts.addReport(report);
    this.deps.executions.setReportRef(id, report.id);
    this.deps.executions.appendTimeline(id, 'report', 'info', 'Report generated');
    this.deps.executions.appendTimeline(id, status, status === 'passed' ? 'info' : 'warn', `Execution ${status}`, error ? { error } : {});
    this.emit(status, finished);
    log.info('sandbox execution finished', { id, status, durationMs: finished.durationMs });
  }

  private emit(kind: SandboxEvent['kind'], execution: Execution): void {
    this.deps.broadcast?.({
      kind,
      // P13C N3 — from the execution ROW, so the event names the tenant whose
      // run it describes rather than whoever is on screen when it fires.
      tenantId: execution.tenantId ?? null,
      executionId: execution.id,
      workspaceId: execution.workspaceId,
      scenarioId: execution.scenarioId,
      status: execution.status,
      at: new Date(this.now()).toISOString(),
    });
  }
}

function defaultSummary(outcome: RunOutcome, scenarioName: string): string {
  return outcome === 'pass'
    ? `${scenarioName} passed.`
    : outcome === 'fail'
      ? `${scenarioName} failed.`
      : `${scenarioName} errored.`;
}
