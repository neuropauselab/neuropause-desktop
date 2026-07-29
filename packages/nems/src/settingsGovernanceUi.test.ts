import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime, type EnterpriseRuntime } from '@neuropause/runtime';
import { createPgliteDriver, type PgliteDriver, MigrationRunner } from '@neuropause/persistence';
import { createNemsPlatform, type NemsPlatform } from './platform';
import { NEMS_SCHEMA } from './schema';
import { systemContext, type MutationContext } from './types';
import { resolveViewState, themeFromPreferences } from './ui';

describe('Settings, Preferences, Governance, Migrations & UI (Modules 6,7,8,9,10)', () => {
  let runtime: EnterpriseRuntime;
  let driver: PgliteDriver;
  let nems: NemsPlatform;
  let clock: ManualClock;
  let org: { id: string };
  let ctx: MutationContext;
  let user: { id: string };

  beforeAll(async () => {
    clock = new ManualClock(3_000_000);
    runtime = createEnterpriseRuntime({ clock });
    driver = await createPgliteDriver();
    nems = createNemsPlatform(runtime, { driver, clock });
    await nems.migrate();
    org = await nems.organizations().create({ name: 'Umbrella', slug: 'umbrella' });
    ctx = systemContext(org.id);
    user = await nems.users().create(ctx, { email: 'ops@umbrella.test', password: 'pw', displayName: 'Ops' });
  });
  afterAll(async () => {
    await driver.close();
  });

  it('upserts settings by (scope, owner, category) and lists them', async () => {
    await nems.settings().set(ctx, { scope: 'organization', category: 'notifications', data: { email: true } });
    await nems.settings().set(ctx, { scope: 'organization', category: 'notifications', data: { email: false, slack: true } });
    // upsert — not a second row
    expect(await nems.settings().get(org.id, 'organization', 'notifications')).toEqual({ email: false, slack: true });
    await nems.settings().set(ctx, { scope: 'profile', category: 'appearance', data: { density: 'compact' }, ownerId: user.id });
    expect(await nems.settings().get(org.id, 'profile', 'appearance', user.id)).toEqual({ density: 'compact' });
    const all = await nems.settings().list(org.id);
    expect(all.length).toBe(2);
    expect((await nems.settings().list(org.id, 'organization')).length).toBe(1);
  });

  it('persists per-user preferences and resolves a theme from them', async () => {
    await nems.preferences().set(ctx, user.id, { theme: 'dark', locale: 'en-US' });
    const prefs = await nems.preferences().get(org.id, user.id);
    expect(prefs.theme).toBe('dark');
    expect(themeFromPreferences(prefs)).toBe('dark');
    // overwrite (upsert on tenant,user)
    await nems.preferences().set(ctx, user.id, { theme: 'system' });
    expect(themeFromPreferences(await nems.preferences().get(org.id, user.id))).toBe('system');
    expect(themeFromPreferences({})).toBe('light'); // fallback
  });

  it('routes every mutation through the ONE audit chain (verifiable) and event bus', async () => {
    const before = runtime.audit().list().length;
    await nems.settings().set(ctx, { scope: 'workspace', category: 'security', data: { mfaRequired: true } });
    expect(runtime.audit().list().length).toBeGreaterThan(before);
    expect(runtime.audit().verify().valid).toBe(true);
    expect(nems.events().count('nems.settings.changed')).toBeGreaterThan(0);
    expect(nems.events().count('nems.organization.created')).toBeGreaterThan(0);
    expect(nems.events().count('nems.user.created')).toBeGreaterThan(0);
    // total is the sum of the per-type tallies
    expect(nems.events().count()).toBeGreaterThanOrEqual(nems.events().count('nems.settings.changed'));
  });

  it('runs migrations idempotently and reversibly through the ONE MigrationRunner', async () => {
    const d2 = await createPgliteDriver();
    try {
      const runner = new MigrationRunner(d2, clock);
      const firstUp = await runner.up(NEMS_SCHEMA);
      expect(firstUp).toEqual([1, 2, 3, 4, 5]);
      // idempotent — a second up applies nothing
      expect(await runner.up(NEMS_SCHEMA)).toEqual([]);
      // checksums verify (no drift)
      expect((await runner.verify(NEMS_SCHEMA)).ok).toBe(true);
      const status = await runner.status(NEMS_SCHEMA);
      expect(status.every((s) => s.applied && s.checksumOk)).toBe(true);
      // reversible — roll all the way back, then forward again
      const rolledBack = await runner.down(NEMS_SCHEMA, 0);
      expect(rolledBack).toEqual([5, 4, 3, 2, 1]);
      expect(await runner.currentVersion()).toBe(0);
      expect(await runner.up(NEMS_SCHEMA)).toEqual([1, 2, 3, 4, 5]);
      // tables actually exist again after re-apply
      const check = await d2.query<{ n: number }>(`SELECT count(*)::int AS n FROM nems_organizations`);
      expect(check.rows[0].n).toBe(0);
    } finally {
      await d2.close();
    }
  });

  it('resolves UI view-state in priority order (session → permission → error → empty → ready)', () => {
    expect(resolveViewState({ loading: true }).kind).toBe('loading');
    expect(resolveViewState({ sessionValid: false, permitted: false, error: 'x', data: [1] }).kind).toBe('session-expired');
    expect(resolveViewState({ permitted: false, error: 'x', data: [1] }).kind).toBe('denied');
    expect(resolveViewState({ error: 'boom', data: [1] }).kind).toBe('error');
    expect(resolveViewState({ data: [] }).kind).toBe('empty');
    expect(resolveViewState<number[]>({ data: null }).kind).toBe('empty');
    const ready = resolveViewState({ data: [1, 2, 3] });
    expect(ready.kind).toBe('ready');
    if (ready.kind === 'ready') expect(ready.data).toEqual([1, 2, 3]);
  });
});
