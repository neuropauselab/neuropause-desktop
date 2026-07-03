/**
 * Subscription service — the billing foundation. Reading and ensuring an org's
 * subscription, and updating it (the entry point a Stripe webhook would call once
 * real billing is wired). No Stripe calls here; nothing charges anyone.
 */
import { PLAN_TIERS } from '@neuropause/shared';
import type { Subscription, SubscriptionPatch, SubscriptionRepository } from './types';

export class SubscriptionError extends Error {
  constructor(
    public readonly code: 'invalid',
    message: string,
  ) {
    super(message);
    this.name = 'SubscriptionError';
  }
}

/** The org's subscription, creating the default (free) one on first access. */
export async function ensureSubscription(
  repo: SubscriptionRepository,
  orgId: string,
): Promise<Subscription> {
  return (await repo.getByOrg(orgId)) ?? repo.create(orgId);
}

export async function getSubscription(
  repo: SubscriptionRepository,
  orgId: string,
): Promise<Subscription | null> {
  return repo.getByOrg(orgId);
}

/**
 * Update an org's subscription. Validates the plan tier against the shared
 * catalog and rejects negative seat counts. Ensures the row exists first.
 */
export async function updateSubscription(
  repo: SubscriptionRepository,
  orgId: string,
  patch: SubscriptionPatch,
): Promise<Subscription> {
  if (patch.planTier !== undefined && !PLAN_TIERS.includes(patch.planTier)) {
    throw new SubscriptionError('invalid', `Unknown plan tier: ${patch.planTier}`);
  }
  if (patch.seats !== undefined && patch.seats < 0) {
    throw new SubscriptionError('invalid', 'Seats cannot be negative.');
  }
  await ensureSubscription(repo, orgId);
  const updated = await repo.update(orgId, patch);
  if (!updated) throw new SubscriptionError('invalid', 'Subscription not found.');
  return updated;
}
