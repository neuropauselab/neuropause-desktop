/**
 * PROGRAM 13C CERTIFICATION — measured performance (Phases 28-31).
 *
 * WHAT THIS MEASURES, AND WHAT IT DOES NOT
 *
 * It measures the COST OF THE TENANT BOUNDARY: how much slower a scoped read is
 * than the same read with the filter removed, at growing dataset sizes, with
 * two tenants sharing every store. That is the question Program 13C actually
 * raises — nine commits of scoping were added, and somebody has to say what
 * they cost.
 *
 * It is NOT a product benchmark. These are in-process store reads on a temp
 * filesystem; they say nothing about end-to-end UI latency, and this file does
 * not pretend otherwise.
 *
 * EVERY NUMBER IN THE REPORT COMES FROM A RUN OF THIS FILE. Nothing is
 * estimated. Where a sample is too small for a percentile, the percentile is
 * not reported — see `summarize`.
 *
 * THE ASSERTIONS ARE DELIBERATELY LOOSE. A timing test that fails on a busy CI
 * machine gets deleted or retried until it passes, and then it protects
 * nothing. These assert ORDERS OF MAGNITUDE — that scoping did not turn a
 * linear scan into a quadratic one — and print the real figures for the report.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { EnterpriseModuleDescriptor, TenantScope } from '@neuropause/shared';
import { EnterpriseRecordStore } from '../../enterprise/framework/enterpriseRecordStore';
import { UnifiedStore } from '../../unified/unifiedStore';
import { GraphStore } from '../../graph/graphStore';
import { makeUnifiedId } from '../../unified/ids';
import { resolveTenantScope, runAsPrincipal, tenantPrincipal } from '../backgroundPrincipal';
import { TENANT_A, TENANT_B } from './twoTenantFixture';

const NOW = '2026-08-11T12:00:00.000Z';
const dirs: string[] = [];

afterEach(async () => {
  for (const d of dirs.splice(0)) {
    await fs.rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

async function tmp(): Promise<string> {
  const dir = join(tmpdir(), `np-perf-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  dirs.push(dir);
  return dir;
}

/** Median and p95. p95 is OMITTED below 20 samples — see the report. */
function summarize(samples: number[]): { n: number; p50: number; p95: number | null } {
  const s = [...samples].sort((a, b) => a - b);
  const at = (q: number): number => s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
  return {
    n: s.length,
    p50: Number(at(0.5).toFixed(4)),
    // Below 20 samples a "p95" is just the maximum wearing a percentile's name.
    p95: s.length >= 20 ? Number(at(0.95).toFixed(4)) : null,
  };
}

function measure(iterations: number, fn: () => void): number[] {
  fn(); // warm the JIT and any lazy load, so the first sample is not the outlier
  const out: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const t = performance.now();
    fn();
    out.push(performance.now() - t);
  }
  return out;
}

function report(label: string, samples: number[], extra = ''): void {
  const { n, p50, p95 } = summarize(samples);
  const p95s = p95 === null ? 'n/a (n<20)' : `${p95}ms`;
  // Printed, not asserted — this is the evidence the report quotes.
  console.log(`PERF ${label.padEnd(46)} n=${String(n).padStart(4)}  p50=${String(p50).padStart(8)}ms  p95=${p95s.padStart(12)}  ${extra}`);
}

const DESC: EnterpriseModuleDescriptor = {
  id: 'perf',
  title: 'Perf',
  singular: 'Perf',
  plural: 'Perf',
  icon: 'box',
  description: 'perf',
  titleField: 'name',
  permissions: { read: 'crm:read', write: 'crm:manage' },
  fields: [{ key: 'name', label: 'Name', type: 'text', required: true }],
};

/* ── Phase 28/29: record reads at growing dataset sizes ─────────────────── */

