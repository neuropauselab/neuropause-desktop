/**
 * AI Sandbox — Performance & Security Lab (S5) composition root.
 *
 * Builds the lab from REUSED capabilities: the S4 `QaExecutor` over the S1 engine (the only
 * route to action), the existing diagnostics/executive/queue as read-only observers, and a
 * benchmark store extending the S1 `PersistentStore`. It surfaces its status through the
 * EXISTING diagnostics via a probe factory. No new engine/monitoring/metrics/dashboard.
 */
import { createLogger } from '../../logger';
import { createQaExecutor, type QaExecutorBackend } from '../agent';
import { BenchmarkStore } from './benchmarkStore';
import { runLab, type LabRunConfig, type LabRunOutput } from './lab';
import type { LabDeps, LabObservers } from './ports';
import type { TenantScope } from '@neuropause/shared';
import { registerShutdownFlush } from '../../shutdownFlush';

const log = createLogger('sandbox-perf-security-lab');

export interface PerfSecurityLabDeps {
  executorBackend: QaExecutorBackend;
  observers?: LabObservers;
  qaSession?: (goalText: string) => Promise<{ ms: number; ok: boolean }>;
  benchmarksPath: string;
  /** P13C — the tenant boundary for the benchmark store. REQUIRED. */
  scope: () => TenantScope | null;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface LabDiagnosticCheck {
  id: string;
  label: string;
  status: 'ok' | 'degraded' | 'down' | 'unknown';
  detail: string | null;
  latencyMs: number | null;
  lastChecked: string;
  recommendation: string | null;
}

export interface PerfSecurityLabSubsystem {
  runLab: (config?: LabRunConfig) => Promise<LabRunOutput>;
  benchmarks: BenchmarkStore;
  lastVerdict: () => string | null;
  /** A DiagnosticProbe-compatible function that reports the last lab verdict through the
   *  EXISTING diagnostics service (register via `registerDiagnosticProbes([probe])`). */
  diagnosticsProbe: () => LabDiagnosticCheck;
}

export async function initPerfSecurityLab(deps: PerfSecurityLabDeps): Promise<PerfSecurityLabSubsystem> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const executor = createQaExecutor(deps.executorBackend, { now, sleep });
  const benchmarks = new BenchmarkStore(deps.benchmarksPath, now).bindScope(deps.scope);
  await benchmarks.load();
  // GATE 16 (round 46) — these stores coalesce writes in memory; drain them on the
  // shutdown/suspend barrier so a quit or lid close never loses the last mutation.
  registerShutdownFlush('sandbox-benchmarks', () => benchmarks.flush());

  let lastVerdict: string | null = null;
  let lastAt: string | null = null;
  const labDeps: LabDeps = { executor, observers: deps.observers, qaSession: deps.qaSession, now, sleep };

  log.info('perf & security lab initialized', { benchmarks: benchmarks.count() });
  return {
    runLab: async (config: LabRunConfig = {}) => {
      const out = await runLab(config, labDeps, benchmarks);
      lastVerdict = out.report.verdict;
      lastAt = out.report.generatedAt;
      return out;
    },
    benchmarks,
    lastVerdict: () => lastVerdict,
    diagnosticsProbe: () => ({
      id: 'sandbox-perf-security-lab',
      label: 'Perf & Security Lab',
      status: lastVerdict === null ? 'unknown' : lastVerdict === 'pass' ? 'ok' : lastVerdict === 'warn' ? 'degraded' : 'down',
      detail: lastVerdict ? `last validation verdict: ${lastVerdict}` : 'no validation run yet',
      latencyMs: null,
      lastChecked: lastAt ?? new Date(now()).toISOString(),
      recommendation: lastVerdict === 'fail' ? 'Review the latest lab report — a validation dimension failed.' : null,
    }),
  };
}

export { runLab } from './lab';
export { BenchmarkStore } from './benchmarkStore';
export { composeLabDashboard } from './dashboard';
export { buildLabReport, labReportToCsv, labReportToHtml, labReportToJson, labReportToJUnitXml } from './report';
export { defaultProfiles, runProfile, runProfiles } from './profiles';
export { runLoad } from './loadEngine';
export { runStress } from './stressEngine';
export { runChaos, runChaosSuite, defaultChaosExperiments, CHAOS_CATALOG } from './chaosEngine';
export { runSecurityCheck, runSecuritySuite, defaultSecurityChecks } from './securityLab';
export { runRecoveryCheck, runRecoverySuite, defaultRecoveryChecks } from './recoveryLab';
export type { LabObservers, LabDeps } from './ports';
export type { LabRunConfig, LabRunOutput } from './lab';
