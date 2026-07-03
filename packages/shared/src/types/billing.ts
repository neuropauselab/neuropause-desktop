/**
 * Commercial SaaS billing plans for organizations. These are the *plans* a
 * customer buys (trial / starter / professional / enterprise); they are distinct
 * from `PlanTier` (free / pro / enterprise), which is the coarse feature-gating
 * bucket reused across the platform. Each plan maps to a tier for gating and to a
 * Stripe price (configured server-side via env — never hard-coded here, so plan
 * metadata can't drift from what Stripe actually charges).
 */
import type { PlanTier } from './ecosystem';

export type BillingPlanId = 'trial' | 'starter' | 'professional' | 'enterprise';

export const BILLING_PLAN_IDS: readonly BillingPlanId[] = [
  'trial',
  'starter',
  'professional',
  'enterprise',
] as const;

export interface BillingPlan {
  id: BillingPlanId;
  name: string;
  description: string;
  /** Feature-gating bucket this plan grants. */
  tier: PlanTier;
  /** Seats included in the base price; additional seats are billed per-seat. */
  includedSeats: number;
  /** Trial length in days (0 = no trial). */
  trialDays: number;
  /** Whether this plan is self-serve via Checkout (Enterprise is sales-assisted). */
  selfServe: boolean;
}

export const BILLING_PLANS: Record<BillingPlanId, BillingPlan> = {
  trial: {
    id: 'trial',
    name: 'Free Trial',
    description: 'Full access while you evaluate NeuroPause.',
    tier: 'free',
    includedSeats: 5,
    trialDays: 14,
    selfServe: true,
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    description: 'For small teams getting started.',
    tier: 'pro',
    includedSeats: 3,
    trialDays: 0,
    selfServe: true,
  },
  professional: {
    id: 'professional',
    name: 'Professional',
    description: 'For growing teams that need more seats and capacity.',
    tier: 'pro',
    includedSeats: 10,
    trialDays: 0,
    selfServe: true,
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    description: 'Advanced controls and support for larger organizations.',
    tier: 'enterprise',
    includedSeats: 25,
    trialDays: 0,
    selfServe: false,
  },
};

export function billingPlan(id: BillingPlanId): BillingPlan {
  return BILLING_PLANS[id];
}

/** The gating tier a plan grants. */
export function planTierFor(id: BillingPlanId): PlanTier {
  return BILLING_PLANS[id].tier;
}