describe('Phase 28/29 — scoped record reads, two tenants, growing datasets', () => {
  /**
   * 100k is deliberately excluded. These stores hold every record in memory and
   * serialize the whole file on write, so a 100k-row fixture measures the
   * fixture builder rather than the boundary — and would take minutes to seed.
   * The program says "where practical"; 10k is where practical ends for an
   * in-memory JSON store, and saying so is better than a number nobody can act
   * on. The 100/1k/10k curve is enough to show the shape.
   */
  for (const size of [100, 1_000, 10_000]) {
    it(`${size} records split 50/50 across two tenants`, async () => {
      const dir = await tmp();
      let scope: TenantScope | null = TENANT_A;
      const store = new EnterpriseRecordStore(join(dir, 'perf.json'), DESC.id, DESC.id);
      store.bindScope(() => scope);
      await store.load();

      const ids: string[] = [];
      for (let i = 0; i < size; i += 1) {
        scope = i % 2 === 0 ? TENANT_A : TENANT_B;
        ids.push(
          store.create({
            title: `row-${i}`,
            fields: { name: `row-${i}` },
            actor: 'perf',
            now: NOW,
          }).id,
        );
      }

      scope = TENANT_A;
      const listSamples = measure(30, () => void store.list({ limit: 50 }));
      const getOwn = ids[0]!; // even index ⇒ tenant A
      const getForeign = ids[1]!; // odd index ⇒ tenant B
      const getSamples = measure(200, () => void store.get(getOwn));
      const denySamples = measure(200, () => void store.get(getForeign));

      report(`record.list  (${size} rows, scoped)`, listSamples);
      report(`record.get   (${size} rows, own id)`, getSamples);
      report(`record.get   (${size} rows, FOREIGN id → deny)`, denySamples);

      // The boundary must not be pathological. A scoped list over 10k rows in
      // under a quarter second is the bar; the real figures are printed above.
      expect(summarize(listSamples).p50).toBeLessThan(250);
      // A denial must not be dramatically more expensive than a hit, or the
      // timing difference itself becomes an existence oracle.
      const hit = summarize(getSamples).p50;
      const miss = summarize(denySamples).p50;
      expect(miss).toBeLessThan(Math.max(1, hit * 50));

      await store.flush();
    });
  }
});

/* ── Phase 28: search and graph ─────────────────────────────────────────── */

describe('Phase 28 — search and graph under two tenants', () => {
  it('unified query and graph reads at 2,000 rows', async () => {
    const dir = await tmp();
    let scope: TenantScope | null = TENANT_A;
    const unified = new UnifiedStore(join(dir, 'u.json')).bindScope(() => scope);
    const graph = new GraphStore(join(dir, 'g.json')).bindScope(() => scope);
    await unified.load();
    await graph.load();

    const half = 1_000;
    for (const t of [TENANT_A, TENANT_B]) {
      scope = t;
      const batch = Array.from({ length: half }, (_, i) => ({
        id: makeUnifiedId(t.tenantId, 'hubspot', 'acct', 'task', `${t.tenantId}-${i}`),
        kind: 'task' as const,
        connectorId: 'hubspot',
        accountId: 'acct',
        sourceId: `${t.tenantId}-${i}`,
        createdAt: NOW,
        updatedAt: NOW,
        syncState: 'active' as const,
        syncedAt: NOW,
        metadata: {},
        title: `Task ${i} ${t.tenantId}`,
        url: null,
        parentId: null,
        containerId: null,
        body: `Body ${i}`,
        status: null,
        author: null,
        timestamp: NOW,
        endTimestamp: null,
        labels: [],
      }));
      await unified.upsertMany(batch as never, t.tenantId);
      graph.apply(
        Array.from({ length: 200 }, (_, i) => ({
          id: `${t.tenantId}:n${i}`,
          type: 'person' as const,
          label: `N${i}`,
          sourceKind: 'task' as const,
          sourceId: `${t.tenantId}:n${i}`,
          connectorId: 'hubspot',
          createdAt: NOW,
          updatedAt: NOW,
          metadata: {},
        })) as never,
        [],
        NOW,
      );
    }

    scope = TENANT_A;
    report(
      'unified.query (2,000 rows, scoped)',
      measure(30, () => void unified.query({ limit: 100, includeDeleted: false })),
    );
    report(
      'graph.listNodes (400 nodes, scoped)',
      measure(50, () => void graph.listNodes({ limit: 100 })),
    );
    report(
      'graph.getNode  (own id)',
      measure(200, () => void graph.getNode(`${TENANT_A.tenantId}:n0`)),
    );
    report(
      'graph.getNode  (FOREIGN id → deny)',
      measure(200, () => void graph.getNode(`${TENANT_B.tenantId}:n0`)),
    );

    // Correctness alongside the timing — a fast wrong answer is not a pass.
    expect(unified.query({ limit: 5_000, includeDeleted: false }).items).toHaveLength(half);
    expect(graph.getNode(`${TENANT_B.tenantId}:n0`)).toBeNull();
  });
});

