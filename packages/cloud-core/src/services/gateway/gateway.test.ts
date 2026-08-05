import { describe, it, expect } from 'vitest';
import { ManualClock } from '../../lib/clock';
import { RateLimiter } from './rateLimiter';
import { Gateway, type GatewayRequest } from './gateway';

const req = (over: Partial<GatewayRequest> = {}): GatewayRequest => ({
  version: 'v1',
  method: 'GET',
  path: '/x',
  ctx: { authenticated: false, roles: [] },
  ...over,
});

describe('RateLimiter (token bucket)', () => {
  it('allows up to capacity then blocks, and refills over time', () => {
    const clock = new ManualClock(0);
    const rl = new RateLimiter(clock, { capacity: 2, refillPerSec: 1 });
    expect(rl.allow('k')).toBe(true);
    expect(rl.allow('k')).toBe(true);
    expect(rl.allow('k')).toBe(false);
    clock.advance(1000); // +1 token
    expect(rl.allow('k')).toBe(true);
    expect(rl.allow('k')).toBe(false);
  });
});

describe('Gateway routing + versioning', () => {
  it('routes by version', () => {
    const gw = new Gateway();
    gw.register({ version: 'v1', method: 'GET', path: '/x', policy: 'public', handler: () => 'v1-result' });
    gw.register({ version: 'v2', method: 'GET', path: '/x', policy: 'public', handler: () => 'v2-result' });
    expect(gw.handle(req({ version: 'v1' })).data).toBe('v1-result');
    expect(gw.handle(req({ version: 'v2' })).data).toBe('v2-result');
  });

  it('returns not_found for an unknown route, with a trace id', () => {
    const gw = new Gateway();
    const res = gw.handle(req({ path: '/nope' }));
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('not_found');
    expect(res.traceId.startsWith('trace_')).toBe(true);
  });
});

describe('Gateway authorization', () => {
  it('enforces authentication and roles', () => {
    const gw = new Gateway();
    gw.register({ version: 'v1', method: 'POST', path: '/admin', policy: 'authenticated', roles: ['admin'], handler: () => 'ok' });

    expect(gw.handle(req({ method: 'POST', path: '/admin' })).error?.code).toBe('unauthorized');
    expect(
      gw.handle(req({ method: 'POST', path: '/admin', ctx: { authenticated: true, roles: ['member'] } })).error?.code,
    ).toBe('forbidden');
    expect(
      gw.handle(req({ method: 'POST', path: '/admin', ctx: { authenticated: true, roles: ['admin'] } })).data,
    ).toBe('ok');
  });
});

describe('Gateway rate limiting + audit hook', () => {
  it('rate-limits and reports every decision to the audit hook', () => {
    const clock = new ManualClock(0);
    const audits: number[] = [];
    const gw = new Gateway(new RateLimiter(clock, { capacity: 1, refillPerSec: 0 }), (info) => audits.push(info.status));
    gw.register({ version: 'v1', method: 'GET', path: '/x', policy: 'public', handler: () => 'ok' });
    expect(gw.handle(req()).ok).toBe(true); // 200
    expect(gw.handle(req()).error?.code).toBe('rate_limited'); // 429
    expect(audits).toEqual([200, 429]);
  });
});
