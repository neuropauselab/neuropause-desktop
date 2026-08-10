/**
 * P13C — the validation and lab stores, found UNBOUND by the second sweep.
 *
 * These two extend the same `PersistentStore` the five S1 sandbox stores do,
 * and gained the same `bindScope` seam in the same change. Nobody bound them.
 * `hasScope()` existed with zero callers, which is precisely how that happens
 * and precisely why `initSandbox` now throws on an unbound store.
 *
 * What was reachable:
 *   · `sandbox:validation.run.get` took a runId from the payload and returned
 *     the cached detail — including a certification report carrying that
 *     tenant's live executive KPI figures, plus markdown/HTML/JSON exports.
 *   · `sandbox:validation.summary` and `.dashboard` returned every tenant's run
 *     history, which is also where the runIds for the above came from.
 *   · A benchmark baseline is copied verbatim into the next run's regression
 *     findings, so one tenant's measured latency appeared inside another
 *     tenant's certification report.
 *
 * `sandbox:read` is in the base read-only role, so every member of every tenant
 * could call all three.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TenantScope, ValidationRun } from '@neuropause/shared';
import { ValidationRunStore } from '../sandbox/validation/runStore';
import { BenchmarkStore } from '../sandbox/lab/benchmarkStore';
import { OTHER_TENANT_SCOPE, TEST_TENANT_SCOPE } from './testScope';

const A = TEST_TENANT_SCOPE;
const B = OTHER_TENANT_SCOPE;

let scope: TenantScope | null = A;
let dir: string;
let runs: ValidationRunStore;
let benchmarks: BenchmarkStore;

function run(id: string, marker: string): ValidationRun {
  return {
    id,
    pipeline: 'release-candidate',
    trigger: 'manual',
    status: 'passed',
    startedAt: '2026-08-11T00:00:00.000Z',
    finishedAt: '2026-08-11T00:01:00.000Z',
    durationMs: 60_000,
    stages: [{ id: 's1', name: marker, status: 'pass' } as never],
    metrics: { kpi: marker.length },
    certificationLevel: 'certified',
    regressionCount: 0,
  } as ValidationRun;
}

beforeEach(async () => {
  dir = join(tmpdir(), `np-val-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  const src = (): TenantScope | null => scope;
  runs = new ValidationRunStore(join(dir, 'runs.json')).bindScope(src);
  benchmarks = new BenchmarkStore(join(dir, 'bench.json'), () => Date.now()).bindScope(src);
  await Promise.all([runs.load(), benchmarks.load()]);
  scope = A;
});

afterEach(async () => {
  for (const s of [runs, benchmarks]) await s.flush().catch(() => {});
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});

const MARK_A = 'NP-VALIDATION-A-9812';
const MARK_B = 'NP-VALIDATION-B-4721';

describe('validation runs are per tenant', () => {
  it('A cannot get B’s run by runId', () => {
    scope = A;
    runs.add(run('run-a', MARK_A));
    scope = B;
    runs.add(run('run-b', MARK_B));

    scope = A;
    expect(runs.get('run-b')).toBeNull();
    scope = B;
    expect(runs.get('run-a')).toBeNull();
  });

  it('each tenant CAN read their own run', () => {
    scope = A;
    runs.add(run('run-a', MARK_A));
    expect(runs.get('run-a')?.id).toBe('run-a');
  });

  it('history and recent never span tenants — and history is where runIds leak from', () => {
    scope = A;
    runs.add(run('run-a', MARK_A));
    scope = B;
    runs.add(run('run-b', MARK_B));

    scope = A;
    expect(runs.history().map((h) => h.runId)).toEqual(['run-a']);
    expect(runs.recent().map((r) => r.id)).toEqual(['run-a']);
    expect(runs.count()).toBe(1);
    expect(JSON.stringify(runs.all())).not.toContain(MARK_B);
  });

  it('B cannot OVERWRITE A’s run by re-using its id', () => {
    scope = A;
    runs.add(run('run-a', MARK_A));
    scope = B;
    runs.update(run('run-a', 'HIJACKED'));

    scope = A;
    expect(runs.get('run-a')?.stages[0]?.name).toBe(MARK_A);
  });

  it('an unresolved tenant reads nothing and cannot add', () => {
    scope = A;
    runs.add(run('run-a', MARK_A));
    scope = null;
    expect(runs.all()).toEqual([]);
    expect(runs.get('run-a')).toBeNull();
    expect(() => runs.add(run('orphan', 'X'))).toThrow(/no owner/i);
  });

  it('an UNBOUND store denies', async () => {
    const unbound = new ValidationRunStore(join(dir, 'unbound.json'));
    await unbound.load();
    expect(unbound.hasScope()).toBe(false);
    expect(unbound.all()).toEqual([]);
    expect(() => unbound.add(run('x', 'X'))).toThrow(/no owner/i);
  });
});

describe('benchmark baselines are per tenant', () => {
  /**
   * The disclosure path is indirect and worth naming: `regression.ts` copies
   * `baseline` verbatim into a `RegressionFinding`, which lands in a
   * certification report the other tenant reads.
   */
  it('A’s measurement never becomes B’s baseline', () => {
    scope = A;
    benchmarks.record({ target: 'api', metric: 'latencyMs', version: '1.0.0', value: 111 });
    scope = B;
    benchmarks.record({ target: 'api', metric: 'latencyMs', version: '1.0.0', value: 999 });

    // B compares a NEW version against a prior one: only B's own 999 qualifies.
    scope = B;
    expect(benchmarks.baseline('api', 'latencyMs', '2.0.0')).toBe(999);
    scope = A;
    expect(benchmarks.baseline('api', 'latencyMs', '2.0.0')).toBe(111);
  });

  it('history and counts are scoped', () => {
    scope = A;
    benchmarks.record({ target: 'api', metric: 'latencyMs', version: '1.0.0', value: 111 });
    scope = B;
    benchmarks.record({ target: 'api', metric: 'latencyMs', version: '1.0.0', value: 999 });

    scope = A;
    expect(benchmarks.history('api', 'latencyMs').map((r) => r.value)).toEqual([111]);
    expect(benchmarks.count()).toBe(1);
  });

  it('a tenant with no measurements has NO baseline, rather than borrowing one', () => {
    scope = A;
    benchmarks.record({ target: 'api', metric: 'latencyMs', version: '1.0.0', value: 111 });
    scope = B;
    expect(benchmarks.baseline('api', 'latencyMs', '2.0.0')).toBeNull();
  });

  it('an unresolved tenant cannot record', () => {
    scope = null;
    expect(() =>
      benchmarks.record({ target: 'api', metric: 'latencyMs', version: '1.0.0', value: 1 }),
    ).toThrow(/no owner/i);
  });
});
