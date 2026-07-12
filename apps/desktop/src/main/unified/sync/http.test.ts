/**
 * HttpClient status classification — the GitHub-shaped rate-limit vs auth distinction (P5 — Increment 5).
 * A 403 means two very different things on GitHub: a genuine auth/scope failure, OR a rate limit
 * (PRIMARY exhaustion via x-ratelimit-remaining:0, or a SECONDARY/abuse limit via Retry-After with
 * remaining > 0). Rate limits must back off (RateLimitError + gate.penalize); only a bare 403 is an
 * AuthError (which the family's graceful() maps to a degraded "scope not granted"). Pure-node: a stubbed
 * global fetch stands in for the transport.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthError, HttpClient, RateLimitError, type RateGate } from './http';

function gate(): RateGate & { penalized: number } {
  const g = { penalized: 0, acquire: (): Promise<void> => Promise.resolve(), penalize: (): void => { g.penalized += 1; } };
  return g;
}

/** Stub global fetch with one response (status + headers); error paths never read the body. */
function stubFetch(status: number, headers: Record<string, string>): void {
  vi.stubGlobal('fetch', () =>
    Promise.resolve({
      status,
      headers: { forEach: (cb: (v: string, k: string) => void) => { for (const [k, v] of Object.entries(headers)) cb(v, k); } },
      text: () => Promise.resolve(''),
    }),
  );
}

const client = (g: RateGate = gate()): HttpClient => new HttpClient('github', () => Promise.resolve('token'), g);

describe('HttpClient — GitHub 403 rate-limit vs auth classification', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('a 403 with Retry-After (secondary/abuse limit, remaining > 0) is a RateLimitError, not auth', async () => {
    stubFetch(403, { 'retry-after': '30', 'x-ratelimit-remaining': '12' });
    await expect(client().getJson('https://api.github.com/user/orgs')).rejects.toBeInstanceOf(RateLimitError);
  });

  it('a 403 with x-ratelimit-remaining: 0 (primary exhaustion) is a RateLimitError', async () => {
    stubFetch(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 60) });
    await expect(client().getJson('https://api.github.com/user/orgs')).rejects.toBeInstanceOf(RateLimitError);
  });

  it('a bare 403 (no rate-limit headers) stays an AuthError → the family degrades it to "scope not granted"', async () => {
    stubFetch(403, {});
    await expect(client().getJson('https://api.github.com/user/orgs')).rejects.toBeInstanceOf(AuthError);
  });

  it('penalizes the rate gate on a rate-limited 403 so the next request backs off', async () => {
    stubFetch(403, { 'retry-after': '5' });
    const g = gate();
    await expect(client(g).getJson('https://api.github.com/user/orgs')).rejects.toBeInstanceOf(RateLimitError);
    expect(g.penalized).toBe(1);
  });
});
