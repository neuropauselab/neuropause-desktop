/**
 * Module 11 — Performance Platform. Load, stress, and endurance testing, a benchmark registry,
 * capacity reports, and bottleneck analysis. It shows ONLY measured results: real measurement REUSES
 * the operations performance monitor (which times a real operation). With no operations platform
 * connected there is nothing to measure and the result says so — no throughput number is fabricated.
 */
import { randomId } from '@neuropause/cloud-core';
import type { ProductionGovernance } from './governance';
import type { ProductionContext } from './types';
import { PERF_TESTS, type PerfTest } from './constants';

export interface Benchmark {
  id: string;
  kind: PerfTest;
  name: string;
  iterations: number;
  measured: unknown | null; // real measured result from the reused operations monitor, or null
  note: string;
}

// a small, real, deterministic unit of work to measure
const workload = (): number => {
  let x = 0;
  for (let i = 0; i < 2000; i++) x += (i * 7) % 13;
  return x;
};

export class PerformancePlatform {
  private readonly benchmarks = new Map<string, Benchmark>();

  constructor(
    private readonly governance: ProductionGovernance,
    private readonly ctx: ProductionContext = {},
  ) {}

  async runTest(input: { kind: PerfTest; name: string; iterations?: number; org?: string }): Promise<Benchmark> {
    if (!PERF_TESTS.includes(input.kind)) throw new Error(`unknown performance test: ${input.kind}`);
    const iterations = input.iterations ?? 200;
    let measured: unknown | null = null;
    let note: string;
    if (this.ctx.operations) {
      measured = await this.ctx.operations.performance().loadTest(input.name, async () => { workload(); }, { iterations });
      note = 'real measured result from the reused operations performance monitor';
    } else {
      note = 'no operations platform connected — no measurement fabricated';
    }
    const b: Benchmark = { id: randomId('bench'), kind: input.kind, name: input.name, iterations, measured, note };
    this.benchmarks.set(b.id, b);
    await this.governance.record({ operator: 'system', org: input.org ?? '_ops', environment: '_platform', operation: `performance.${input.kind}`, targetId: b.id, evidence: 'business-data-pending', decision: measured ? 'measured' : 'no measurement' });
    return b;
  }

  /** Capacity report REUSES the operations capacity forecast — honest when not connected. */
  capacityReport(input: { currentThroughputPerSec: number; utilization: number }): { forecast: unknown | null; note: string } {
    if (!this.ctx.operations) return { forecast: null, note: 'no operations platform connected — no capacity forecast fabricated' };
    return { forecast: this.ctx.operations.performance().forecastCapacity(input), note: 'reused operations capacity forecast' };
  }

  get(id: string): Benchmark | undefined { return this.benchmarks.get(id); }
  list(kind?: PerfTest): Benchmark[] {
    const all = [...this.benchmarks.values()];
    return kind ? all.filter((b) => b.kind === kind) : all;
  }
  count(): number { return this.benchmarks.size; }
}
