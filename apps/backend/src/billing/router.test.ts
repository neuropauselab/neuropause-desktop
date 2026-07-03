import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CloudOrgRole } from '@neuropause/shared';
import { createMemorySubscriptionRepository } from '../subscriptions/memoryRepository';
import type { SubscriptionRepository } from '../subscriptions/types';
import type { BillingGateway, CreatedSubscription } from './gateway';
import { createBillingRouter } from './router';
import { createBillingWebhookHandler } from './webhookHandler';

// Loose JSON typing for test response bodies.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const roleByUser: Record<string, CloudOrgRole> = {
  owner: 'owner',
  admin: 'admin',
  member: 'member',
};
const getMemberRole = async (_orgId: string, userId: string): Promise<CloudOrgRole | null> =>
  roleByUser[userId] ?? null;

let cancelCalls: { id: string; atCycleEnd: boolean }[] = [];
const gateway: BillingGateway = {
  async createSubscription({ plan, seats }): Promise<CreatedSubscription> {
    return {
      subscriptionId: `sub_${plan}`,
      customerId: 'cust_1',
      shortUrl: `https://rzp.test/${plan}?seats=${seats}`,
      status: 'created',
    };
  },
  async cancelSubscription(id, atCycleEnd): Promise<void> {
    cancelCalls.push({ id, atCycleEnd });
  },
};

function errorHandler(
  err: Json,
  _req: express.Request,
  res: express.Response,
  _next: express.NextFunction,
): void {
  const status = typeof err?.status === 'number' ? err.status : 500;
  res
    .status(status)
    .json({ error: { code: err?.code ?? 'error', message: err?.message ?? 'error' } });
}

describe('billing router', () => {
  let subscriptions: SubscriptionRepository;
  let server: Server;
  let base: string;

  beforeAll(() => {
    subscriptions = createMemorySubscriptionRepository();
    const app = express();
    app.use((req, _res, next) => {
      req.userId = req.header('x-test-user') || undefined;
      next();
    });
    app.use(express.json());
    app.use('/billing', createBillingRouter({ subscriptions, gateway, getMemberRole }));
    app.use(errorHandler);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server.close();
  });
  beforeEach(() => {
    cancelCalls = [];
  });

  async function req(
    method: string,
    path: string,
    user?: string,
    body?: unknown,
  ): Promise<{ status: number; json: Json }> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (user) headers['x-test-user'] = user;
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  }

  it('GET subscription returns the row and the plan catalog for a member', async () => {
    await subscriptions.create('org-get');
    const r = await req('GET', '/billing/org-get/subscription', 'member');
    expect(r.status).toBe(200);
    expect(r.json.plans).toHaveLength(4);
  });

  it('checkout creates a subscription and records provider ids (manager)', async () => {
    await subscriptions.create('org-co');
    const r = await req('POST', '/billing/org-co/checkout', 'owner', { plan: 'starter' });
    expect(r.status).toBe(201);
    expect(r.json.checkoutUrl).toContain('starter');
    const sub = await subscriptions.getByOrg('org-co');
    expect(sub?.providerSubscriptionId).toBe('sub_starter');
    expect(sub?.plan).toBe('starter');
  });

  it('checkout is forbidden for a plain member', async () => {
    await subscriptions.create('org-mem');
    const r = await req('POST', '/billing/org-mem/checkout', 'member', { plan: 'starter' });
    expect(r.status).toBe(403);
  });

  it('checkout is forbidden for a non-member', async () => {
    await subscriptions.create('org-str');
    const r = await req('POST', '/billing/org-str/checkout', 'stranger', { plan: 'starter' });
    expect(r.status).toBe(403);
  });

  it('checkout rejects a sales-assisted (enterprise) plan', async () => {
    await subscriptions.create('org-ent');
    const r = await req('POST', '/billing/org-ent/checkout', 'owner', { plan: 'enterprise' });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe('not_self_serve');
  });

  it('cancel cancels the existing subscription at cycle end (manager)', async () => {
    await subscriptions.create('org-cancel');
    await subscriptions.update('org-cancel', { providerSubscriptionId: 'sub_x' });
    const r = await req('POST', '/billing/org-cancel/cancel', 'owner');
    expect(r.status).toBe(200);
    expect(cancelCalls).toEqual([{ id: 'sub_x', atCycleEnd: true }]);
  });

  it('cancel 404s when there is no subscription', async () => {
    await subscriptions.create('org-nosub');
    const r = await req('POST', '/billing/org-nosub/cancel', 'owner');
    expect(r.status).toBe(404);
  });
});

describe('billing webhook handler (HTTP)', () => {
  const SECRET = 'whsec_test';
  const sign = (b: string): string => createHmac('sha256', SECRET).update(b).digest('hex');
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const repo = createMemorySubscriptionRepository();
    await repo.create('org-wh');
    const app = express();
    app.post(
      '/billing/webhook',
      express.raw({ type: '*/*' }),
      createBillingWebhookHandler({ subscriptions: repo, webhookSecret: SECRET }),
    );
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server.close();
  });

  async function post(body: string, signature: string): Promise<{ status: number; json: Json }> {
    const res = await fetch(`${base}/billing/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-razorpay-signature': signature },
      body,
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  }

  it('rejects a bad signature with 400', async () => {
    const body = JSON.stringify({ event: 'subscription.activated' });
    const r = await post(body, 'not-a-valid-signature');
    expect(r.status).toBe(400);
  });

  it('accepts a valid signature and acknowledges an event without an org id', async () => {
    const body = JSON.stringify({
      event: 'subscription.activated',
      payload: {
        subscription: { entity: { id: 'sub_1', plan_id: 'plan_x', status: 'active', notes: {} } },
      },
    });
    const r = await post(body, sign(body));
    expect(r.status).toBe(200);
    expect(r.json.received).toBe(true);
    expect(r.json.handled).toBe(false);
  });

  it('rejects a malformed body with 400', async () => {
    const body = 'not json';
    const r = await post(body, sign(body));
    expect(r.status).toBe(400);
  });
});
