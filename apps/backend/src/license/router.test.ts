import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CloudOrgRole } from '@neuropause/shared';
import { GRACE_DAYS } from '@neuropause/shared';
import { createMemorySubscriptionRepository } from '../subscriptions/memoryRepository';
import type { SubscriptionRepository } from '../subscriptions/types';
import { createLicenseRouter } from './router';

// Loose JSON typing for test response bodies.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const DAY_MS = 24 * 60 * 60 * 1000;

const roleByUser: Record<string, CloudOrgRole> = {
  owner: 'owner',
  member: 'member',
};
const getMemberRole = async (_orgId: string, userId: string): Promise<CloudOrgRole | null> =>
  roleByUser[userId] ?? null;

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

describe('license router', () => {
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
    app.use('/license', createLicenseRouter({ subscriptions, getMemberRole }));
    app.use(errorHandler);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server.close();
  });

  async function req(path: string, user?: string): Promise<{ status: number; json: Json }> {
    const headers: Record<string, string> = {};
    if (user) headers['x-test-user'] = user;
    const res = await fetch(`${base}${path}`, { headers });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  }

  it('rejects an unauthenticated request', async () => {
    const r = await req('/license/org-1');
    expect(r.status).toBe(401);
  });

  it('rejects a non-member', async () => {
    const r = await req('/license/org-1', 'stranger');
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe('not_member');
  });

  it('treats an org with no subscription as a valid free license', async () => {
    const r = await req('/license/org-none', 'member');
    expect(r.status).toBe(200);
    expect(r.json.orgId).toBe('org-none');
    expect(r.json.snapshot).toMatchObject({ planTier: 'free', status: 'active' });
    expect(r.json.evaluation).toMatchObject({
      state: 'valid',
      reason: 'active',
      entitledPlan: 'free',
    });
    expect(typeof r.json.checkedAt).toBe('string');
  });

  it('reports a valid pro license for an active subscription inside its period', async () => {
    await subscriptions.create('org-pro');
    await subscriptions.update('org-pro', {
      planTier: 'pro',
      status: 'active',
      currentPeriodEnd: '2099-01-01T00:00:00.000Z',
    });
    const r = await req('/license/org-pro', 'member');
    expect(r.status).toBe(200);
    expect(r.json.evaluation).toMatchObject({
      state: 'valid',
      reason: 'active',
      entitledPlan: 'pro',
    });
    expect(r.json.snapshot.currentPeriodEnd).toBe('2099-01-01T00:00:00.000Z');
  });

  it('reports grace (keeping the plan) for a past_due subscription just past its period', async () => {
    await subscriptions.create('org-due');
    await subscriptions.update('org-due', {
      planTier: 'pro',
      status: 'past_due',
      currentPeriodEnd: new Date(Date.now() - DAY_MS).toISOString(),
    });
    const r = await req('/license/org-due', 'owner');
    expect(r.status).toBe(200);
    expect(r.json.evaluation).toMatchObject({
      state: 'grace',
      reason: 'past_due_grace',
      entitledPlan: 'pro',
    });
    expect(r.json.evaluation.graceDaysRemaining).toBeGreaterThan(0);
    expect(r.json.evaluation.graceDaysRemaining).toBeLessThanOrEqual(GRACE_DAYS);
  });

  it('reports an invalid (free) license for a canceled subscription past its period', async () => {
    await subscriptions.create('org-gone');
    await subscriptions.update('org-gone', {
      planTier: 'enterprise',
      status: 'canceled',
      currentPeriodEnd: new Date(Date.now() - DAY_MS).toISOString(),
    });
    const r = await req('/license/org-gone', 'member');
    expect(r.status).toBe(200);
    expect(r.json.evaluation).toMatchObject({
      state: 'invalid',
      reason: 'canceled',
      entitledPlan: 'free',
    });
  });
});
