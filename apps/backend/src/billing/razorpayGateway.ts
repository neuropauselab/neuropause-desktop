/**
 * The production billing gateway — a thin wrapper over the Razorpay SDK. It is
 * lazily constructed from env so the server boots without billing configured. This
 * file is intentionally minimal (it just translates our gateway calls into Razorpay
 * SDK calls); the logic worth testing lives in the pure service + webhook modules.
 */
import Razorpay from 'razorpay';
import { env } from '../config/env';
import { billingConfigured, razorpayPlanId } from './plans';
import { BillingError } from './types';
import type { BillingGateway, CreatedSubscription, CreateSubscriptionInput } from './gateway';

let client: Razorpay | null = null;

function rzp(): Razorpay {
  if (!billingConfigured()) {
    throw new BillingError('billing_disabled', 'Billing is not configured on this server.');
  }
  client ??= new Razorpay({
    key_id: env.RAZORPAY_KEY_ID as string,
    key_secret: env.RAZORPAY_KEY_SECRET as string,
  });
  return client;
}

export const razorpayGateway: BillingGateway = {
  async createSubscription({
    orgId,
    plan,
    seats,
    trialDays,
  }: CreateSubscriptionInput): Promise<CreatedSubscription> {
    const planId = razorpayPlanId(plan);
    if (!planId) {
      throw new BillingError('unknown_plan', `No Razorpay plan is configured for ${plan}.`);
    }
    const startAt = trialDays > 0 ? Math.floor(Date.now() / 1000) + trialDays * 86_400 : undefined;

    const sub = await rzp().subscriptions.create({
      plan_id: planId,
      total_count: 120,
      quantity: Math.max(1, seats),
      customer_notify: 1,
      ...(startAt ? { start_at: startAt } : {}),
      notes: { orgId },
    });

    const s = sub as unknown as {
      id: string;
      status: string;
      customer_id?: string | null;
      short_url?: string;
    };
    return {
      subscriptionId: s.id,
      customerId: s.customer_id ?? null,
      shortUrl: s.short_url ?? '',
      status: s.status,
    };
  },

  async cancelSubscription(subscriptionId: string, atCycleEnd: boolean): Promise<void> {
    await rzp().subscriptions.cancel(subscriptionId, atCycleEnd);
  },
};
