import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFlagService, type FlagService } from './flagService';

describe('createFlagService', () => {
  let filePath: string;
  let svc: FlagService;

  beforeEach(async () => {
    filePath = join(tmpdir(), `nps-flags-${randomUUID()}.json`);
    svc = createFlagService({ filePath });
    await svc.load();
  });
  afterEach(async () => {
    await fs.rm(filePath, { force: true });
    await fs.rm(`${filePath}.tmp`, { force: true });
  });

  it('evaluates every flag for a plan', () => {
    const free = svc.evaluate('free');
    expect(free.length).toBeGreaterThanOrEqual(5);
    // advanced_analytics is gated at pro → off for free.
    expect(free.find((f) => f.key === 'advanced_analytics')?.enabled).toBe(false);
    const pro = svc.evaluate('pro');
    expect(pro.find((f) => f.key === 'advanced_analytics')?.enabled).toBe(true);
  });

  it('reports isEnabled for a single flag against the plan', () => {
    expect(svc.isEnabled('multi_workspace', 'pro')).toBe(false);
    expect(svc.isEnabled('multi_workspace', 'enterprise')).toBe(true);
    expect(svc.isEnabled('automation_builder', 'free')).toBe(true);
  });

  it('lets an override win over the plan gate', async () => {
    expect(svc.isEnabled('advanced_analytics', 'free')).toBe(false);
    await svc.setOverride('advanced_analytics', true);
    expect(svc.isEnabled('advanced_analytics', 'free')).toBe(true);
    expect(svc.evaluate('free').find((f) => f.key === 'advanced_analytics')?.source).toBe(
      'override',
    );
  });

  it('clears an override back to the plan/default result', async () => {
    await svc.setOverride('automation_builder', false);
    expect(svc.isEnabled('automation_builder', 'free')).toBe(false);
    await svc.clearOverride('automation_builder');
    expect(svc.isEnabled('automation_builder', 'free')).toBe(true);
  });

  it('persists overrides across a reload', async () => {
    await svc.setOverride('cloud_sync', true);
    const reloaded = createFlagService({ filePath });
    await reloaded.load();
    expect(reloaded.getOverride('cloud_sync')).toBe(true);
    expect(reloaded.isEnabled('cloud_sync', 'free')).toBe(true);
    expect(reloaded.listOverrides()).toEqual({ cloud_sync: true });
  });
});
