/**
 * AI Sandbox — Continuous Validation Platform (S6): regression analysis.
 *
 * Compares a run's metrics against the SAME S5 benchmark store (never a duplicate) using the
 * shared `classifyRegression` helper — detecting performance/latency/memory/functional/
 * security/recovery regressions and failure trends. It records the run's values so the next
 * run has a baseline. Pure over the injected store.
 */
import { classifyRegression, worstSeverity, type RegressionAnalysis, type RegressionFinding } from '@neuropause/shared';
import type { BenchmarkStore } from '../lab/benchmarkStore';

export interface RegressionInput {
  version: string;
  latencyP95Ms?: number;
  memoryBytes?: number;
  failureCount?: number;
  securityFailures?: number;
  recoveryRatePct?: number;
}

const TARGET = 'scenario-runner' as const; // validation metrics are keyed by metric name under this target

export function analyzeRegression(input: RegressionInput, benchmarks: BenchmarkStore): RegressionAnalysis {
  const findings: RegressionFinding[] = [];

  const compare = (metric: string, value: number, kind: RegressionFinding['kind']): void => {
    const baseline = benchmarks.baseline(TARGET, metric, input.version);
    benchmarks.record({ target: TARGET, metric, version: input.version, value });
    const f = classifyRegression(kind, metric, value, baseline);
    if (f) findings.push(f);
  };

  if (input.latencyP95Ms !== undefined) compare('validation.latencyP95Ms', input.latencyP95Ms, 'latency');
  if (input.memoryBytes !== undefined) compare('validation.memoryBytes', input.memoryBytes, 'memory');
  if (input.failureCount !== undefined) compare('validation.failures', input.failureCount, 'failure-trend');

  if (input.securityFailures !== undefined && input.securityFailures > 0) {
    findings.push({ kind: 'security', metric: 'securityFailures', current: input.securityFailures, baseline: 0, deltaPct: 100, severity: 'critical', detail: `${input.securityFailures} security control(s) failed — must fix before release` });
  }

  if (input.recoveryRatePct !== undefined) {
    const baseline = benchmarks.baseline(TARGET, 'validation.recoveryRate', input.version);
    benchmarks.record({ target: TARGET, metric: 'validation.recoveryRate', version: input.version, value: input.recoveryRatePct });
    if (baseline !== null && baseline > 0 && input.recoveryRatePct < baseline) {
      const deltaPct = Math.round(((baseline - input.recoveryRatePct) / baseline) * 1000) / 10;
      if (deltaPct > 5) findings.push({ kind: 'recovery', metric: 'recoveryRate', current: input.recoveryRatePct, baseline, deltaPct, severity: deltaPct >= 25 ? 'major' : 'minor', detail: `recovery rate down ${deltaPct}% vs baseline` });
    }
  }

  const regressed = findings.length > 0;
  return {
    findings,
    regressed,
    worst: worstSeverity(findings),
    summary: regressed ? `${findings.length} regression(s): ${findings.map((f) => `${f.kind}(${f.severity})`).join(', ')}` : 'no regressions vs baseline',
  };
}
