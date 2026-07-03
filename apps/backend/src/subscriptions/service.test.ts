import { beforeEach, describe, expect, it } from 'vitest';
import { createMemorySubscriptionRepository } from './memoryRepository';
import type { SubscriptionRepository } from './types';
import {
  SubscriptionError,
  ensureSubscription,
  getSubscription,
  updateSubscription,
} from './service';

let repo: SubscriptionRepository;
beforeEach(() => {
  repo = createMemorySubscriptionRepository();
});

describe('ensureSubscription', () => {
  it('creates a default free/active subscription on first access', async () => {
    const sub = await ensureSubscription(repo, 'org-1');
    expect(sub.planTier).toBe('free');
    expect(sub.status).toBe('active');
    expect(sub.seats).toBe(1);
    expect(sub.providerCustomerId).toBeNull();
  });

  it('is idempotent — returns the same subscription, not a new one', async () => {
    const first = await ensureSubscription(repo, 'org-1');
    const second = await ensureSubscription(repo, 'org-1');
    expect(second.id).toBe(first.id);
  });
});

describe('getSubscription', () => {
  it('returns null when the org has none yet', async () => {
    expect(await getSubscription(repo, 'org-x')).toBeNull();
  });
});

describe('updateSubscription', () => {
  it('updates the plan tier and seats', async () => {
    await ensureSubscription(repo, 'org-1');
    const updated = await updateSubscription(repo, 'org-1', { planTier: 'pro', seats: 10 });
    expect(updated.planTier).toBe('pro');
    expect(updated.seats).toBe(10);
  });

  it('creates the subscription first if it did not exist', async () => {
    const updated = await updateSubscription(repo, 'org-new', { planTier: 'enterprise' });
    expect(updated.planTier).toBe('enterprise');
  });

  it('rejects an unknown plan tier', async () => {
    await expect(
      // @ts-expect-error — exercising runtime validation with an invalid tier
      updateSubscription(repo, 'org-1', { planTier: 'ultra' }),
    ).rejects.toMatchObject({ name: 'SubscriptionError', code: 'invalid' });
  });

  it('rejects negative seats', async () => {
    await expect(updateSubscription(repo, 'org-1', { seats: -1 })).rejects.toBeInstanceOf(
      SubscriptionError,
    );
  });
});
