/**
 * AI Sandbox — Continuous Validation Platform (S6): the orchestrator core.
 *
 * Runs a pipeline end-to-end: dispatch each stage to the existing executors (S1–S5) →
 * aggregate → regression-analyze against the S5 benchmark store → certify (if the pipeline
 * certifies) → record in memory → notify → persist the run. It reuses everything; it adds
 * no engine. Also composes the portal summary + the live dashboard from the run store.
 */
import {
  runStatusFrom,
  type CertificationReport,
  type PipelineKind,
  type RegressionAnalysis,
  type TriggerKind,
  type ValidationDashboard,
  type ValidationRun,
  type ValidationRunStatus,
  type ValidationSummary,
} from '@neuropause/shared';
import { getPipeline, PIPELINE_LIST } from './pipelines';
import { runPipelineStages } from './pipelineRunner';
import { analyzeRegression } from './regression';
import { buildCertification } from './certification';
import { recordHistory } from './history';
import { emitNotifications, notificationsFor } from './notifications';
import { composeValidationDashboard } from './dashboard';
import type { ValidationRunStore } from './runStore';
import type { ValidationScheduler } from './scheduler';
import type { ValidationDeps } from './ports';

export interface ValidationRunOutput {
  run: ValidationRun;
  certification: CertificationReport | null;
  regression: RegressionAnalysis;
}

export async function runValidationPipeline(
  pipeline: PipelineKind,
  trigger: TriggerKind,
  deps: ValidationDeps & { version: string },
  runStore: ValidationRunStore,
): Promise<ValidationRunOutput> {
  const def = getPipeline(pipeline);
  const t0 = deps.now();
  const run: ValidationRun = {
    id: runStore.newId(),
    pipeline,
    trigger,
    status: 'running',
    startedAt: new Date(t0).toISOString(),
    finishedAt: null,
    durationMs: 0,
    stages: [],
    metrics: {},
    certificationLevel: null,
    regressionCount: 0,
  };
  runStore.add(run);

  const staged = await runPipelineStages(def, deps);
  run.stages = staged.stages;

  const latencyP95Ms = staged.labOutputs.length ? Math.max(0, ...staged.labOutputs.map((o) => o.dashboard.latencyP95Ms)) : 0;
  const securityFailures = staged.labOutputs.reduce((n, o) => n + o.report.security.filter((s) => !s.passed).length, 0);
  const recoveryRatePct = staged.labOutputs.length ? Math.round(staged.labOutputs.reduce((s, o) => s + o.dashboard.recoveryRatePct, 0) / staged.labOutputs.length) : 100;
  const failureCount = staged.stages.filter((s) => s.status === 'fail' || s.status === 'error').length;
  const rss = rssBytes();

  const regression = analyzeRegression(
    { version: deps.version, latencyP95Ms: latencyP95Ms || undefined, memoryBytes: rss || undefined, failureCount, securityFailures, recoveryRatePct: staged.labOutputs.length ? recoveryRatePct : undefined },
    deps.benchmarks,
  );
  run.regressionCount = regression.findings.length;

  let certification: CertificationReport | null = null;
  if (def.certifies) {
    const kpis = deps.observers?.kpis?.() ?? [];
    const health = deps.observers?.health ? await deps.observers.health().catch(() => null) : null;
    certification = buildCertification({
      pipeline, version: deps.version, generatedAt: new Date(deps.now()).toISOString(),
      stages: staged.stages, regression, scenario: staged.scenario, qaSessions: staged.qaSessions, labOutputs: staged.labOutputs, kpis, health, buildStatus: 'gates: green',
    });
    run.certificationLevel = certification.level;
  }

  run.status = runStatusFrom(staged.stages);
  run.finishedAt = new Date(deps.now()).toISOString();
  run.durationMs = deps.now() - t0;
  run.metrics = {
    pipelineMs: run.durationMs,
    stagesRun: staged.stages.length,
    stagesPassed: staged.stages.filter((s) => s.status === 'pass').length,
    stagesFailed: failureCount,
    scenarioTotal: staged.scenario.total,
    scenarioPassed: staged.scenario.passed,
    aiQaBugs: staged.qaSessions.reduce((n, s) => n + s.bugs.length, 0),
    securityFailures,
    regressionCount: regression.findings.length,
    latencyP95Ms,
    recoveryRatePct,
    rssBytes: rss,
  };
  runStore.update(run);

  recordHistory(run, deps.history);
  emitNotifications(notificationsFor(run, regression), deps.notifier);

  return { run, certification, regression };
}

export function validationSummary(runStore: ValidationRunStore, scheduler: ValidationScheduler, now: () => number): ValidationSummary {
  return {
    generatedAt: new Date(now()).toISOString(),
    pipelines: PIPELINE_LIST.map((p) => ({ kind: p.kind, name: p.name, stages: p.stages.length, certifies: p.certifies })),
    scheduled: scheduler.list(),
    recent: runStore.history(15),
    latestCertification: runStore.history(50).find((h) => h.level !== null)?.level ?? null,
    totalRuns: runStore.count(),
  };
}

export function validationDashboard(
  runStore: ValidationRunStore,
  scheduler: ValidationScheduler,
  current: { runId: string; pipeline: PipelineKind; status: ValidationRunStatus } | null,
  queueDepth: number,
  now: () => number,
): ValidationDashboard {
  return composeValidationDashboard({ history: runStore.history(25), scheduled: scheduler.list(), current, queueDepth, generatedAt: new Date(now()).toISOString() });
}

function rssBytes(): number {
  try {
    return typeof process !== 'undefined' && process.memoryUsage ? process.memoryUsage().rss : 0;
  } catch {
    return 0;
  }
}
