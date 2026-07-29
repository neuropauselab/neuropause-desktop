import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime, type EnterpriseRuntime } from '@neuropause/runtime';
import { createPgliteDriver, type PgliteDriver } from '@neuropause/persistence';
import { createNemsPlatform, systemContext, type NemsPlatform } from '@neuropause/nems';
import { createIntelligencePlatform, type IntelligencePlatform } from './platform';

async function seed(nems: NemsPlatform) {
  const acme = (await nems.organizations().create({ name: 'Acme', slug: 'acme' })).id;
  const globex = (await nems.organizations().create({ name: 'Globex', slug: 'globex' })).id;
  const ada = await nems.users().create(systemContext(acme), { email: 'ada@acme.test', password: 'pw', displayName: 'Ada Lovelace', roles: ['executive'] });
  await nems.users().create(systemContext(acme), { email: 'bob@acme.test', password: 'pw', displayName: 'Bob Stone' });
  const obj = await nems.okrs().createObjective(systemContext(acme), { title: 'Ship Wave 3', period: '2026-Q3', ownerId: ada.id });
  const kr = await nems.okrs().addKeyResult(systemContext(acme), obj.id, { title: 'Modules complete', target: 14 });
  await nems.okrs().updateKeyResult(systemContext(acme), kr.id, { current: 7, progress: 50 });
  const risky = await nems.okrs().createObjective(systemContext(acme), { title: 'Reliability', period: '2026-Q3' });
  await nems.okrs().setObjectiveStatus(systemContext(acme), risky.id, 'at-risk');
  await nems.okrs().createTask(systemContext(acme), { title: 'Write Wave 3 tests' });
  await nems.dashboards().create(systemContext(acme), { name: 'Exec Board', scope: 'executive' });
  return { acme, globex, ada: ada.id, obj: obj.id, kr: kr.id };
}

describe('Modules 1,2,7 — Knowledge Graph, Memory, Timeline (real Postgres + real NEMS)', () => {
  let runtime: EnterpriseRuntime;
  let driver: PgliteDriver;
  let nems: NemsPlatform;
  let intel: IntelligencePlatform;
  let ids: Awaited<ReturnType<typeof seed>>;

  beforeAll(async () => {
    const clock = new ManualClock(1_000_000);
    runtime = createEnterpriseRuntime({ clock });
    driver = await createPgliteDriver();
    nems = createNemsPlatform(runtime, { driver, clock });
    await nems.migrate();
    ids = await seed(nems);
    intel = await createIntelligencePlatform(runtime, { driver, nems, clock });
  });
  afterAll(async () => {
    await driver.close();
  });

  it('builds a knowledge graph from real NEMS entities, with evidence pointing back to source', async () => {
    const g = await intel.graph(ids.acme);
    const stats = g.stats(ids.acme);
    expect(stats.byType.organization).toBe(1);
    expect(stats.byType.user).toBe(2);
    expect(stats.byType.objective).toBe(2);
    expect(stats.byType.key_result).toBe(1);
    expect(stats.byType.task).toBeGreaterThanOrEqual(1);
    expect(stats.byType.dashboard).toBe(1);
    // every node is grounded in a real source row
    const obj = g.get(ids.obj)!;
    expect(obj.evidence[0]).toMatchObject({ kind: 'nems.objective', id: ids.obj, source: 'nems' });
  });

  it('links relationships — objective measures its key results, owner owns objective', async () => {
    const g = await intel.graph(ids.acme);
    const krs = g.neighbors(ids.obj, 'measures');
    expect(krs.some((k) => k.id === ids.kr)).toBe(true);
    const owned = g.neighbors(ids.ada, 'owns');
    expect(owned.some((o) => o.id === ids.obj)).toBe(true);
  });

  it('isolates tenants — Globex graph does not contain Acme entities', async () => {
    const gg = await intel.graph(ids.globex);
    expect(gg.get(ids.obj)).toBeUndefined();
    expect(gg.stats(ids.globex).byType.objective ?? 0).toBe(0);
  });

  it('persists enterprise memory: store, version, retrieve, summarize, expire, audit', async () => {
    const mem = intel.memory();
    const auditBefore = runtime.audit().list().length;
    await mem.store(ids.acme, 'decision', 'wave3', 'stack-choice', { choice: 'compose, not duplicate' });
    const v2 = await mem.store(ids.acme, 'decision', 'wave3', 'stack-choice', { choice: 'reuse ai-runtime' });
    expect(v2.version).toBe(2);
    const latest = await mem.retrieve(ids.acme, 'decision', 'wave3', 'stack-choice');
    expect((latest!.value as { choice: string }).choice).toBe('reuse ai-runtime');
    expect((await mem.history(ids.acme, 'decision', 'wave3', 'stack-choice')).length).toBe(2);
    expect(await mem.summarize(ids.acme, 'decision', 'wave3')).toContain('decision memory');
    // memory writes are audited on the one chain
    expect(runtime.audit().list().length).toBeGreaterThan(auditBefore);
  });

  it('expires memory past its TTL', async () => {
    const clock = new ManualClock(5_000);
    const d2 = await createPgliteDriver();
    try {
      const rt = createEnterpriseRuntime({ clock });
      const mem = (await createIntelligencePlatform(rt, { driver: d2, nems, clock })).memory();
      await mem.store('t', 'incident', 's', 'k', { x: 1 }, { ttlMs: 1000 });
      expect(await mem.retrieve('t', 'incident', 's', 'k')).toBeTruthy();
      clock.set(7_000); // past ttl (5000 + 1000)
      expect(await mem.retrieve('t', 'incident', 's', 'k')).toBeUndefined();
      expect(await mem.expire('t')).toBe(1);
    } finally {
      await d2.close();
    }
  });

  it('builds a unified, track-classified timeline from real platform events', async () => {
    const tl = await intel.timeline(ids.acme);
    const events = tl.unified(ids.acme);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e, i) => i === 0 || events[i - 1].at <= e.at)).toBe(true); // chronological
    const byTrack = tl.byTrack(ids.acme);
    expect(byTrack.engineering).toBeGreaterThan(0); // NEMS OKR/task mutations
  });
});
