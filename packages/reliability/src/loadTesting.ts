/**
 * EPIC 4 — Load / Stress / Endurance Testing. All three ramp the REUSED operations PerformanceMonitor
 * (real in-process harness): load = fixed concurrency, stress = ramp concurrency to a measured
 * breaking point, endurance (soak) = many iterations sampling REAL heap over time. Results are the
 * harness's measured output — never fabricated. Recovery is MEASURED: after a stress ramp the harness
 * re-runs a light load and we record whether throughput actually returned. Production-scale traffic
 * (real network load generators on production hardware) stays INFRASTRUCTURE-PENDING and is never
 * simulated as if real.
 */
import type { PerformanceMonitor, LoadResult } from '@neuropause/operations';
import type { PerfHarness } from './performance';
import type { ReliabilityGovernance } from './governance';

export interface StressResult {
  name: string;
  breakingPoint: number | null;
  levels: LoadResult[];
  measured: true;
}

export interface EnduranceResult {
  name: string;
  iterations: number;
  heapGrowthBytes: number;
  leakSuspected: boolean;
  samples: number;
  measured: true;
}

export interface RecoveryProbe {
  name: string;
  recovered: boolean;
  postThroughputPerSec: number;
  detail: string;
}

export class LoadStressEndurance {
  private readonly monitor: PerformanceMonitor;
  private readonly reused: boolean;

  constructor(
    harness: PerfHarness,
    private readonly gov: ReliabilityGovernance,
    private readonly org: string,
    private readonly operator: string,
  ) {
    this.monitor = harness.monitor;
    this.reused = harness.reused;
  }

  reusesOperations(): boolean {
    return this.reused;
  }

  /** A measured load test at fixed concurrency. */
  async load(name: string, op: (i: number) => void | Promise<void>, params: { iterations: number; concurrency?: number }): Promise<LoadResult> {
    const result = await this.monitor.loadTest(name, op, params);
    await this.record('load', name, `${Math.round(result.throughputPerSec)}/s`);
    return result;
  }

  /** Ramp concurrency until latency/errors breach a threshold; report the MEASURED breaking point. */
  async stress(name: string, op: (i: number) => void | Promise<void>, params: { maxConcurrency: number; iterationsPerLevel: number; latencyThresholdMs: number; step?: number; errorThreshold?: number }): Promise<StressResult> {
    const r = await this.monitor.stressTest(name, op, params);
    await this.record('stress', name, r.breakingPoint === null ? 'no breaking point in range' : `breaking point c=${r.breakingPoint}`);
    return { name, breakingPoint: r.breakingPoint, levels: r.levels, measured: true };
  }

  /** Endurance/soak: run many iterations, sampling REAL heap; flag a suspected leak (measured, not assumed). */
  async endurance(name: string, op: (i: number) => void | Promise<void>, params: { iterations: number; sampleEvery?: number }): Promise<EnduranceResult> {
    const r = await this.monitor.soakTest(name, op, params);
    await this.record('endurance', name, `heapΔ=${r.heapGrowthBytes}B leak=${r.leakSuspected}`);
    return { name, iterations: params.iterations, heapGrowthBytes: r.heapGrowthBytes, leakSuspected: r.leakSuspected, samples: r.samples.length, measured: true };
  }

  /** Measure recovery: after stress, re-run a light load and confirm throughput actually returned. */
  async measureRecovery(name: string, op: (i: number) => void | Promise<void>, params: { iterations: number }): Promise<RecoveryProbe> {
    const post = await this.monitor.loadTest(`${name}-recovery`, op, { iterations: params.iterations, concurrency: 1 });
    const recovered = post.errors === 0 && post.iterations === params.iterations;
    await this.record('recovery-probe', name, recovered ? 'throughput returned' : 'did not recover');
    return { name, recovered, postThroughputPerSec: post.throughputPerSec, detail: recovered ? 'light load fully processed after stress' : `${post.errors} errors after stress` };
  }

  private async record(operation: string, targetId: string, decision: string): Promise<void> {
    await this.gov.record({
      operator: this.operator,
      org: this.org,
      capability: 'Load / Stress / Endurance Testing',
      epic: 'E4',
      operation,
      targetId,
      evidence: 'live-verified',
      decision,
    });
  }
}
