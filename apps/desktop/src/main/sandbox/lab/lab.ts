/**
 * AI Sandbox — Performance & Security Lab (S5): the orchestrator.
 *
 * Runs the full validation suite — performance profiles, load, stress, chaos, security,
 * recovery — through the executor, records benchmarks, composes the dashboard, and emits
 * the report in every format. Every measurement comes from a real run through the existing
 * executors; nothing is fabricated and nothing bypasses security.
 */
import { randomUUID } from 'node:crypto';
import type {
  ChaosExperiment,
  LabDashboard,
  LabReport,
  LoadDimension,
  LoadPlan,
  RecoveryCheck,
  ScenarioSpec,
  SecurityCheck,
  StressPlan,
} from '@neuropause/shared';
import { crmSmoke, developerChannels } from '../agent/scenarioTemplates';
import { defaultProfiles, runProfiles, type PerfProfile } from './profiles';
import { runLoad } from './loadEngine';
import { runStress } from './stressEngine';
import { defaultChaosExperiments, runChaosSuite } from './chaosEngine';
import { defaultSecurityChecks, runSecuritySuite } from './securityLab';
import { defaultRecoveryChecks, runRecoverySuite } from './recoveryLab';
import { buildLabReport, labReportToCsv, labReportToHtml, labReportToJson, labReportToJUnitXml } from './report';
import { composeLabDashboard } from './dashboard';
import type { BenchmarkStore } from './benchmarkStore';
import type { LabDeps } from './ports';

const LOAD_SPECS: Record<LoadDimension, () => ScenarioSpec> = {
  users: crmSmoke,
  desktop: crmSmoke,
  rest: developerChannels,
  sdk: developerChannels,
  cli: developerChannels,
  automation: crmSmoke,
  plugins: crmSmoke,
  connectors: crmSmoke,
  'ai-sessions': crmSmoke,
};

export interface LabRunConfig {
  version?: string;
  profiles?: PerfProfile[];
  load?: LoadPlan[];
  stress?: StressPlan[];
  chaos?: ChaosExperiment[];
  security?: SecurityCheck[];
  recovery?: RecoveryCheck[];
  iterations?: number;
}

export interface LabRunOutput {
  report: LabReport;
  dashboard: LabDashboard;
  exports: { json: string; html: string; csv: string; junit: string };
  metrics: Record<string, number>;
}

export async function runLab(config: LabRunConfig, deps: LabDeps, store?: BenchmarkStore): Promise<LabRunOutput> {
  const t0 = deps.now();
  const version = config.version ?? '0.0.0';

  const performance = await runProfiles(config.profiles ?? defaultProfiles(config.iterations ?? 2), deps);

  const load = [];
  for (const plan of config.load ?? defaultLoadPlans()) load.push(await runLoad(plan, LOAD_SPECS[plan.dimension](), deps));

  const baselineMs = performance.find((p) => p.target === 'scenario-runner')?.latency.avgMs ?? 0;
  const stress = [];
  for (const plan of config.stress ?? defaultStressPlans()) stress.push(await runStress(plan, deps, baselineMs));

  const chaos = await runChaosSuite(config.chaos ?? defaultChaosExperiments(), deps);
  const security = await runSecuritySuite(config.security ?? defaultSecurityChecks(), deps);
  const recovery = await runRecoverySuite(config.recovery ?? defaultRecoveryChecks(), deps);

  const benchmarks = [];
  if (store) {
    for (const p of performance) {
      store.record({ target: p.target, metric: 'p95Ms', version, value: p.latency.p95Ms });
      const cmp = store.compareLatest(p.target, 'p95Ms', version);
      if (cmp) benchmarks.push(cmp);
    }
  }

  const generatedAt = new Date(deps.now()).toISOString();
  const report = buildLabReport({ id: `lab_${randomUUID()}`, title: 'Enterprise Performance & Security Validation', generatedAt, performance, load, stress, chaos, security, recovery, benchmarks });
  const health = (await deps.observers?.health?.().catch(() => null)) ?? null;
  const queueDepth = (await deps.observers?.queueDepth?.().catch(() => 0)) ?? 0;
  const dashboard = composeLabDashboard({ report, health, queueDepth, generatedAt });
  const exports = { json: labReportToJson(report), html: labReportToHtml(report), csv: labReportToCsv(report), junit: labReportToJUnitXml(report) };

  const metrics: Record<string, number> = {
    profilesRun: performance.length,
    loadRun: load.length,
    stressRun: stress.length,
    chaosRun: chaos.length,
    securityRun: security.length,
    recoveryRun: recovery.length,
    latencyP95Ms: dashboard.latencyP95Ms,
    throughputPerSec: dashboard.throughputPerSec,
    scenarioSuccessPct: dashboard.scenarioSuccessPct,
    recoveryRatePct: dashboard.recoveryRatePct,
    securityFailures: dashboard.securityFailures,
    peakQueueDepth: dashboard.queueDepth,
    peakRssBytes: stress.length ? Math.max(0, ...stress.map((s) => s.peakRssBytes)) : 0,
    labMs: deps.now() - t0,
  };
  return { report, dashboard, exports, metrics };
}

export function defaultLoadPlans(): LoadPlan[] {
  return [
    { id: 'load-rest', dimension: 'rest', concurrency: 4, total: 8 },
    { id: 'load-users', dimension: 'users', concurrency: 3, total: 6 },
  ];
}

export function defaultStressPlans(): StressPlan[] {
  return [
    { id: 'stress-dataset', dimension: 'dataset', magnitude: 200 },
    { id: 'stress-erp', dimension: 'erp-dataset', magnitude: 500 },
  ];
}
