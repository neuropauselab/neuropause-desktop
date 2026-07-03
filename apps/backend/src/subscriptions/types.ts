/**
 * Subscriptions — the billing foundation. A single subscription row per org,
 * carrying its plan tier, status, and seat count, plus (nullable) Stripe linkage
 * for when real billing is wired later. `PlanTier` is reused from
 * `@neuropause/shared` so the cloud and desktop plan vocabularies stay in sync.
 */
import type { BillingPlanId, PlanTier } from '@neuropause/shared';

export type { PlanTier };
export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled';

export interface Subscription {
  id: string;
  orgId: string;
  planTier: PlanTier;
  /** The commercial plan the org bought; null for the default free subscription. */
  plan: BillingPlanId | null;
  status: SubscriptionStatus;
  seats: number;
  /** The payment gateway's customer/subscription ids (currently Razorpay). Null
   *  until billing is set up for the org. */
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionPatch {
  planTier?: PlanTier;
  plan?: BillingPlanId | null;
  status?: SubscriptionStatus;
  seats?: number;
  providerCustomerId?: string | null;
  providerSubscriptionId?: string | null;
  currentPeriodEnd?: string | null;
  trialEndsAt?: string | null;
}

export interface SubscriptionRepository {
  getByOrg(orgId: string): Promise<Subscription | null>;
  /** Create the default subscription (free / active / 1 seat) for an org. */
  create(orgId: string): Promise<Subscription>;
  update(orgId: string, patch: SubscriptionPatch): Promise<Subscription | null>;
}
