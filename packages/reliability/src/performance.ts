/**
 * EPIC 3 — Performance Engineering. Throughput, latency, capacity, bottleneck, resource, memory, and
 * CPU analysis — all delegated to the REUSED operations PerformanceMonitor (a real in-process harness
 * with real `process.memoryUsage()` / `process.cpuUsage()` sampling). This layer NEVER fabricates a
 * measurement: every number it returns came from the reused harness measuring a real operation.
 * When operations is wired in, its live monitor is used; otherwise the same reused class is
 * instantiated locally (the class is reused from operations, never re-implemented here).
 */
import type { PerformanceMonitor, LoadResult, LatencySummary, ResourceSample } from '@neuropause/operations';
import type { ReliabilityGovernance } from './governance';

/** Acquire the performance harness: the operations platform's own live monitor when wired in, else the same reused class instantiated locally (never re-implemented). */
export interface PerfHarness {
  monitor: PerformanceMonitor;
  reused: boolean;
}

export class PerformanceEngineering {
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

  /** True when the throughput/latency numbers come from the operations platform's own live monitor. */
  reusesOperations(): boolean {
    return this.reused;
  }

  /** A real snapshot of this process's memory + CPU. */
  resources(): ResourceSample {
    return this.monitor.memory();
  }

  /** Measure an operation's latency distribution over N real iterations. */
  async latency(op: (i: number) => void | Promise<void>, iterations = 50): Promise<LatencySummary> {
    return this.monitor.measure(op, iterations);
  }

  /** Measure real throughput + latency under concurrency. Records the measured result on the chain. */
  async throughput(name: string, op: (i: number) => void | Promise<void>, params: { iterations: number; concurrency?: number }): Promise<LoadResult> {
    const result = await this.monitor.loadTest(name, op, params);
    await this.gov.record({
      operator: this.operator,
      org: this.org,
      capability: 'Performance Engineering',
      epic: 'E3',
      operation: 'throughput',
      targetId: name,
      evidence: 'live-verified',
      decision: `${Math.round(result.throughputPerSec)}/s p95=${result.latency.p95}`,
    });
    return result;
  }

  /** Profile REAL resource deltas (heap/RSS/CPU) across one operation — surfaces the bottleneck cost. */
  async bottleneck(op: (i: number) => void | Promise<void>): Promise<{ durationMs: number; deltaHeapBytes: number; deltaRssBytes: number; deltaCpuUs: number }> {
    return this.monitor.profile(op);
  }

  /** Linear capacity forecast from a measured throughput at a measured utilization. */
  forecastCapacity(params: { currentThroughputPerSec: number; utilization: number; targetUtilization?: number }): { projectedMaxThroughputPerSec: number; headroomFactor: number; saturated: boolean } {
    return this.monitor.forecastCapacity(params);
  }

  /** Capture a baseline from a measured load result for later regression detection. */
  setBaseline(result: LoadResult): void {
    this.monitor.setBaseline(result);
  }

  /** Compare a fresh measured result against the baseline; regression is computed, never assumed. */
  detectRegression(current: LoadResult): { regressed: boolean; p95Ratio: number; throughputRatio: number; detail: string } {
    const r = this.monitor.detectRegression(current);
    return { regressed: r.regressed, p95Ratio: r.p95Ratio, throughputRatio: r.throughputRatio, detail: r.detail };
  }
}