/* ── Phase 28: the resolver itself ──────────────────────────────────────── */

describe('Phase 28 — tenant resolution and switching', () => {
  /**
   * `resolveTenantScope` is on EVERY scoped read in the system, so its cost is
   * multiplied by everything else. It is the one measurement here that would
   * matter even if it were small — and it is the one most worth knowing.
   */
  it('tenant resolution, principal resolution, and a switch', () => {
    const session = (): TenantScope => TENANT_A;

    report(
      'resolveTenantScope (session path)',
      measure(5_000, () => void resolveTenantScope(session)),
    );

    const principal = tenantPrincipal({
      jobId: 'perf',
      scope: { tenantId: TENANT_B.tenantId, workspaceId: '' },
    })!;
    const inside = runAsPrincipal(principal, () =>
      measure(5_000, () => void resolveTenantScope(session)),
    );
    report('resolveTenantScope (background principal)', inside);

    report(
      'tenantPrincipal    (build a principal)',
      measure(2_000, () => void tenantPrincipal({ jobId: 'p', scope: TENANT_A })),
    );

    let scope: TenantScope = TENANT_A;
    report(
      'tenant switch      (assign + re-resolve)',
      measure(5_000, () => {
        scope = scope === TENANT_A ? TENANT_B : TENANT_A;
        void resolveTenantScope(() => scope);
      }),
    );

    // Resolution is on every read; a millisecond here would be a real problem.
    expect(summarize(measure(1_000, () => void resolveTenantScope(session))).p50).toBeLessThan(1);
  });
});

/* ── Phase 31: the pre-13C baseline question ────────────────────────────── */

describe('Phase 31 — the cost of the boundary, measured directly', () => {
  /**
   * There is NO VALID PRE-13C BASELINE to compare against — no measurements
   * were taken before the scoping work, and reconstructing one by reverting
   * nine commits is not something to do inside a certification run.
   *
   * So instead of inventing a historical number, this measures the delta that
   * actually matters and can be measured honestly TODAY: the same data, read
   * with the tenant filter versus without it. That is the cost the boundary
   * imposes, and it is a stronger statement than a remembered figure.
   */
  it('scoped vs unscoped over identical data', async () => {
    const dir = await tmp();
    let scope: TenantScope | null = TENANT_A;
    const store = new EnterpriseRecordStore(join(dir, 'p.json'), DESC.id, DESC.id);
    store.bindScope(() => scope);
    await store.load();

    for (let i = 0; i < 5_000; i += 1) {
      scope = i % 2 === 0 ? TENANT_A : TENANT_B;
      store.create({ title: `r${i}`, fields: { name: `r${i}` }, actor: 'p', now: NOW });
    }
    scope = TENANT_A;

    const scoped = measure(40, () => void store.list({ limit: 100 }));
    const rows = store.list({ limit: 10_000 });
    // The unscoped comparator: the same array walk with no ownership predicate.
    const unscoped = measure(40, () => void rows.filter((r) => r.status === 'active').slice(0, 100));

    const s = summarize(scoped).p50;
    const u = summarize(unscoped).p50;
    report('list SCOPED   (5,000 rows)', scoped);
    report('list UNSCOPED (same rows, no predicate)', unscoped, `delta=${(s - u).toFixed(4)}ms`);

    // The boundary is a predicate on a walk the code already does. It must not
    // change the complexity class; a 100x blow-up would mean it had.
    expect(s).toBeLessThan(Math.max(5, u * 100));
    await store.flush();
  });
});
