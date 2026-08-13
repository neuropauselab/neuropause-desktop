/**
 * AI Sandbox — Continuous Validation Platform (S6) composition root.
 *
 * Wires the orchestrator from REUSED capabilities: the S1–S5 executors (stage dispatch),
 * the S5 benchmark store (regression), the existing scheduler / notifications / memory /
 * diagnostics (all injected), and a run store on the S1 persistence substrate. Exposes a
 * read-only `sandbox:read` channel the Developer Portal consumes. This completes AI Sandbox
 * v1.0. No new engine/scheduler/dashboard/report/memory/security.
 */
import {
  EmptyRequest,
  IpcChannel,
  SandboxValidationRunGetRequest,
  SandboxValidationRunRequest,
  SandboxValidationScheduleSetRequest,
  type PipelineKind,
  type TriggerKind,
  type ValidationDashboard,
  type ValidationPipeline,
  type ValidationRunDetail,
  type ValidationSummary,
} from '@neuropause/shared';
import { createLogger } from '../../logger';
import type { SecureHandlerDef } from '../../ipc/secureBridge';
import { PIPELINE_LIST } from './pipelines';
import { certificationToHtml, certificationToJson, certificationToMarkdown } from './certification';
import { ValidationScheduler, defaultSchedules } from './scheduler';
import { ValidationRunStore } from './runStore';
import { runValidationPipeline, validationDashboard, validationSummary, type ValidationRunOutput } from './platform';
import type { HistoryPort, NotifierPort, ObserverPort, SchedulerPort, StageExecutors, ValidationDeps } from './ports';
import type { BenchmarkStore } from '../lab/benchmarkStore';
import type { TenantScope } from '@neuropause/shared';
import { runAsPrincipal, tenantPrincipal } from '../../tenancy/backgroundPrincipal';

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
  /**
   * P13C — the tenant boundary. REQUIRED, because this store extends the same
   * `PersistentStore` the S1 stores do and was the one subclass nobody bound.
   */
  scope: () => TenantScope | null;
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
  const runStore = new ValidationRunStore(deps.runsPath).bindScope(deps.scope);
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

  /**
   * The in-flight pipeline, PER TENANT.
   *
   * P13C — this was one module-level `let`, surfaced in every dashboard, so
   * tenant B was told that tenant A had a pipeline running and was handed its
   * runId — which then unlocked the cached detail below.
   */
  const currentByTenant = new Map<string, { runId: string; pipeline: PipelineKind; status: 'running' }>();
  const tenantKeyOrNull = (): string | null => deps.scope()?.tenantId ?? null;
  const currentFor = (): { runId: string; pipeline: PipelineKind; status: 'running' } | null => {
    const t = tenantKeyOrNull();
    return t === null ? null : currentByTenant.get(t) ?? null;
  };
  const scheduler = new ValidationScheduler({
    scheduler: deps.scheduler,
    /**
     * P13C ROUND 10, fresh red team — HIGH. The schedule set had no tenant
     * dimension at all, and the tick ran with no principal.
     */
    tenantId: tenantKeyOrNull,
    runAsOwner: async (tenantId, fn) => {
      const principal = tenantPrincipal({
        jobId: 'validation-schedule',
        scope: { tenantId, workspaceId: '' },
      });
      // NULL IS THE FAIL-CLOSED ANSWER: a schedule that cannot name its
      // principal does not run, rather than running as whoever is signed in.
      if (principal === null) return false;
      await runAsPrincipal(principal, fn);
      return true;
    },
    runPipeline: async (p, t) => (await runValidationPipeline(p, t, runDeps, runStore)).run,
    now,
    clock: deps.clock,
  });

  // A small, bounded cache of the orchestrator's OWN recent outputs (run + certification +
  // regression). This is NOT a new report/artifact store — it holds only what runValidationPipeline
  // already produced, so the Validation Experience can render/export a run's certification without
  // recomputing it. Older runs fall back to the persisted run (certification null). REUSE, not rebuild.
  /**
   * A bounded cache of recent outputs, KEYED BY (tenant, runId).
   *
   * P13C — keyed by runId alone this was a direct cross-tenant read: the
   * `sandbox:validation.run.get` handler took a runId from the payload and
   * returned the cached `ValidationRunDetail`, whose certification report
   * carries that tenant's live executive KPI figures plus ready-made markdown,
   * HTML and JSON exports. `sandbox:read` is in the base read-only role, so
   * every member of every tenant could call it.
   */
  const outputs = new Map<string, ValidationRunOutput>();
  const cacheKey = (tenantId: string, runId: string): string => JSON.stringify([tenantId, runId]);
  const OUTPUTS_CAP = 30;
  const rememberOutput = (out: ValidationRunOutput): void => {
    const owner = tenantKeyOrNull();
    if (owner === null) return; // unowned output is cached for nobody
    outputs.set(cacheKey(owner, out.run.id), out);
    /**
     * PER OWNER. P13C ROUND 10, fresh red team — MEDIUM.
     *
     * The trigger was `outputs.size > OUTPUTS_CAP` over every tenant's entries
     * and the victim was the globally oldest insertion, so one organization
     * running thirty ordinary pipelines destroyed another's cached certification
     * report, regression analysis and exports. The run row survived — that cap
     * was made per owner earlier this round — and the EVIDENCE did not.
     *
     * Exactly the shape `declareStoreScope` refuses at declaration time; a Map
     * cap inside a factory closure is invisible to it, which is why the closure
     * has to get this right itself.
     */
    const mineKeys = [...outputs.keys()].filter((k) => {
      try {
        return (JSON.parse(k) as [string, string])[0] === owner;
      } catch {
        return false;
      }
    });
    while (mineKeys.length > OUTPUTS_CAP) {
      const oldest = mineKeys.shift();
      if (oldest !== undefined) outputs.delete(oldest);
    }
  };
  /**
   * The detail view of a run whose output is in hand. Total by construction — an
   * output carries its own run, so there is nothing to look up and nothing to miss.
   */
  const detailFromOutput = (out: ValidationRunOutput): ValidationRunDetail => {
    const cert = out.certification;
    return {
      run: out.run,
      certification: cert,
      regression: out.regression,
      exports: cert
        ? { markdown: certificationToMarkdown(cert), html: certificationToHtml(cert), json: certificationToJson(cert) }
        : null,
    };
  };
  const buildRunDetail = (runId: string): ValidationRunDetail | { error: 'not_found' } => {
    const owner = tenantKeyOrNull();
    const cached = owner === null ? undefined : outputs.get(cacheKey(owner, runId));
    if (cached) return detailFromOutput(cached);
    // `runStore.get` is scoped too, so a foreign runId is not_found on both legs.
    const run = runStore.get(runId);
    if (!run) return { error: 'not_found' };
    return { run, certification: null, regression: null, exports: null };
  };

  const run = async (pipeline: PipelineKind, trigger: TriggerKind = 'manual'): Promise<ValidationRunOutput> => {
    const owner = tenantKeyOrNull();
    if (owner !== null) currentByTenant.set(owner, { runId: 'pending', pipeline, status: 'running' });
    try {
      const out = await runValidationPipeline(pipeline, trigger, runDeps, runStore);
      rememberOutput(out);
      return out;
    } finally {
      if (owner !== null) currentByTenant.delete(owner);
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
    {
      channel: IpcChannel.SandboxValidationDashboard,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'sandbox:read',
      handler: () => validationDashboard(runStore, scheduler, currentFor(), 0, now),
    },
    {
      channel: IpcChannel.SandboxValidationRunGet,
      schema: SandboxValidationRunGetRequest,
      requireAuth: true,
      permission: 'sandbox:read',
      handler: (p) => buildRunDetail((p as SandboxValidationRunGetRequest).runId),
    },
    {
      // Runs mutate real platform data (they exercise the live stack), so this is gated on
      // `sandbox:manage` + authenticated + audited — identical to every other sandbox mutation.
      channel: IpcChannel.SandboxValidationRun,
      schema: SandboxValidationRunRequest,
      requireAuth: true,
      permission: 'sandbox:manage',
      audit: true,
      handler: async (p) => {
        const r = p as SandboxValidationRunRequest;
        const out = await run(r.pipeline, r.trigger ?? 'manual');
        // A7 — built from the output directly, not re-fetched by id. Going back through
        // `buildRunDetail` reintroduced a `{ error: 'not_found' }` branch for a run this
        // line had just finished executing: unreachable, but the renderer's declared
        // response for `sandbox:validation.run` is `ValidationRunDetail`, so the branch
        // was a lie the old `as` cast covered up. The output IS the detail; nothing to miss.
        return detailFromOutput(out);
      },
    },
    {
      channel: IpcChannel.SandboxValidationScheduleSet,
      schema: SandboxValidationScheduleSetRequest,
      requireAuth: true,
      permission: 'sandbox:manage',
      audit: true,
      handler: (p) => {
        const r = p as SandboxValidationScheduleSetRequest;
        scheduler.setEnabled(r.id, r.enabled);
        return scheduler.list();
      },
    },
  ];

  log.info('continuous validation platform initialized', { pipelines: PIPELINE_LIST.length, scheduled: scheduler.list().length });
  return {
    handlers,
    run,
    scheduler,
    runStore,
    summary: () => validationSummary(runStore, scheduler, now),
    dashboard: () => validationDashboard(runStore, scheduler, currentFor(), 0, now),
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
