/**
 * Performance Platform (NCEA 15.0, Phase 7). Baselines, a deterministic in-process
 * load / stress / soak harness, REAL memory + CPU sampling (`process.memoryUsage()`
 * / `process.cpuUsage()`), latency measurement with percentiles, resource
 * profiling, regression detection against a baseline, and linear capacity
 * forecasting. The harness and the resource sampling are VERIFIED here. Production-
 * SCALE performance — real network load generators, multi-node stress, and long-
 * duration soak on production hardware — is INFRA-PENDING and never fabricated.
 */
import { systemClock, type Clock } from '@neuropause/cloud-core';

export interface ResourceSample {
  at: number;
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  externalBytes: number;
  cpuUserUs: number;
  cpuSystemUs: number;
}

/** A real snapshot of this process's memory + CPU. */
export function sampleResources(at: number): ResourceSample {
  const m = process.memoryUsage();
  const c = process.cpuUsage();
  return { at, rssBytes: m.rss, heapUsedBytes: m.heapUsed, heapTotalBytes: m.heapTotal, externalBytes: m.external, cpuUserUs: c.user, cpuSystemUs: c.system };
}

export interface LatencySummary {
  count: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
}

function summarize(samples: number[]): LatencySummary {
  if (samples.length === 0) return { count: 0, min: 0, max: 0, mean: 0, p50: 0, p95: 0, p99: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const pct = (p: number): number => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))] ?? 0;
  const sum = sorted.reduce((a, b) => a + b, 0);
  return { count: sorted.length, min: sorted[0] ?? 0, max: sorted[sorted.length - 1] ?? 0, mean: sum / sorted.length, p50: pct(50), p95: pct(95), p99: pct(99) };
}

export interface LoadResult {
  name: string;
  iterations: number;
  concurrency: number;
  durationMs: number;
  throughputPerSec: number;
  latency: LatencySummary;
  errors: number;
}

export interface Baseline {
  name: string;
  latency: LatencySummary;
  throughputPerSec: number;
  capturedAt: number;
}

export interface RegressionResult {
  name: string;
  regressed: boolean;
  p95Ratio: number;
  throughputRatio: number;
  detail: string;
}

export type Operation = (iteration: number) => void | Promise<void>;

export interface PerformanceOptions {
  metrics?: { inc(name: string, by?: number): void; set(name: string, value: number): void };
  /** A regression fires when p95 latency grows past this ratio, or throughput drops below its reciprocal. Default 1.2. */
  regressionThreshold?: number;
  /** Heap growth (bytes) over a soak beyond which a leak is suspected. Default 64 MiB. */
  leakThresholdBytes?: number;
}

export class PerformanceMonitor {
  private readonly baselines = new Map<string, Baseline>();
  private readonly regressionThreshold: number;
  private readonly leakThresholdBytes: number;

  constructor(
    private readonly clock: Clock = systemClock,
    private readonly options: PerformanceOptions = {},
  ) {
    this.regressionThreshold = options.regressionThreshold ?? 1.2;
    this.leakThresholdBytes = options.leakThresholdBytes ?? 64 * 1024 * 1024;
  }

  memory(): ResourceSample {
    return sampleResources(this.clock.now());
  }

