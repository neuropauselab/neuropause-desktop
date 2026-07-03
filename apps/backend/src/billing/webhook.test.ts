import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMemorySubscriptionRepository } from '../subscriptions/memoryRepository';
import type { SubscriptionRepository } from '../subscriptions/types';
import {
  handleRazorpayWebhookEvent,
  razorpaySubscriptionToShape,
  verifyRazorpaySignature,
  type RazorpaySubscriptionEntity,
  type RazorpayWebhookEvent,
} from './webhook';

const SECRET = 'whsec_test';
const sign = (body: string): string => createHmac('sha256', SECRET).update(body).digest('hex');

const resolve = (planId: string): 'starter' | 'professional' | 'enterprise' | null => {
  if (planId === 'plan_pro') return 'professional';
  return null;
};

function entity(over: Partial<RazorpaySubscriptionEntity> = {}): RazorpaySubscriptionEntity {
  return {
    id: 'sub_1',
    plan_id: 'plan_pro',
    customer_id: 'cust_1',
    status: 'active',
    quantity: 4,
    current_end: 1_800_000_000,
    start_at: null,
    charge_at: null,
    ended_at: null,
    notes: { orgId: 'org-1' },
    ...over,
  };
}

function event(
  over: Partial<RazorpaySubscriptionEntity> = {},
  type = 'subscription.activated',
): RazorpayWebhookEvent {
  return { event: type, payload: { subscription: { entity: entity(over) } } };
}

describe('verifyRazorpaySignature', () => {
  it('accepts a correct signature', () => {
    const body = '{"event":"subscription.activated"}';
    expect(verifyRazorpaySignature(body, sign(body), SECRET)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const body = '{"event":"subscription.activated"}';
    const sig = sign(body);
    expect(verifyRazorpaySignature(body + ' ', sig, SECRET)).toBe(false);
  });

  it('rejects a wrong secret', () => {
    const body = '{"a":1}';
    expect(verifyRazorpaySignature(body, sign(body), 'other')).toBe(false);
  });

  it('rejects a malformed signature without throwing', () => {
    expect(verifyRazorpaySignature('{}', 'not-hex', SECRET)).toBe(false);
  });
});

describe('razorpaySubscriptionToShape', () => {
  it('maps snake_case entity fields onto the lifecycle shape', () => {
    const shape = razorpaySubscriptionToShape(entity());
    expect(shape).toMatchObject({
      id: 'sub_1',
      customerId: 'cust_1',
      planId: 'plan_pro',
      status: 'active',
      quantity: 4,
      currentEnd: 1_800_000_000,
    });
  });

  it('defaults quantity to 1 and null customer to empty', () => {
    const shape = razorpaySubscriptionToShape(entity({ quantity: undefined, customer_id: null }));
    expect(shape.quantity).toBe(1);
    expect(shape.customerId).toBe('');
  });
});

describe('handleRazorpayWebhookEvent', () => {
  let repo: SubscriptionRepository;
  beforeEach(async () => {
    repo = createMemorySubscriptionRepository();
    await repo.create('org-1');
  });

  it('applies a subscription event to the org from notes.orgId', async () => {
    const res = await handleRazorpayWebhookEvent(repo, event(), resolve);
    expect(res.handled).toBe(true);
    expect(res.orgId).toBe('org-1');
    expect(res.subscription?.plan).toBe('professional');
    expect(res.subscription?.seats).toBe(4);
  });

  it('applies a cancellation, returning the org to free', async () => {
    await handleRazorpayWebhookEvent(repo, event(), resolve);
    const res = await handleRazorpayWebhookEvent(
      repo,
      event({ status: 'cancelled' }, 'subscription.cancelled'),
      resolve,
    );
    expect(res.subscription?.status).toBe('canceled');
    expect(res.subscription?.planTier).toBe('free');
  });

  it('ignores non-subscription events', async () => {
    const res = await handleRazorpayWebhookEvent(
      repo,
      { event: 'payment.captured', payload: {} },
      resolve,
    );
    expect(res.handled).toBe(false);
    expect(res.subscription).toBeNull();
  });

  it('ignores subscription events without an org id in notes', async () => {
    const res = await handleRazorpayWebhookEvent(repo, event({ notes: {} }), resolve);
    expect(res.handled).toBe(false);
  });
});
