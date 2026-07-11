/**
 * AI Sandbox — Performance & Security Lab (S5): dashboard projection.
 *
 * Reuses the S1 dashboard PATTERN (a pure composer over real data) to roll the lab run +
 * the existing health snapshot + queue depth into a {@link LabDashboard}. No new dashboard
 * system — the metrics all come from the lab's real runs and the existing diagnostics.
 */
import { recoveryRatePct, scenarioSuccessPct, type BenchmarkTrend, type LabDashboard, type LabReport } from '@neuropause/shared';

export interface LabDashboardInput {
  report: LabReport;
  health?: { level: string; cpuPercent: number; memoryUsedMb: number } | null;
  queueDepth?: number;
  generatedAt: string;
}

type Band = 'healthy' | 'watch' | 'at-risk' | 'critical';

export function composeLabDashboard(input: LabDashboardInput): LabDashboard {
  const { report } = input;
  const latencyP95Ms = maxOf([...report.performance.map((p) => p.latency.p95Ms), ...report.load.map((l) => l.latency.p95Ms)]);
  const throughputPerSec = maxOf([...report.load.map((l) => l.throughputPerSec), ...report.performance.map((p) => p.throughputPerSec)]);
  const success = scenarioSuccessPct(report.performance);
  const recoveryRate = recoveryRatePct(report.recovery, report.chaos);
  const securityFailures = report.security.filter((s) => !s.passed).length;
  const peakQueueDepth = maxOf(report.load.map((l) => l.peakQueueDepth));
  const regressionTrend: BenchmarkTrend = report.benchmarks.some((b) => b.trend === 'regressed')
    ? 'regressed'
    : report.benchmarks.some((b) => b.trend === 'improved')
      ? 'improved'
      : 'stable';

  const panels: LabDashboard['panels'] = [
    { key: 'latency-p95', label: 'Latency p95', value: `${latencyP95Ms}ms`, band: latencyBand(latencyP95Ms) },
    { key: 'throughput', label: 'Throughput', value: `${throughputPerSec}/s`, band: 'healthy' },
    { key: 'scenario-success', label: 'Scenario success', value: `${success}%`, band: pctBand(success) },
    { key: 'recovery-rate', label: 'Recovery rate', value: `${recoveryRate}%`, band: pctBand(recoveryRate) },
    { key: 'security', label: 'Security failures', value: String(securityFailures), band: securityFailures > 0 ? 'critical' : 'healthy' },
    { key: 'queue-depth', label: 'Peak queue depth', value: String(Math.max(peakQueueDepth, input.queueDepth ?? 0)), band: 'watch' },
    { key: 'regression', label: 'Regression trend', value: regressionTrend, band: regressionTrend === 'regressed' ? 'at-risk' : 'healthy' },
    { key: 'cpu', label: 'CPU', value: `${Math.round(input.health?.cpuPercent ?? 0)}%`, band: pctBandInverse(input.health?.cpuPercent ?? 0) },
    { key: 'memory', label: 'Memory', value: `${Math.round(input.health?.memoryUsedMb ?? 0)}MB`, band: 'healthy' },
  ];

  return {
    generatedAt: input.generatedAt,
    latencyP95Ms,
    throughputPerSec,
    cpuPercent: input.health?.cpuPercent ?? 0,
    memoryUsedMb: input.health?.memoryUsedMb ?? 0,
    queueDepth: Math.max(peakQueueDepth, input.queueDepth ?? 0),
    scenarioSuccessPct: success,
    recoveryRatePct: recoveryRate,
    securityFailures,
    regressionTrend,
    panels,
  };
}

function maxOf(xs: number[]): number {
  return xs.length ? Math.max(0, ...xs) : 0;
}
function latencyBand(ms: number): Band {
  if (ms <= 200) return 'healthy';
  if (ms <= 1000) return 'watch';
  if (ms <= 3000) return 'at-risk';
  return 'critical';
}
function pctBand(pct: number): Band {
  if (pct >= 95) return 'healthy';
  if (pct >= 80) return 'watch';
  if (pct >= 50) return 'at-risk';
  return 'critical';
}
function pctBandInverse(pct: number): Band {
  if (pct <= 50) return 'healthy';
  if (pct <= 75) return 'watch';
  if (pct <= 90) return 'at-risk';
  return 'critical';
}
