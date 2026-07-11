/**
 * AI Sandbox — Continuous Validation Platform (S6) composition root.
 *
 * Wires the orchestrator from REUSED capabilities: the S1–S5 executors (stage dispatch),
 * the S5 benchmark store (regression), the existing scheduler / notifications / memory /
 * diagnostics (all injected), and a run store on the S1 persistence substrate. Exposes a
 * read-only `sandbox:read` channel the Developer Portal consumes. This completes AI Sandbox
 * v1.0. No new engine/scheduler/dashboard/report/memory/security.
 */
import { EmptyRequest, IpcChannel, type PipelineKind, type TriggerKind, type ValidationDashboard, type ValidationPipeline, type ValidationSummary } from '@neuropause/shared';
import { createLogger } from '../../logger';
import type { SecureHandlerDef } from '../../ipc/secureBridge';
import { PIPELINE_LIST } from './pipelines';
import { ValidationScheduler, defaultSchedules } from './scheduler';
import { ValidationRunStore } from './runStore';
import { runValidationPipeline, validationDashboard, validationSummary, type ValidationRunOutput } from './platform';
import type { HistoryPort, NotifierPort, ObserverPort, SchedulerPort, StageExecutors, ValidationDeps } from './ports';
import type { BenchmarkStore } from '../lab/benchmarkStore';

const log = createLogger('sandbox-continuous-validation');

export interface ContinuousValidationDeps {
  executors: StageExecutors;
  /** The SAME S5 benchmark store — reused for regression, never duplicated. */
  benchmarks: BenchmarkStore;
  scheduler?: SchedulerPort;
  notifier?: NotifierPort;
  history?: HistoryPort;
  observers?: ObserverPort;
  runsPath: string;
  version?: string;
  now?: () => number;
  clock?: () => Date;
  /** Enable the nightly/weekly auto-schedules. SAFE DEFAULT: false — validation runs mutate
   *  real platform data, so scheduled runs are opt-in (point them at a sandbox tenant first). */
  enableSchedules?: boolean;
}

export interface ContinuousValidationSubsystem {
  handlers: SecureHandlerDef[];
  run: (pipeline: PipelineKind, trigger?: TriggerKind) => Promise<ValidationRunOutput>;
  scheduler: ValidationScheduler;
  runStore: ValidationRunStore;
  summary: () => ValidationSummary;
  dashboard: () => ValidationDashboard;
  pipelines: ValidationPipeline[];
}

export async function initContinuousValidation(deps: ContinuousValidationDeps): Promise<ContinuousValidationSubsystem> {
  const now = deps.now ?? Date.now;
  const version = deps.version ?? '1.0.0';
  const runStore = new ValidationRunStore(deps.runsPath);
  await runStore.load();

  const runDeps: ValidationDeps & { version: string } = {
    executors: deps.executors,
    benchmarks: deps.benchmarks,
    scheduler: deps.scheduler,
    notifier: deps.notifier,
    history: deps.history,
    observers: deps.observers,
    now,
    version,
  };

  let current: { runId: string; pipeline: PipelineKind; status: 'running' } | null = null;
  const scheduler = new ValidationScheduler({
    scheduler: deps.scheduler,
    runPipeline: async (p, t) => (await runValidationPipeline(p, t, runDeps, runStore)).run,
    now,
    clock: deps.clock,
  });

  const run = async (pipeline: PipelineKind, trigger: TriggerKind = 'manual'): Promise<ValidationRunOutput> => {
    current = { runId: 'pending', pipeline, status: 'running' };
    try {
      return await runValidationPipeline(pipeline, trigger, runDeps, runStore);
    } finally {
      current = null;
    }
  };

  // Register the default schedule set (nightly regression, weekly certification) on the
  // EXISTING scheduler via the injected port — no new scheduler. Disabled by default so the
  // platform never auto-mutates real data without explicit operator opt-in (Safety).
  for (const s of defaultSchedules()) {
    const entry = scheduler.register(s.pipeline, s.cadence, s.trigger);
    if (!deps.enableSchedules) scheduler.setEnabled(entry.id, false);
  }
  scheduler.ensureTick();

  const handlers: SecureHandlerDef[] = [
    {
      channel: IpcChannel.SandboxValidationSummary,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'sandbox:read',
      handler: () => validationSummary(runStore, scheduler, now),
    },
  ];

  log.info('continuous validation platform initialized', { pipelines: PIPELINE_LIST.length, scheduled: scheduler.list().length });
  return {
    handlers,
    run,
    scheduler,
    runStore,
    summary: () => validationSummary(runStore, scheduler, now),
    dashboard: () => validationDashboard(runStore, scheduler, current, 0, now),
    pipelines: PIPELINE_LIST,
  };
}

export { runValidationPipeline, validationSummary, validationDashboard } from './platform';
export { ValidationScheduler, defaultSchedules } from './scheduler';
export { ValidationRunStore } from './runStore';
export { PIPELINES, PIPELINE_LIST, getPipeline } from './pipelines';
export { buildCertification, certificationToHtml, certificationToJson, certificationToMarkdown } from './certification';
export { composeValidationDashboard } from './dashboard';
export { analyzeRegression } from './regression';
export { notificationsFor } from './notifications';
export type { ValidationRunOutput } from './platform';
export type { StageExecutors, ValidationDeps, SchedulerPort, NotifierPort, HistoryPort, ObserverPort } from './ports';
