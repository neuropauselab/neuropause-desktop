import { describe, expect, it } from 'vitest';
import { decideGateway, apiVersionInfo, type GatewayContext } from './gateway';
import type { ApiKey, GatewayRequestInput } from '@neuropause/shared';

function key(scopes: ApiKey['scopes']): ApiKey {
  return {
    id: 'key_1',
    developerId: 'dev_1',
    name: 'k',
    prefix: 'npk_live_x',
    last4: '0000',
    scopes,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
  };
}

function ctx(overrides: Partial<GatewayContext> = {}): GatewayContext {
  return {
    key: key(['marketplace:read']),
    developerId: 'dev_1',
    versionInfo: apiVersionInfo('v1'),
    rateLimit: { windowMs: 60_000, max: 60 },
    quota: { period: 'month', limit: 1000 },
    rateRemaining: 60,
    quotaUsed: 0,
    now: Date.now(),
    ...overrides,
  };
}

const req: GatewayRequestInput = { apiKey: 'tok', method: 'GET', path: '/v1/marketplace', version: 'v1', scope: 'marketplace:read' };

describe('decideGateway', () => {
  it('allows an authorized request and decrements remaining', () => {
    const d = decideGateway(req, ctx());
    expect(d.allowed).toBe(true);
    expect(d.status).toBe(200);
    expect(d.rateRemaining).toBe(59);
    expect(d.quotaRemaining).toBe(999);
  });

  it('rejects a missing key with 401', () => {
    const d = decideGateway({ ...req, apiKey: null }, ctx({ key: null, developerId: null }));
    expect(d.status).toBe(401);
    expect(d.allowed).toBe(false);
  });

  it('rejects a missing scope with 403', () => {
    const d = decideGateway({ ...req, scope: 'marketplace:publish' }, ctx());
    expect(d.status).toBe(403);
  });

  it('rejects when rate window is exhausted with 429 + retryAfter', () => {
    const d = decideGateway(req, ctx({ rateRemaining: 0 }));
    expect(d.status).toBe(429);
    expect(d.retryAfterMs).toBe(60_000);
  });

  it('rejects when quota is exhausted with 429', () => {
    const d = decideGateway(req, ctx({ quotaUsed: 1000 }));
    expect(d.status).toBe(429);
    expect(d.reason).toMatch(/quota/i);
  });

  it('returns 410 for a sunset version', () => {
    const sunset = { version: 'v1' as const, status: 'sunset' as const, since: '', sunsetAt: '', notes: '' };
    const d = decideGateway(req, ctx({ versionInfo: sunset }));
    expect(d.status).toBe(410);
  });

  it('allows a request with no scope requirement', () => {
    const d = decideGateway({ ...req, scope: null }, ctx());
    expect(d.allowed).toBe(true);
  });
});