  /** Measure an operation's latency over N sequential iterations (timing via the injected clock). */
  async measure(op: Operation, iterations = 1): Promise<LatencySummary> {
    const lat: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const t0 = this.clock.now();
      await op(i);
      lat.push(this.clock.now() - t0);
    }
    return summarize(lat);
  }

  /** In-process load test: run `iterations` ops with up to `concurrency` in flight. */
  async loadTest(name: string, op: Operation, params: { iterations: number; concurrency?: number }): Promise<LoadResult> {
    const concurrency = Math.max(1, params.concurrency ?? 1);
    const lat: number[] = [];
    let errors = 0;
    let next = 0;
    const start = this.clock.now();
    const worker = async (): Promise<void> => {
      for (;;) {
        const i = next++;
        if (i >= params.iterations) return;
        const t0 = this.clock.now();
        try {
          await op(i);
        } catch {
          errors += 1;
        }
        lat.push(this.clock.now() - t0);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, params.iterations) }, () => worker()));
    const durationMs = this.clock.now() - start;
    const throughputPerSec = durationMs > 0 ? (params.iterations / durationMs) * 1000 : params.iterations;
    const result: LoadResult = { name, iterations: params.iterations, concurrency, durationMs, throughputPerSec, latency: summarize(lat), errors };
    this.options.metrics?.set(`ops.perf.${name}.p95_ms`, result.latency.p95);
    this.options.metrics?.set(`ops.perf.${name}.throughput`, Math.round(result.throughputPerSec));
    return result;
  }

  /** Ramp concurrency until p95 latency or errors breach a threshold; report the breaking point. */
  async stressTest(
    name: string,
    op: Operation,
    params: { start?: number; step?: number; maxConcurrency: number; iterationsPerLevel: number; latencyThresholdMs: number; errorThreshold?: number },
  ): Promise<{ breakingPoint: number | null; levels: LoadResult[] }> {
    const levels: LoadResult[] = [];
    const errorThreshold = params.errorThreshold ?? 0;
    for (let c = params.start ?? 1; c <= params.maxConcurrency; c += params.step ?? 1) {
      const level = await this.loadTest(`${name}@c${c}`, op, { iterations: params.iterationsPerLevel, concurrency: c });
      levels.push(level);
      if (level.latency.p95 > params.latencyThresholdMs || level.errors > errorThreshold) {
        return { breakingPoint: c, levels };
      }
    }
    return { breakingPoint: null, levels };
  }

  /** Soak: run many iterations, sampling REAL memory over time, and flag suspected heap growth. */
  async soakTest(name: string, op: Operation, params: { iterations: number; sampleEvery?: number }): Promise<{ name: string; samples: ResourceSample[]; heapGrowthBytes: number; leakSuspected: boolean }> {
    const sampleEvery = Math.max(1, params.sampleEvery ?? Math.ceil(params.iterations / 10));
    const samples: ResourceSample[] = [sampleResources(this.clock.now())];
    for (let i = 0; i < params.iterations; i++) {
      await op(i);
      if ((i + 1) % sampleEvery === 0) samples.push(sampleResources(this.clock.now()));
    }
    const first = samples[0]!;
    const last = samples[samples.length - 1]!;
    const heapGrowthBytes = last.heapUsedBytes - first.heapUsedBytes;
    return { name, samples, heapGrowthBytes, leakSuspected: heapGrowthBytes > this.leakThresholdBytes };
  }

  /** Profile REAL resource deltas across a single operation. */
  async profile(op: Operation): Promise<{ durationMs: number; deltaHeapBytes: number; deltaRssBytes: number; deltaCpuUs: number }> {
    const before = sampleResources(this.clock.now());
    const t0 = this.clock.now();
    await op(0);
    const durationMs = this.clock.now() - t0;
    const after = sampleResources(this.clock.now());
    return { durationMs, deltaHeapBytes: after.heapUsedBytes - before.heapUsedBytes, deltaRssBytes: after.rssBytes - before.rssBytes, deltaCpuUs: after.cpuUserUs + after.cpuSystemUs - (before.cpuUserUs + before.cpuSystemUs) };
  }

  setBaseline(result: LoadResult): Baseline {
    const baseline: Baseline = { name: result.name, latency: result.latency, throughputPerSec: result.throughputPerSec, capturedAt: this.clock.now() };
    this.baselines.set(result.name, baseline);
    return baseline;
  }
  baseline(name: string): Baseline | undefined {
    return this.baselines.get(name);
  }

  /** Regression = p95 grew past the threshold ratio, or throughput dropped below its reciprocal. */
  detectRegression(current: LoadResult): RegressionResult {
    const base = this.baselines.get(current.name);
    if (!base) return { name: current.name, regressed: false, p95Ratio: 1, throughputRatio: 1, detail: 'no baseline' };
    const p95Ratio = base.latency.p95 > 0 ? current.latency.p95 / base.latency.p95 : 1;
    const throughputRatio = base.throughputPerSec > 0 ? current.throughputPerSec / base.throughputPerSec : 1;
    const regressed = p95Ratio > this.regressionThreshold || throughputRatio < 1 / this.regressionThreshold;
    return { name: current.name, regressed, p95Ratio, throughputRatio, detail: regressed ? `p95 ×${p95Ratio.toFixed(2)}, throughput ×${throughputRatio.toFixed(2)}` : 'within threshold' };
  }

  /** Linear capacity forecast from current throughput at a measured utilization fraction (0..1). */
  forecastCapacity(params: { currentThroughputPerSec: number; utilization: number; targetUtilization?: number }): { projectedMaxThroughputPerSec: number; headroomFactor: number; saturated: boolean } {
    const util = Math.min(1, Math.max(0.0001, params.utilization));
    const target = params.targetUtilization ?? 1;
    const projectedMaxThroughputPerSec = (params.currentThroughputPerSec / util) * target;
    return { projectedMaxThroughputPerSec, headroomFactor: target / util, saturated: util >= target };
  }
}
