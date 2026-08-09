/**
 * Experience profile + routing usage — persistence against real temp files.
 *
 * What matters here: decisions persist the moment they are made (a quit
 * mid-flow loses nothing), completion is one-way (a later write cannot resurrect
 * the first-run screen), events fire once per decision, and the usage store
 * never yields numbers that could not have been measured.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createExperienceProfileService } from './experienceProfileService';
import { RoutingUsageStore } from '../ai/routingUsageStore';

let dir: string;
beforeEach(async () => {
  dir = join(tmpdir(), `np-xp-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

describe('Experience profile', () => {
  it('starts pending with nothing chosen', async () => {
    const svc = createExperienceProfileService({ filePath: join(dir, 'p.json') });
    await svc.load();
    expect(svc.get()).toMatchObject({ state: 'pending', workspaceType: null, aiModeChosen: false });
  });

  it('persists each decision immediately and survives a reload', async () => {
    const path = join(dir, 'p.json');
    const events: string[] = [];
    const svc = createExperienceProfileService({
      filePath: path,
      now: () => new Date('2026-08-09T10:00:00Z'),
      onEvent: (e) => events.push(e),
    });
    await svc.set({ aiModeChosen: true });
    await svc.set({ workspaceType: 'personal', state: 'completed' });

    // A fresh service over the same file — the app relaunching.
    const again = createExperienceProfileService({ filePath: path });
    await again.load();
    expect(again.get()).toMatchObject({
      state: 'completed',
      workspaceType: 'personal',
      aiModeChosen: true,
      completedAt: '2026-08-09T10:00:00.000Z',
    });
    expect(events).toEqual(['ai_mode_selected', 'workspace_type_selected', 'onboarding_completed']);
  });

  it('completion is one-way — a later write cannot resurrect the first-run screen', async () => {
    const svc = createExperienceProfileService({ filePath: join(dir, 'p.json') });
    await svc.set({ state: 'completed', workspaceType: 'professional' });
    const after = await svc.set({ state: 'skipped' });
    expect(after.state).toBe('completed');
  });

  it('workspace type can change AFTER completion — that is the upgrade path', async () => {
    const events: string[] = [];
    const svc = createExperienceProfileService({ filePath: join(dir, 'p.json'), onEvent: (e) => events.push(e) });
    await svc.set({ workspaceType: 'personal', state: 'completed' });
    const upgraded = await svc.set({ workspaceType: 'professional' });
    expect(upgraded.workspaceType).toBe('professional');
    expect(upgraded.state).toBe('completed');
    expect(events.filter((e) => e === 'workspace_type_selected')).toHaveLength(2);
  });

  it('events fire once per decision, not once per write', async () => {
    const events: string[] = [];
    const svc = createExperienceProfileService({ filePath: join(dir, 'p.json'), onEvent: (e) => events.push(e) });
    await svc.set({ aiModeChosen: true });
    await svc.set({ aiModeChosen: true });
    await svc.set({ workspaceType: 'business' });
    await svc.set({ workspaceType: 'business' });
    expect(events).toEqual(['ai_mode_selected', 'workspace_type_selected']);
  });

  it('a corrupt file quarantines to a fresh pending state, never a crash', async () => {
    const path = join(dir, 'p.json');
    await fs.writeFile(path, 'not json at all');
    const svc = createExperienceProfileService({ filePath: path });
    await svc.load();
    expect(svc.get().state).toBe('pending');
  });
});

describe('Routing usage store', () => {
  it('starts at zero and reports exactly what was recorded', async () => {
    const store = new RoutingUsageStore(join(dir, 'u.json'), () => '2026-08-09T10:00:00.000Z');
    await store.load();
    expect(store.snapshot().total).toBe(0);
    store.record('local');
    store.record('local');
    store.record('external');
    store.record('none');
    const snap = store.snapshot();
    expect(snap.total).toBe(4);
    expect(snap.byLocation).toEqual({ local: 2, private_infrastructure: 0, external: 1, none: 1 });
    expect(snap.firstAt).toBe('2026-08-09T10:00:00.000Z');
  });

  it('survives a reload with the same counts', async () => {
    const path = join(dir, 'u.json');
    const store = new RoutingUsageStore(path);
    await store.load();
    store.record('local');
    store.record('private_infrastructure');
    await store.flush();
    const again = new RoutingUsageStore(path);
    await again.load();
    expect(again.snapshot().total).toBe(2);
    expect(again.snapshot().byLocation.private_infrastructure).toBe(1);
  });

  it('a tampered file whose parts disagree with its total is re-summed from the parts', async () => {
    const path = join(dir, 'u.json');
    await fs.writeFile(
      path,
      JSON.stringify({
        total: 999,
        byLocation: { local: 2, private_infrastructure: 0, external: 1, none: 0 },
        firstAt: 't',
        lastAt: 't',
      }),
    );
    const store = new RoutingUsageStore(path);
    await store.load();
    // The parts are the measurements; a total that disagrees is corrected so a
    // percentage can never be computed against an invented denominator.
    expect(store.snapshot().total).toBe(3);
  });

  it('negative or non-numeric counts are discarded, not trusted', async () => {
    const path = join(dir, 'u.json');
    await fs.writeFile(
      path,
      JSON.stringify({ total: 5, byLocation: { local: -3, external: 'many' }, firstAt: 1, lastAt: null }),
    );
    const store = new RoutingUsageStore(path);
    await store.load();
    const snap = store.snapshot();
    expect(snap.byLocation.local).toBe(0);
    expect(snap.byLocation.external).toBe(0);
    expect(snap.firstAt).toBeNull();
  });
});
