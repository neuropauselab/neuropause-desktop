/**
 * Billing service — the subscription lifecycle logic. Given a Razorpay
 * subscription (created / authenticated / active / halted / cancelled / ...), it
 * derives the patch to apply to the org's existing subscription row. This reuses
 * the subscriptions repository; there is no parallel billing store. The core
 * (`subscriptionPatchFromRazorpay`) is pure and needs no Razorpay SDK — the plan
 * resolver is injected — so it is fully unit-tested against fabricated payloads.
 */
import type { BillingPlanId } from '@neuropause/shared';
import { planTierFor } from '@neuropause/shared';
import type {
  Subscription,
  SubscriptionPatch,
  SubscriptionRepository,
  SubscriptionStatus,
} from '../subscriptions/types';
import { planForRazorpayPlanId } from './plans';
import { BillingError, type RazorpaySubscriptionShape } from './types';

/** Map Razorpay's subscription status onto our subscription status. */
export function mapRazorpayStatus(status: string): SubscriptionStatus {
  switch (status) {
    case 'active':
    case 'authenticated':
      return 'active';
    case 'created':
      return 'trialing';
    case 'pending':
    case 'halted':
      return 'past_due';
    case 'cancelled':
    case 'completed':
    case 'expired':
      return 'canceled';
    default:
      return 'active';
  }
}

const iso = (unix: number | null): string | null =>
  unix ? new Date(unix * 1000).toISOString() : null;

/**
 * Derive the subscription patch a Razorpay subscription implies. Pure — no env, no
 * SDK. A canceled subscription drops to the free tier; an unknown plan id is a hard
 * error (a misconfiguration the webhook layer surfaces rather than guessing). A
 * subscription that hasn't started charging yet (a future startAt) is treated as a
 * trial ending at startAt.
 */
export function subscriptionPatchFromRazorpay(
  sub: RazorpaySubscriptionShape,
  resolvePlan: (planId: string) => BillingPlanId | null = planForRazorpayPlanId,
): SubscriptionPatch {
  const status = mapRazorpayStatus(sub.status);

  if (status === 'canceled') {
    return {
      plan: null,
      planTier: 'free',
      status: 'canceled',
      providerSubscriptionId: sub.id,
      providerCustomerId: sub.customerId,
      currentPeriodEnd: iso(sub.currentEnd),
      trialEndsAt: null,
    };
  }

  const plan = resolvePlan(sub.planId);
  if (!plan) {
    throw new BillingError('unknown_plan', `No plan is configured for Razorpay plan ${sub.planId}`);
  }

  return {
    plan,
    planTier: planTierFor(plan),
    status,
    seats: Math.max(1, sub.quantity),
    providerSubscriptionId: sub.id,
    providerCustomerId: sub.customerId,
    currentPeriodEnd: iso(sub.currentEnd),
    trialEndsAt: status === 'trialing' ? iso(sub.startAt ?? sub.chargeAt) : null,
  };
}

/** Apply a Razorpay subscription to an org's subscription row (reuses the repo). */
export async function applyRazorpaySubscription(
  repo: SubscriptionRepository,
  orgId: string,
  sub: RazorpaySubscriptionShape,
  resolvePlan?: (planId: string) => BillingPlanId | null,
): Promise<Subscription | null> {
  return repo.update(orgId, subscriptionPatchFromRazorpay(sub, resolvePlan));
}
