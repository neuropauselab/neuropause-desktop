/**
 * Tests for the shared license-evaluation core (@neuropause/shared). Hosted in the
 * backend alongside the flag-core tests; the backend will consume this to issue
 * license status.
 */
import { describe, expect, it } from 'vitest';
import { evaluateLicense, GRACE_DAYS, type LicenseSnapshot } from '@neuropause/shared';

const NOW = new Date('2026-06-15T12:00:00.000Z');

function snap(over: Partial<LicenseSnapshot> = {}): LicenseSnapshot {
  return {
    planTier: 'pro',
    status: 'active',
    currentPeriodEnd: '2026-07-01T00:00:00.000Z',
    trialEndsAt: null,
    ...over,
  };
}

describe('evaluateLicense — active', () => {
  it('is valid at the plan tier inside the current period', () => {
    const e = evaluateLicense(snap(), NOW);
    expect(e).toMatchObject({ state: 'valid', reason: 'active', entitledPlan: 'pro' });
    expect(e.expiresAt).toBe('2026-07-01T00:00:00.000Z');
    expect(e.graceDaysRemaining).toBe(0);
  });

  it('is valid with no fixed period end (null currentPeriodEnd)', () => {
    const e = evaluateLicense(snap({ currentPeriodEnd: null }), NOW);
    expect(e).toMatchObject({ state: 'valid', reason: 'active', entitledPlan: 'pro' });
    expect(e.expiresAt).toBeNull();
  });

  it('falls into grace when the period end has passed (stale data), then to free', () => {
    const stale = snap({ currentPeriodEnd: '2026-06-13T12:00:00.000Z' });
    const inGrace = evaluateLicense(stale, NOW);
    expect(inGrace).toMatchObject({ state: 'grace', reason: 'expired_grace', entitledPlan: 'pro' });
    expect(inGrace.graceDaysRemaining).toBeGreaterThan(0);
    expect(inGrace.graceDaysRemaining).toBeLessThanOrEqual(GRACE_DAYS);

    const afterGrace = new Date(`2026-06-${13 + GRACE_DAYS + 1}T12:00:00.001Z`);
    const invalid = evaluateLicense(stale, afterGrace);
    expect(invalid).toMatchObject({
      state: 'invalid',
      reason: 'period_expired',
      entitledPlan: 'free',
    });
  });
});

describe('evaluateLicense — trialing', () => {
  it('is valid during the trial and reports the trial end', () => {
    const e = evaluateLicense(
      snap({ status: 'trialing', trialEndsAt: '2026-06-20T00:00:00.000Z' }),
      NOW,
    );
    expect(e).toMatchObject({ state: 'valid', reason: 'trialing', entitledPlan: 'pro' });
    expect(e.expiresAt).toBe('2026-06-20T00:00:00.000Z');
  });

  it('falls straight to free when the trial has ended (no grace)', () => {
    const e = evaluateLicense(
      snap({ status: 'trialing', trialEndsAt: '2026-06-10T00:00:00.000Z' }),
      NOW,
    );
    expect(e).toMatchObject({ state: 'invalid', reason: 'trial_expired', entitledPlan: 'free' });
    expect(e.graceDaysRemaining).toBe(0);
  });

  it('treats a trial with an unknown end as still valid', () => {
    const e = evaluateLicense(snap({ status: 'trialing', trialEndsAt: null }), NOW);
    expect(e).toMatchObject({ state: 'valid', reason: 'trialing', entitledPlan: 'pro' });
  });
});

describe('evaluateLicense — past_due', () => {
  it('keeps the plan through the grace window after the period end', () => {
    const e = evaluateLicense(
      snap({ status: 'past_due', currentPeriodEnd: '2026-06-14T12:00:00.000Z' }),
      NOW,
    );
    expect(e).toMatchObject({ state: 'grace', reason: 'past_due_grace', entitledPlan: 'pro' });
    expect(e.graceDaysRemaining).toBe(GRACE_DAYS - 1);
  });

  it('falls to free once the grace window lapses', () => {
    const e = evaluateLicense(
      snap({ status: 'past_due', currentPeriodEnd: '2026-06-01T00:00:00.000Z' }),
      NOW,
    );
    expect(e).toMatchObject({ state: 'invalid', reason: 'past_due_grace', entitledPlan: 'free' });
  });

  it('anchors the grace window at now when no period end is known', () => {
    const e = evaluateLicense(snap({ status: 'past_due', currentPeriodEnd: null }), NOW);
    expect(e).toMatchObject({ state: 'grace', reason: 'past_due_grace', entitledPlan: 'pro' });
    expect(e.graceDaysRemaining).toBe(GRACE_DAYS);
  });
});

describe('evaluateLicense — canceled', () => {
  it('keeps the paid plan until the period the org already paid for ends', () => {
    const e = evaluateLicense(snap({ status: 'canceled' }), NOW);
    expect(e).toMatchObject({ state: 'valid', reason: 'active', entitledPlan: 'pro' });
    expect(e.expiresAt).toBe('2026-07-01T00:00:00.000Z');
  });

  it('falls to free with no grace once the paid period is over', () => {
    const e = evaluateLicense(
      snap({ status: 'canceled', currentPeriodEnd: '2026-06-10T00:00:00.000Z' }),
      NOW,
    );
    expect(e).toMatchObject({ state: 'invalid', reason: 'canceled', entitledPlan: 'free' });
  });

  it('falls to free immediately when canceled with no known period end', () => {
    const e = evaluateLicense(snap({ status: 'canceled', currentPeriodEnd: null }), NOW);
    expect(e).toMatchObject({ state: 'invalid', reason: 'canceled', entitledPlan: 'free' });
  });
});
