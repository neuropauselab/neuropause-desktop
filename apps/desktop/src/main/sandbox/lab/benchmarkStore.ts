/**
 * AI Sandbox — Performance & Security Lab (S5): benchmark store.
 *
 * Stores benchmark history and compares versions (Step 9). It EXTENDS the S1
 * `PersistentStore` (the same atomic-write/debounce substrate every sandbox store uses) —
 * no new persistence layer — and compares with the shared `compareBenchmark` helper.
 */
import { randomUUID } from 'node:crypto';
import { compareBenchmark, type BenchmarkComparison, type BenchmarkRecord, type LabTargetKind } from '@neuropause/shared';
import { PersistentStore } from '../persistentStore';

interface BenchmarkFile {
  records: BenchmarkRecord[];
}

export class BenchmarkStore extends PersistentStore<BenchmarkFile> {
  private records: BenchmarkRecord[] = [];

  constructor(filePath: string, private readonly now: () => number = Date.now) {
    super(filePath, 'sandbox-benchmarks');
  }

  protected snapshot(): BenchmarkFile {
    return { records: this.records };
  }
  protected hydrate(data: Partial<BenchmarkFile>): void {
    this.records = (data.records ?? []).filter((r) => r && r.id);
  }

  record(input: { target: LabTargetKind; metric: string; version: string; value: number }): BenchmarkRecord {
    const rec: BenchmarkRecord = {
      id: `bench_${randomUUID()}`,
      // P13C — a measurement belongs to the tenant that produced it. Unbound
      // and unstamped, one tenant's latency became another's baseline.
      tenantId: this.requireTenant(),
      target: input.target,
      metric: input.metric,
      version: input.version,
      value: input.value,
      at: new Date(this.now()).toISOString(),
    };
    this.records.push(rec);
    this.changed();
    return rec;
  }

  history(target: LabTargetKind, metric: string): BenchmarkRecord[] {
    return this.onlyMine(this.records)
      .filter((r) => r.target === target && r.metric === metric)
      .sort((a, b) => (a.at < b.at ? -1 : 1));
  }

  /**
   * The most recent record for a different version — the baseline to compare
   * against. SCOPED: `regression.ts` copies this number verbatim into
   * `RegressionFinding.baseline`, which lands in a certification report, so an
   * unscoped baseline printed one tenant's measurements inside another's report.
   */
  baseline(target: LabTargetKind, metric: string, currentVersion: string): number | null {
    const prior = this.onlyMine(this.records)
      .filter((r) => r.target === target && r.metric === metric && r.version !== currentVersion)
      .sort((a, b) => (a.at < b.at ? 1 : -1));
    return prior[0]?.value ?? null;
  }

  compareLatest(target: LabTargetKind, metric: string, currentVersion: string, lowerIsBetter = true): BenchmarkComparison | null {
    const current = this.history(target, metric).filter((r) => r.version === currentVersion).slice(-1)[0];
    if (!current) return null;
    return compareBenchmark(current, this.baseline(target, metric, currentVersion), lowerIsBetter);
  }

  all(): BenchmarkRecord[] {
    return this.onlyMine(this.records);
  }
  count(): number {
    return this.all().length;
  }
}
