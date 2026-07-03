/**
 * Tests for the shared feature-flag evaluation core (@neuropause/shared). Hosted in
 * the backend because it has the vitest harness and will be a consumer of flags.
 */
import { describe, expect, it } from 'vitest';
import {
  evaluateFlag,
  featureFlag,
  planMeetsTier,
  type FeatureFlagDefinition,
} from '@neuropause/shared';

const gated: FeatureFlagDefinition = {
  key: 'advanced_analytics',
  description: 'x',
  default: false,
  minPlan: 'pro',
};
const ungated: FeatureFlagDefinition = {
  key: 'automation_builder',
  description: 'x',
  default: true,
};

describe('planMeetsTier', () => {
  it('orders free < pro < enterprise', () => {
    expect(planMeetsTier('free', 'pro')).toBe(false);
    expect(planMeetsTier('pro', 'pro')).toBe(true);
    expect(planMeetsTier('enterprise', 'pro')).toBe(true);
    expect(planMeetsTier('pro', 'enterprise')).toBe(false);
    expect(planMeetsTier('free', 'free')).toBe(true);
  });
});

describe('evaluateFlag', () => {
  it('uses the default for an ungated flag with no override', () => {
    const s = evaluateFlag(ungated);
    expect(s).toMatchObject({ enabled: true, source: 'default' });
  });

  it('lets an explicit override win over everything', () => {
    expect(evaluateFlag(gated, { override: true, planTier: 'free' })).toMatchObject({
      enabled: true,
      source: 'override',
    });
    expect(evaluateFlag(ungated, { override: false })).toMatchObject({
      enabled: false,
      source: 'override',
    });
  });

  it('gates a flag on the plan tier when no override is set', () => {
    expect(evaluateFlag(gated, { planTier: 'free' })).toMatchObject({
      enabled: false,
      source: 'plan',
    });
    expect(evaluateFlag(gated, { planTier: 'pro' })).toMatchObject({
      enabled: true,
      source: 'plan',
    });
  });

  it('treats a missing plan tier as free for gated flags', () => {
    expect(evaluateFlag(gated).enabled).toBe(false);
  });
});

describe('featureFlag', () => {
  it('looks up a known flag and returns undefined for an unknown one', () => {
    expect(featureFlag('cloud_sync')?.minPlan).toBe('pro');
    // @ts-expect-error unknown key
    expect(featureFlag('nope')).toBeUndefined();
  });
});
