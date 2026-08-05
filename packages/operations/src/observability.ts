/**
 * Observability Expansion (NCEA 15.0, Phase 6). Projects the ONE runtime metrics
 * registry into a unified operations view — it reads `runtime.observability()
 * .metrics.snapshot()` and groups counters by subsystem namespace (runtime,
 * connector, provider/ai, sync, webhook, security, persistence, ops) rather than
 * standing up a second metrics store. It adds the operational dimensions the raw
 * registry lacks: latency percentiles, error/throughput tallies, queue depth, and
 * worker occupancy — all fed back into the same registry as gauges/counters.
 */
import { systemClock, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';

export interface LatencyStats {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? 0;
}

export interface OpsDashboard {
  at: number;
  subsystems: Record<string, Record<string, number>>;
  gauges: Record<string, number>;
  latency: Record<string, LatencyStats>;
  errors: Record<string, number>;
  throughput: Record<string, number>;
  queues: Record<string, number>;
  workers: Record<string, { active: number }>;
}

export class OperationsObservability {
  private readonly latencies = new Map<string, number[]>();
  private readonly errorCounts = new Map<string, number>();
  private readonly throughputCounts = new Map<string, number>();
  private readonly queueDepths = new Map<string, number>();
  private readonly workerOccupancy = new Map<string, { active: number }>();

  constructor(
    private readonly runtime?: EnterpriseRuntime,
    private readonly clock: Clock = systemClock,
  ) {}

  private metrics(): { inc(name: string, by?: number): void; set(name: string, value: number): void; snapshot(): { counters: Record<string, number>; gauges: Record<string, number> } } | undefined {
    return this.runtime?.observability().metrics;
  }

  recordLatency(op: string, ms: number): void {
    const arr = this.latencies.get(op) ?? [];
    arr.push(ms);
    this.latencies.set(op, arr);
    this.metrics()?.set(`ops.latency.${op}.last_ms`, ms);
  }
  recordError(subsystem: string): void {
    this.errorCounts.set(subsystem, (this.errorCounts.get(subsystem) ?? 0) + 1);
    this.metrics()?.inc(`ops.error.${subsystem}`);
  }
  recordThroughput(op: string, n = 1): void {
    this.throughputCounts.set(op, (this.throughputCounts.get(op) ?? 0) + n);
    this.metrics()?.inc(`ops.throughput.${op}`, n);
  }
  recordQueueDepth(queue: string, depth: number): void {
    this.queueDepths.set(queue, depth);
    this.metrics()?.set(`ops.queue.${queue}.depth`, depth);
  }
  recordWorker(worker: string, active: number): void {
    this.workerOccupancy.set(worker, { active });
    this.metrics()?.set(`ops.worker.${worker}.active`, active);
  }

  latencyStats(op: string): LatencyStats {
    const arr = [...(this.latencies.get(op) ?? [])].sort((a, b) => a - b);
    return { count: arr.length, p50: percentile(arr, 50), p95: percentile(arr, 95), p99: percentile(arr, 99), max: arr[arr.length - 1] ?? 0 };
  }

  private groupedCounters(): { subsystems: Record<string, Record<string, number>>; gauges: Record<string, number> } {
    const snap = this.metrics()?.snapshot() ?? { counters: {}, gauges: {} };
    const subsystems: Record<string, Record<string, number>> = {};
    for (const [k, v] of Object.entries(snap.counters)) {
      const ns = k.split('.')[0] ?? 'other';
      (subsystems[ns] ??= {})[k] = v;
    }
    return { subsystems, gauges: snap.gauges };
  }

  /** The unified operations dashboard — one view over the one metrics registry plus the operational dimensions. */
  dashboard(): OpsDashboard {
    const { subsystems, gauges } = this.groupedCounters();
    const latency: Record<string, LatencyStats> = {};
    for (const op of this.latencies.keys()) latency[op] = this.latencyStats(op);
    return {
      at: this.clock.now(),
      subsystems,
      gauges,
      latency,
      errors: Object.fromEntries(this.errorCounts),
      throughput: Object.fromEntries(this.throughputCounts),
      queues: Object.fromEntries(this.queueDepths),
      workers: Object.fromEntries(this.workerOccupancy),
    };
  }
}
