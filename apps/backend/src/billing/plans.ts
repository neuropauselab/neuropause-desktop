/**
 * Maps between commercial plans and their Razorpay plan ids, sourced from env so
 * plan ids are never hard-coded. `trial` has no plan of its own — a trial is a
 * subscription whose charging starts in the future.
 */
import type { BillingPlanId } from '@neuropause/shared';
import { env } from '../config/env';

/** The configured Razorpay plan id for a self-serve paid plan, or null. */
export function razorpayPlanId(plan: BillingPlanId): string | null {
  switch (plan) {
    case 'starter':
      return env.RAZORPAY_PLAN_STARTER ?? null;
    case 'professional':
      return env.RAZORPAY_PLAN_PROFESSIONAL ?? null;
    case 'enterprise':
      return env.RAZORPAY_PLAN_ENTERPRISE ?? null;
    case 'trial':
    default:
      return null;
  }
}

/** Reverse lookup: the plan a Razorpay plan id represents, or null if unknown. */
export function planForRazorpayPlanId(planId: string): BillingPlanId | null {
  if (env.RAZORPAY_PLAN_STARTER && planId === env.RAZORPAY_PLAN_STARTER) return 'starter';
  if (env.RAZORPAY_PLAN_PROFESSIONAL && planId === env.RAZORPAY_PLAN_PROFESSIONAL)
    return 'professional';
  if (env.RAZORPAY_PLAN_ENTERPRISE && planId === env.RAZORPAY_PLAN_ENTERPRISE) return 'enterprise';
  return null;
}

/** Whether billing is configured (Razorpay key id + secret present). */
export function billingConfigured(): boolean {
  return Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
}
