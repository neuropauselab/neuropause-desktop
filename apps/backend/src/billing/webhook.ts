/**
 * Razorpay webhook handling — signature verification and turning a subscription
 * event into an update on the org's subscription row. This is the mechanism that
 * keeps billing state in sync with Razorpay. It is pure (Node crypto + an injected
 * plan resolver, reusing the billing service) so it is fully unit-tested against
 * fabricated events; the HTTP route that receives it is wired separately.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { BillingPlanId } from '@neuropause/shared';
import type { Subscription, SubscriptionRepository } from '../subscriptions/types';
import { applyRazorpaySubscription } from './service';
import type { RazorpaySubscriptionShape } from './types';

/** Verify a Razorpay webhook signature (HMAC-SHA256 of the exact raw body). */
export function verifyRazorpaySignature(
  rawBody: string,
  signature: string,
  secret: string,
): boolean {
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A Razorpay subscription entity — the snake_case shape from the API/webhook. */
export interface RazorpaySubscriptionEntity {
  id: string;
  plan_id: string;
  customer_id: string | null;
  status: string;
  quantity?: number;
  current_end?: number | null;
  start_at?: number | null;
  charge_at?: number | null;
  ended_at?: number | null;
  notes?: Record<string, string> | null;
}

/** Map a Razorpay subscription entity onto the internal lifecycle shape. */
export function razorpaySubscriptionToShape(
  e: RazorpaySubscriptionEntity,
): RazorpaySubscriptionShape {
  return {
    id: e.id,
    customerId: e.customer_id ?? '',
    planId: e.plan_id,
    status: e.status,
    quantity: e.quantity ?? 1,
    currentEnd: e.current_end ?? null,
    startAt: e.start_at ?? null,
    chargeAt: e.charge_at ?? null,
    endedAt: e.ended_at ?? null,
  };
}

export interface RazorpayWebhookEvent {
  event: string;
  payload?: { subscription?: { entity?: RazorpaySubscriptionEntity } };
}

export interface WebhookResult {
  handled: boolean;
  event: string;
  orgId: string | null;
  subscription: Subscription | null;
}

/**
 * Handle a (already signature-verified) Razorpay webhook event. Subscription
 * events update the org's subscription row from the entity; the org id travels in
 * the subscription's `notes.orgId`, set when the subscription is created. Events
 * that aren't subscription events, or that carry no org id, are acknowledged but
 * not acted on.
 */
export async function handleRazorpayWebhookEvent(
  repo: SubscriptionRepository,
  event: RazorpayWebhookEvent,
  resolvePlan?: (planId: string) => BillingPlanId | null,
): Promise<WebhookResult> {
  const type = event.event ?? '';
  const entity = event.payload?.subscription?.entity;
  if (!type.startsWith('subscription.') || !entity) {
    return { handled: false, event: type, orgId: null, subscription: null };
  }
  const orgId = entity.notes?.orgId ?? null;
  if (!orgId) {
    return { handled: false, event: type, orgId: null, subscription: null };
  }
  const subscription = await applyRazorpaySubscription(
    repo,
    orgId,
    razorpaySubscriptionToShape(entity),
    resolvePlan,
  );
  return { handled: true, event: type, orgId, subscription };
}
