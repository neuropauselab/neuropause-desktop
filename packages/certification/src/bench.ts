/**
 * Production Benchmark harness (NCEA 16.0, deliverable 10). REAL wall-clock
 * measurements (via `performance.now()`) over the actual composed platform —
 * startup, memory, audit-append latency, envelope-crypto throughput, authorization
 * latency, governed AI inference, job throughput, embedded-Postgres throughput +
 * recovery time, and a composed end-to-end workflow. These are single-node,
 * in-container micro-benchmarks — traceable and reproducible (re-run the harness),
 * but NOT production-scale. Numbers requiring real network, concurrency, managed
 * databases, or production hardware are called out as limitations and remain
 * PILOT-VERIFIED / INFRA-PENDING — never presented as production figures.
 */
import { performance } from 'node:perf_hooks';
import { systemClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createSecurityPlatform } from '@neuropause/security';
import { createOperationsPlatform } from '@neuropause/operations';
import { createAiRuntime, FakeProvider } from '@neuropause/ai-runtime';
import { createPgliteDriver, createPersistenceLayer, TableRepository, type Entity } from '@neuropause/persistence';

export interface BenchResult {
  name: string;
  unit: string;
  value: number;
  iterations?: number;
  note?: string;
}
export interface BenchmarkReport {
  node: string;
  at: number;
  results: BenchResult[];
  limitations: string[];
}

interface Ws extends Entity {
  id: string;
  name: string;
}

const round = (n: number): number => Math.round(n * 1000) / 1000;

export async function runBenchmarks(opts: { db?: boolean; at?: number } = {}): Promise<BenchmarkReport> {
  const results: BenchResult[] = [];
  const push = (name: string, unit: string, value: number, iterations?: number, note?: string): void => {
    results.push({ name, unit, value: round(value), ...(iterations !== undefined ? { iterations } : {}), ...(note !== undefined ? { note } : {}) });
  };

  // 1. Startup — build + start the composed platform.
  const s0 = performance.now();
  const runtime = createEnterpriseRuntime({ clock: systemClock });
  const security = createSecurityPlatform(runtime, {});
  const operations = createOperationsPlatform(runtime, {});
  const ai = createAiRuntime(runtime);
  await runtime.start();
  push('Platform startup (runtime + security + operations + ai)', 'ms', performance.now() - s0);

  // 2. Memory after full init.
  const mem = process.memoryUsage();
  push('Memory after init — RSS', 'MB', mem.rss / 1048576);
  push('Memory after init — heap used', 'MB', mem.heapUsed / 1048576);

  // 3. Audit append latency (hash-linked chain).
  {
    const N = 20000;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) runtime.audit().append({ actor: 'bench', action: 'op.bench', target: 't', deviceId: 'bench', at: i, dataHash: `h${i}` });
    const dt = performance.now() - t0;
    push('Audit append latency', 'us/op', (dt * 1000) / N, N);
    push('Audit append throughput', 'ops/sec', N / (dt / 1000), N);
  }

  // 4. Envelope crypto throughput (real AES-256-GCM).
  {
    const N = 2000;
    const km = security.keys();
    const t0 = performance.now();
    for (let i = 0; i < N; i++) km.decrypt('acme', km.encrypt('acme', `secret-${i}`));
    const dt = performance.now() - t0;
    push('Envelope encrypt+decrypt (AES-256-GCM)', 'us/op', (dt * 1000) / N, N);
    push('Envelope crypto throughput', 'ops/sec', N / (dt / 1000), N);
  }

  // 5. Authorization decision latency (RBAC+ABAC).
  {
    security.authorization().defineRole({ id: 'editor', name: 'Editor', permissions: ['workspace:read', 'workspace:write'] });
    const subject = { id: 'u1', roles: ['editor'] };
    const N = 20000;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) security.authorization().authorize({ subject, action: 'read', resource: { type: 'workspace' } });
    push('Authorization decision (RBAC+ABAC)', 'us/op', ((performance.now() - t0) * 1000) / N, N);
  }

  // 6. Governed AI inference (deterministic fake provider — no network).
  {
    ai.providers().register(new FakeProvider('fake', ['fake-1']));
    const N = 2000;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) await ai.ai().generate({ model: 'fake-1', messages: [{ role: 'user', content: 'ping' }] });
    push('Governed AI inference (fake provider)', 'ms/op', (performance.now() - t0) / N, N, 'excludes real-model network latency (INFRA-PENDING)');
  }

  // 7. Job enqueue + drain throughput.
  {
    const q = operations.jobs();
    q.registerHandler('noop', async () => undefined);
    const N = 5000;
    for (let i = 0; i < N; i++) q.enqueue({ type: 'noop', payload: {} });
    const t0 = performance.now();
    await q.drain();
    push('Job enqueue+drain throughput', 'ops/sec', N / ((performance.now() - t0) / 1000), N);
  }

  // 8. Embedded Postgres — boot, throughput, and recovery time (real engine).
  if (opts.db !== false) {
    try {
      const b0 = performance.now();
      const db = await createPgliteDriver();
      push('Embedded Postgres boot (PGlite/WASM)', 'ms', performance.now() - b0, undefined, 'in-container WASM; sub-second on native/managed');
      const layer = createPersistenceLayer({ driver: db });
      await layer.migrate();
      await layer.tenants().create('acme', 'Acme');
      const repo = new TableRepository<Ws>(db, 'workspaces', systemClock);
      const N = 400;
      const t0 = performance.now();
      for (let i = 0; i < N; i++) await repo.upsert('acme', { id: `w${i}`, name: `W${i}` });
      push('Postgres upsert throughput', 'ops/sec', N / ((performance.now() - t0) / 1000), N);
      const q0 = performance.now();
      await repo.count('acme');
      push('Postgres count query', 'ms', performance.now() - q0);
      const bundle = await layer.backup().full();
      await db.exec('DELETE FROM workspaces');
      const r0 = performance.now();
      await layer.backup().restore(bundle);
      push('Recovery time — backup restore (RTO)', 'ms', performance.now() - r0, undefined, 'in-container dataset; not production volume');
      await db.close();
    } catch (e) {
      push('Embedded Postgres benchmark', 'n/a', 0, undefined, `skipped: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 9. Composed end-to-end workflow latency (authorize → governed AI → audit).
  {
    const subject = { id: 'u1', roles: ['editor'] };
    const N = 200;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      security.authorization().authorize({ subject, action: 'read', resource: { type: 'workspace' } });
      await ai.ai().generate({ model: 'fake-1', messages: [{ role: 'user', content: 'q' }] });
      runtime.audit().append({ actor: 'u1', action: 'op.workflow', target: 'wf', deviceId: 'bench', at: i, dataHash: `w${i}` });
    }
    push('Composed workflow (authorize → AI → audit)', 'ms/op', (performance.now() - t0) / N, N);
  }

  await runtime.stop();

  return {
    node: process.version,
    at: opts.at ?? 0,
    results,
    limitations: [
      'Single-node, in-container micro-benchmarks — not production-scale figures.',
      'Embedded Postgres (PGlite/WASM) stands in for managed Postgres; native/managed clusters are faster.',
      'AI inference uses a deterministic fake provider; real-model network latency is INFRA-PENDING.',
      'No concurrent load, real network, or production hardware — those numbers are PILOT-VERIFIED.',
    ],
  };
}
