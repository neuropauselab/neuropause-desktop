import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime, type EnterpriseRuntime } from '@neuropause/runtime';
import { createPgliteDriver, type PgliteDriver } from '@neuropause/persistence';
import { createNemsPlatform, type NemsPlatform } from './platform';
import { systemContext, type MutationContext } from './types';

describe('Dashboards, OKRs & Search (Modules 4,5 + search — real Postgres)', () => {
  let runtime: EnterpriseRuntime;
  let driver: PgliteDriver;
  let nems: NemsPlatform;
  let clock: ManualClock;
  let org: { id: string };
  let ctx: MutationContext;
  let owner: { id: string };

  beforeAll(async () => {
    clock = new ManualClock(2_000_000);
    runtime = createEnterpriseRuntime({ clock });
    driver = await createPgliteDriver();
    nems = createNemsPlatform(runtime, { driver, clock });
    await nems.migrate();
    org = await nems.organizations().create({ name: 'Initech', slug: 'initech' });
    ctx = systemContext(org.id);
    owner = await nems.users().create(ctx, { email: 'lead@initech.test', password: 'pw', displayName: 'Peter Gibbons', roles: ['manager'] });
  });
  afterAll(async () => {
    await driver.close();
  });

  it('persists dashboards across scopes, updates them, and filters by scope', async () => {
    const personal = await nems.dashboards().create({ ...ctx, actorId: owner.id }, { name: 'My Board', scope: 'personal' });
    expect(personal.ownerId).toBe(owner.id);
    const exec = await nems.dashboards().create(ctx, { name: 'Exec Board', scope: 'executive' });
    expect(exec.ownerId).toBeNull();
    expect((await nems.dashboards().get(org.id, personal.id))?.name).toBe('My Board');
    const updated = await nems.dashboards().update(ctx, exec.id, { theme: 'dark', name: 'Executive Command' });
    expect(updated.theme).toBe('dark');
    expect(updated.name).toBe('Executive Command');
    expect((await nems.dashboards().list(org.id, { scope: 'executive' })).length).toBe(1);
    expect((await nems.dashboards().list(org.id)).length).toBe(2);
  });

  it('persists widgets, positions, moves, and saved views', async () => {
    const dash = await nems.dashboards().create(ctx, { name: 'Ops', scope: 'organization' });
    const w = await nems.dashboards().addWidget(ctx, dash.id, { type: 'kpi', position: { x: 0, y: 0 }, config: { metric: 'uptime' } });
    await nems.dashboards().addWidget(ctx, dash.id, { type: 'chart', position: { x: 1, y: 0 } });
    await nems.dashboards().moveWidget(ctx, w.id, { x: 2, y: 3 });
    const widgets = await nems.dashboards().widgets(org.id, dash.id);
    expect(widgets.length).toBe(2);
    expect(widgets.find((x) => x.id === w.id)?.position).toEqual({ x: 2, y: 3 });
    await nems.dashboards().saveView(ctx, { ownerId: owner.id, name: 'At-risk OKRs', entity: 'objective', query: { status: 'at-risk' } });
    const views = await nems.dashboards().savedViews(org.id, owner.id);
    expect(views.length).toBe(1);
    expect(views[0].query).toEqual({ status: 'at-risk' });
  });

  it('computes objective progress as the average of its key results', async () => {
    const obj = await nems.okrs().createObjective(ctx, { title: 'Ship Wave 1', period: '2026-Q3', level: 'quarterly', ownerId: owner.id });
    expect(obj.progress).toBe(0);
    expect(obj.status).toBe('planned');
    const kr1 = await nems.okrs().addKeyResult(ctx, obj.id, { title: 'Modules complete', metric: 'count', target: 12 });
    const kr2 = await nems.okrs().addKeyResult(ctx, obj.id, { title: 'Tests green', metric: 'pct', target: 100 });
    await nems.okrs().updateKeyResult(ctx, kr1.id, { current: 12, progress: 100, status: 'done', addEvidence: 'tsc+eslint+vitest all green' });
    await nems.okrs().updateKeyResult(ctx, kr2.id, { current: 50, progress: 40 });
    // (100 + 40) / 2 = 70
    expect((await nems.okrs().getObjective(org.id, obj.id))?.progress).toBe(70);
    const krs = await nems.okrs().keyResults(org.id, obj.id);
    expect(krs.find((k) => k.id === kr1.id)?.evidence).toContain('tsc+eslint+vitest all green');
    const done = await nems.okrs().setObjectiveStatus(ctx, obj.id, 'on-track');
    expect(done.status).toBe('on-track');
  });

  it('persists projects, milestones, tasks, task-status, and dependencies', async () => {
    const obj = await nems.okrs().createObjective(ctx, { title: 'Reliability', period: '2026-Q3' });
    const proj = await nems.okrs().createProject(ctx, { name: 'SLO program', objectiveId: obj.id, ownerId: owner.id });
    await nems.okrs().createMilestone(ctx, { title: 'Define SLOs', projectId: proj.id, objectiveId: obj.id });
    const t1 = await nems.okrs().createTask(ctx, { title: 'Instrument metrics', projectId: proj.id });
    const t2 = await nems.okrs().createTask(ctx, { title: 'Wire alerting', projectId: proj.id });
    await nems.okrs().setTaskStatus(ctx, t1.id, 'done');
    await nems.okrs().addDependency(ctx, { fromType: 'task', fromId: t2.id, toType: 'task', toId: t1.id, kind: 'blocks' });
    expect((await nems.okrs().tasks(org.id)).length).toBeGreaterThanOrEqual(2);
    expect((await nems.okrs().tasks(org.id, { status: 'done' })).some((t) => t.id === t1.id)).toBe(true);
    expect((await nems.okrs().tasks(org.id, { status: 'todo' })).some((t) => t.id === t2.id)).toBe(true);
  });

  it('searches across users, objectives, and dashboards within the tenant', async () => {
    await nems.okrs().createObjective(ctx, { title: 'Gibbons quarterly review', period: '2026-Q3' });
    await nems.dashboards().create(ctx, { name: 'Gibbons scorecard', scope: 'organization' });
    const hits = await nems.search().search(org.id, 'Gibbons');
    const types = new Set(hits.map((h) => h.type));
    expect(types.has('user')).toBe(true); // Peter Gibbons
    expect(types.has('objective')).toBe(true);
    expect(types.has('dashboard')).toBe(true);
    // tenant isolation — a different org sees nothing
    const other = await nems.organizations().create({ name: 'Other', slug: 'other' });
    expect((await nems.search().search(other.id, 'Gibbons')).length).toBe(0);
  });
});
