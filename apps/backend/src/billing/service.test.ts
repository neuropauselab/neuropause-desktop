import { beforeEach, describe, expect, it } from 'vitest';
import { createMemorySubscriptionRepository } from '../subscriptions/memoryRepository';
import type { SubscriptionRepository } from '../subscriptions/types';
import {
  applyRazorpaySubscription,
  mapRazorpayStatus,
  subscriptionPatchFromRazorpay,
} from './service';
import { BillingError, type RazorpaySubscriptionShape } from './types';

const resolve = (planId: string): 'starter' | 'professional' | 'enterprise' | null => {
  if (planId === 'plan_starter') return 'starter';
  if (planId === 'plan_pro') return 'professional';
  if (planId === 'plan_ent') return 'enterprise';
  return null;
};

function sub(over: Partial<RazorpaySubscriptionShape> = {}): RazorpaySubscriptionShape {
  return {
    id: 'sub_1',
    customerId: 'cust_1',
    planId: 'plan_starter',
    status: 'active',
    quantity: 3,
    currentEnd: 1_800_000_000,
    startAt: null,
    chargeAt: null,
    endedAt: null,
    ...over,
  };
}

describe('subscriptionPatchFromRazorpay', () => {
  it('maps an active starter subscription to plan + tier + seats', () => {
    const patch = subscriptionPatchFromRazorpay(sub(), resolve);
    expect(patch.plan).toBe('starter');
    expect(patch.planTier).toBe('pro');
    expect(patch.status).toBe('active');
    expect(patch.seats).toBe(3);
    expect(patch.providerSubscriptionId).toBe('sub_1');
    expect(patch.providerCustomerId).toBe('cust_1');
    expect(patch.currentPeriodEnd).toBe(new Date(1_800_000_000 * 1000).toISOString());
    expect(patch.trialEndsAt).toBeNull();
  });

  it('maps the enterprise plan to the enterprise tier', () => {
    expect(subscriptionPatchFromRazorpay(sub({ planId: 'plan_ent' }), resolve).planTier).toBe(
      'enterprise',
    );
  });

  it('treats a not-yet-started (created) subscription as a trial ending at startAt', () => {
    const patch = subscriptionPatchFromRazorpay(
      sub({ status: 'created', startAt: 1_700_000_000 }),
      resolve,
    );
    expect(patch.status).toBe('trialing');
    expect(patch.trialEndsAt).toBe(new Date(1_700_000_000 * 1000).toISOString());
    expect(patch.plan).toBe('starter');
  });

  it('maps authenticated to active', () => {
    expect(subscriptionPatchFromRazorpay(sub({ status: 'authenticated' }), resolve).status).toBe(
      'active',
    );
  });

  it('drops a cancelled subscription to the free tier', () => {
    const patch = subscriptionPatchFromRazorpay(sub({ status: 'cancelled' }), resolve);
    expect(patch.status).toBe('canceled');
    expect(patch.plan).toBeNull();
    expect(patch.planTier).toBe('free');
    expect(patch.trialEndsAt).toBeNull();
  });

  it('clamps seats to at least 1', () => {
    expect(subscriptionPatchFromRazorpay(sub({ quantity: 0 }), resolve).seats).toBe(1);
  });

  it('throws on an unknown plan', () => {
    expect(() => subscriptionPatchFromRazorpay(sub({ planId: 'plan_unknown' }), resolve)).toThrow(
      BillingError,
    );
  });

  it('maps Razorpay statuses onto our vocabulary', () => {
    expect(mapRazorpayStatus('active')).toBe('active');
    expect(mapRazorpayStatus('authenticated')).toBe('active');
    expect(mapRazorpayStatus('created')).toBe('trialing');
    for (const s of ['pending', 'halted']) expect(mapRazorpayStatus(s)).toBe('past_due');
    for (const s of ['cancelled', 'completed', 'expired'])
      expect(mapRazorpayStatus(s)).toBe('canceled');
    expect(mapRazorpayStatus('weird')).toBe('active');
  });
});

describe('applyRazorpaySubscription', () => {
  let repo: SubscriptionRepository;
  beforeEach(async () => {
    repo = createMemorySubscriptionRepository();
    await repo.create('org-1');
  });

  it('updates the org subscription from a Razorpay subscription', async () => {
    const updated = await applyRazorpaySubscription(
      repo,
      'org-1',
      sub({ planId: 'plan_pro', quantity: 10 }),
      resolve,
    );
    expect(updated?.plan).toBe('professional');
    expect(updated?.planTier).toBe('pro');
    expect(updated?.seats).toBe(10);
    expect(updated?.providerCustomerId).toBe('cust_1');
  });

  it('a later cancellation returns the org to free', async () => {
    await applyRazorpaySubscription(repo, 'org-1', sub(), resolve);
    const canceled = await applyRazorpaySubscription(
      repo,
      'org-1',
      sub({ status: 'cancelled' }),
      resolve,
    );
    expect(canceled?.status).toBe('canceled');
    expect(canceled?.planTier).toBe('free');
    expect(canceled?.plan).toBeNull();
  });
});
