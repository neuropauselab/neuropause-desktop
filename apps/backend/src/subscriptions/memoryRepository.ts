/** In-memory SubscriptionRepository for unit tests. */
import { randomUUID } from 'node:crypto';
import type { Subscription, SubscriptionPatch, SubscriptionRepository } from './types';

export function createMemorySubscriptionRepository(): SubscriptionRepository {
  const byOrg = new Map<string, Subscription>();
  const now = (): string => new Date().toISOString();

  return {
    async getByOrg(orgId) {
      return byOrg.get(orgId) ?? null;
    },
    async create(orgId) {
      if (byOrg.has(orgId)) throw new Error('subscription already exists for org');
      const sub: Subscription = {
        id: randomUUID(),
        orgId,
        planTier: 'free',
        plan: null,
        status: 'active',
        seats: 1,
        providerCustomerId: null,
        providerSubscriptionId: null,
        currentPeriodEnd: null,
        trialEndsAt: null,
        createdAt: now(),
        updatedAt: now(),
      };
      byOrg.set(orgId, sub);
      return sub;
    },
    async update(orgId, patch: SubscriptionPatch) {
      const existing = byOrg.get(orgId);
      if (!existing) return null;
      const next: Subscription = {
        ...existing,
        planTier: patch.planTier ?? existing.planTier,
        plan: patch.plan !== undefined ? patch.plan : existing.plan,
        status: patch.status ?? existing.status,
        seats: patch.seats ?? existing.seats,
        providerCustomerId:
          patch.providerCustomerId !== undefined
            ? patch.providerCustomerId
            : existing.providerCustomerId,
        providerSubscriptionId:
          patch.providerSubscriptionId !== undefined
            ? patch.providerSubscriptionId
            : existing.providerSubscriptionId,
        currentPeriodEnd:
          patch.currentPeriodEnd !== undefined ? patch.currentPeriodEnd : existing.currentPeriodEnd,
        trialEndsAt: patch.trialEndsAt !== undefined ? patch.trialEndsAt : existing.trialEndsAt,
        updatedAt: now(),
      };
      byOrg.set(orgId, next);
      return next;
    },
  };
}
