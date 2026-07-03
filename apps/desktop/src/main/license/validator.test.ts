import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LicenseSnapshot, OrgLicense } from '@neuropause/shared';
import { evaluateLicense, GRACE_DAYS } from '@neuropause/shared';
import { createLicenseValidator, type LicenseValidator } from './validator';
import type { LicenseTransport } from './types';

const T0 = new Date('2026-06-01T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function at(days: number): Date {
  return new Date(T0.getTime() + days * DAY_MS);
}

function license(orgId: string, snap: Partial<LicenseSnapshot> = {}): OrgLicense {
  const snapshot: LicenseSnapshot = {
    planTier: 'pro',
    status: 'active',
    currentPeriodEnd: at(1).toISOString(),
    trialEndsAt: null,
    ...snap,
  };
  return {
    orgId,
    snapshot,
    evaluation: evaluateLicense(snapshot, T0),
    checkedAt: T0.toISOString(),
  };
}

describe('createLicenseValidator', () => {
  let filePath: string;
  let clock: Date;
  let behavior: (orgId: string) => Promise<OrgLicense>;
  let validator: LicenseValidator;

  const transport: LicenseTransport = {
    fetchLicense: (orgId) => behavior(orgId),
  };

  beforeEach(async () => {
    filePath = join(tmpdir(), `nps-license-${randomUUID()}.json`);
    clock = T0;
    behavior = async (orgId) => license(orgId);
    validator = createLicenseValidator({ filePath, transport, now: () => clock });
    await validator.load();
  });
  afterEach(async () => {
    await fs.rm(filePath, { force: true });
    await fs.rm(`${filePath}.tmp`, { force: true });
  });

  it('reports none when nothing is stored', () => {
    const s = validator.getStatus('org-1');
    expect(s).toMatchObject({ source: 'none', snapshot: null, evaluation: null, checkedAt: null });
  });

  it('refresh fetches, evaluates, persists, and a reload serves it from cache', async () => {
    const s = await validator.refresh('org-1');
    expect(s.source).toBe('remote');
    expect(s.evaluation).toMatchObject({ state: 'valid', reason: 'active', entitledPlan: 'pro' });
    expect(s.checkedAt).toBe(T0.toISOString());

    const reloaded = createLicenseValidator({ filePath, transport, now: () => clock });
    await reloaded.load();
    const cached = reloaded.getStatus('org-1');
    expect(cached.source).toBe('cache');
    expect(cached.snapshot).toEqual(s.snapshot);
    expect(cached.evaluation).toMatchObject({ state: 'valid', entitledPlan: 'pro' });
  });

  it('a failed refresh with no cache reports none plus the error', async () => {
    behavior = async () => {
      throw new Error('offline');
    };
    const s = await validator.refresh('org-1');
    expect(s).toMatchObject({ source: 'none', snapshot: null, lastError: 'offline' });
  });

  it('a failed refresh falls back to the cache, and a later success clears the error', async () => {
    await validator.refresh('org-1');
    behavior = async () => {
      throw new Error('offline');
    };
    const failed = await validator.refresh('org-1');
    expect(failed.source).toBe('cache');
    expect(failed.snapshot?.planTier).toBe('pro');
    expect(failed.lastError).toBe('offline');

    behavior = async (orgId) => license(orgId);
    const recovered = await validator.refresh('org-1');
    expect(recovered).toMatchObject({ source: 'remote', lastError: null });
  });

  it('re-evaluates the stored snapshot as time passes offline: valid → grace → invalid', async () => {
    await validator.refresh('org-1'); // period ends at day 1
    expect(validator.getStatus('org-1').evaluation).toMatchObject({
      state: 'valid',
      entitledPlan: 'pro',
    });

    clock = at(2); // past the period end, inside the grace window
    const grace = validator.getStatus('org-1');
    expect(grace.evaluation).toMatchObject({
      state: 'grace',
      reason: 'expired_grace',
      entitledPlan: 'pro',
    });
    expect(grace.evaluation?.graceDaysRemaining).toBeGreaterThan(0);

    clock = at(1 + GRACE_DAYS + 1); // past the grace window
    const invalid = validator.getStatus('org-1');
    expect(invalid.evaluation).toMatchObject({
      state: 'invalid',
      reason: 'period_expired',
      entitledPlan: 'free',
    });
  });

  it('grace days remaining decay day by day from the stored snapshot', async () => {
    behavior = async (orgId) =>
      license(orgId, { status: 'past_due', currentPeriodEnd: T0.toISOString() });
    await validator.refresh('org-1');

    clock = at(1);
    const d1 = validator.getStatus('org-1').evaluation?.graceDaysRemaining ?? -1;
    clock = at(3);
    const d3 = validator.getStatus('org-1').evaluation?.graceDaysRemaining ?? -1;
    expect(d1).toBe(GRACE_DAYS - 1);
    expect(d3).toBe(GRACE_DAYS - 3);
    expect(validator.getStatus('org-1').evaluation?.state).toBe('grace');
  });

  it('tracks orgs independently', async () => {
    behavior = async (orgId) =>
      orgId === 'org-ent' ? license(orgId, { planTier: 'enterprise' }) : license(orgId);
    await validator.refresh('org-1');
    await validator.refresh('org-ent');
    expect(validator.getStatus('org-1').evaluation?.entitledPlan).toBe('pro');
    expect(validator.getStatus('org-ent').evaluation?.entitledPlan).toBe('enterprise');
    expect(validator.getStatus('org-other').source).toBe('none');
  });
});
