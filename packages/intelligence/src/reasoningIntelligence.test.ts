import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime, type EnterpriseRuntime } from '@neuropause/runtime';
import { createPgliteDriver, type PgliteDriver } from '@neuropause/persistence';
import { createNemsPlatform, systemContext, type NemsPlatform } from '@neuropause/nems';
import { createIntelligencePlatform, type IntelligencePlatform } from './platform';

async function seed(nems: NemsPlatform) {
  const acme = (await nems.organizations().create({ name: 'Acme', slug: 'acme' })).id;
  const globex = (await nems.organizations().create({ name: 'Globex', slug: 'globex' })).id;
  const ctx = systemContext(acme);
  const ada = await nems.users().create(ctx, { email: 'ada@acme.test', password: 'pw', displayName: 'Ada Lovelace' });
  const obj = await nems.okrs().createObjective(ctx, { title: 'Ship Wave 3', period: '2026-Q3', ownerId: ada.id });
  const kr = await nems.okrs().addKeyResult(ctx, obj.id, { title: 'Modules complete', target: 14 });
  await nems.okrs().updateKeyResult(ctx, kr.id, { current: 7, progress: 50 });
  const risky = await nems.okrs().createObjective(ctx, { title: 'Reliability', period: '2026-Q3' });
  await nems.okrs().setObjectiveStatus(ctx, risky.id, 'at-risk');
  await nems.okrs().createObjective(ctx, { title: 'Reliability', period: '2026-Q4' }); // duplicate title
  const launch = await nems.okrs().createObjective(ctx, { title: 'Launch', period: '2026-Q3' });
  const lkr = await nems.okrs().addKeyResult(ctx, launch.id, { title: 'GA', target: 1 });
  await nems.okrs().updateKeyResult(ctx, lkr.id, { current: 1, progress: 90 });
  await nems.okrs().createTask(ctx, { title: 'Write tests' });
  return { acme, globex, obj: obj.id, kr: kr.id, risky: risky.id, launch: launch.id };
}

describe('Modules 3,8,10 — Reasoning, Intelligence Services, Search v2', () => {
  let runtime: EnterpriseRuntime;
  let driver: PgliteDriver;
  let intel: IntelligencePlatform;
  let ids: Awaited<ReturnType<typeof seed>>;

  beforeAll(async () => {
    const clock = new ManualClock(2_000_000);
    runtime = createEnterpriseRuntime({ clock });
    driver = await createPgliteDriver();
    const nems = createNemsPlatform(runtime, { driver, clock });
    await nems.migrate();
    ids = await seed(nems);
    intel = await createIntelligencePlatform(runtime, { driver, nems, clock });
  });
  afterAll(async () => {
    await driver.close();
  });

  it('reasons deterministically and cites evidence — dependency, impact, risk', async () => {
    const r = await intel.reasoning(ids.acme);
    const dep = r.dependencyAnalysis(ids.acme, ids.obj);
    expect(dep.evidence.length).toBeGreaterThan(0);
    expect(dep.answer).toContain('measured by 1');
    const impact = r.impactAnalysis(ids.acme, ids.obj);
    expect(impact.evidence.length).toBeGreaterThan(0);
    const risk = r.riskDetection(ids.acme);
    expect(risk.answer).toContain('Reliability');
    expect(risk.confidence.score).toBeGreaterThan(0);
  });

  it('never bypasses evidence — an unknown target yields zero evidence and zero confidence', async () => {
    const r = await intel.reasoning(ids.acme);
    const dep = r.dependencyAnalysis(ids.acme, 'does-not-exist');
    expect(dep.evidence.length).toBe(0);
    expect(dep.confidence.score).toBe(0);
    expect(dep.answer).toContain('insufficient evidence');
  });

  it('runs intelligence services over real data — risk, opportunity, duplicate, dependency, recommendation', async () => {
    const svc = await intel.intelligence(ids.acme);
    expect(svc.risk(ids.acme).findings.some((f) => f.label.includes('Reliability'))).toBe(true);
    expect(svc.opportunity(ids.acme).findings.some((f) => f.label.includes('Launch'))).toBe(true); // 90% progress
    expect(svc.duplicate(ids.acme).findings.some((f) => f.label.toLowerCase().includes('reliability'))).toBe(true);
    expect(svc.dependency(ids.acme).findings.length).toBeGreaterThan(0);
    expect(svc.recommendation(ids.acme).findings.length).toBeGreaterThan(0); // unlinked task
    const all = svc.all(ids.acme);
    expect(Object.keys(all).length).toBe(8);
  });

  it('search v2 returns evidence + relationships + timeline + confidence, tenant-scoped', async () => {
    const s = await intel.search(ids.acme);
    const res = await s.search(ids.acme, 'Ship');
    expect(res.hits.length).toBeGreaterThan(0);
    const hit = res.hits.find((h) => h.title === 'Ship Wave 3')!;
    expect(hit.evidence.length).toBeGreaterThan(0);
    expect(hit.relationships.length).toBeGreaterThan(0); // measures its KR
    expect(hit.confidence).toBeGreaterThan(0);
    // tenant isolation
    const sg = await intel.search(ids.globex);
    expect((await sg.search(ids.globex, 'Ship')).hits.length).toBe(0);
  });
});
