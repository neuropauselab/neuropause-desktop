import { beforeAll, describe, expect, it, vi } from 'vitest';

// Mock Redis for revocation tests. `status: 'ready'` makes the code treat the
// mock as a healthy connection so the Redis-backed path is exercised.
const redisStore = new Map<string, string>();
vi.mock('../cache/redis', () => ({
  redis: {
    status: 'ready',
    async get(key: string): Promise<string | null> {
      return redisStore.get(key) ?? null;
    },
    async set(key: string, value: string, _mode?: string, _ttl?: number): Promise<string> {
      redisStore.set(key, value);
      return 'OK';
    },
  },
}));

vi.mock('../config/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

describe('jwt', () => {
  beforeAll(() => {
    process.env.JWT_ACCESS_SECRET = 'test-secret-test-secret-test-secret-123456';
    process.env.DATABASE_URL = 'postgres://u:p@127.0.0.1:5432/db';
    process.env.REDIS_URL = 'redis://127.0.0.1:6379';
  });

  it('round-trips claims and verifies the signature', async () => {
    const { signAccessToken, verifyAccessToken } = await import('./jwt');
    const { token, expiresAt } = signAccessToken({ sub: 'user-1', email: 'a@b.co' });
    expect(expiresAt).toBeGreaterThan(Date.now());
    const claims = verifyAccessToken(token);
    expect(claims.sub).toBe('user-1');
    expect(claims.email).toBe('a@b.co');
  });

  it('rejects a tampered token', async () => {
    const { signAccessToken, verifyAccessToken } = await import('./jwt');
    const { token } = signAccessToken({ sub: 'user-1', email: 'a@b.co' });
    expect(() => verifyAccessToken(token + 'x')).toThrow();
  });

  // ── NP-RELEASE-044 §5 / DECISION-4 — three-state revocation model ─────────

  it('valid token + Redis healthy => allowed', async () => {
    const { signAccessToken, checkAccessTokenRevocation, resetLocalDenyCache } =
      await import('./jwt');
    resetLocalDenyCache();
    const { token } = signAccessToken({ sub: 'user-2', email: 'b@b.co' });
    expect(await checkAccessTokenRevocation(token, 'user-2')).toBe('allowed');
  });

  it('revoked token + Redis healthy => revoked', async () => {
    const { signAccessToken, revokeAccessToken, checkAccessTokenRevocation } =
      await import('./jwt');
    const { token } = signAccessToken({ sub: 'user-2', email: 'b@b.co' });
    await revokeAccessToken(token);
    expect(await checkAccessTokenRevocation(token, 'user-2')).toBe('revoked');
  });

  it('revokeAllAccessTokensForUser revokes prior tokens; later tokens are allowed', async () => {
    const { signAccessToken, revokeAllAccessTokensForUser, checkAccessTokenRevocation } =
      await import('./jwt');
    const { token: oldToken } = signAccessToken({ sub: 'user-3', email: 'c@b.co' });

    await revokeAllAccessTokensForUser('user-3');
    expect(await checkAccessTokenRevocation(oldToken, 'user-3')).toBe('revoked');

    // A token minted after the revocation second is allowed. The revocation
    // timestamp is now+1s (covers same-second minting against JWT `iat`
    // whole-second granularity), so cross two second boundaries.
    await new Promise((r) => setTimeout(r, 2100));
    const { token: newToken } = signAccessToken({ sub: 'user-3', email: 'c@b.co' });
    expect(await checkAccessTokenRevocation(newToken, 'user-3')).toBe('allowed');
  });

  it('Redis unavailable + unrevoked token => authority_unavailable, NEVER allowed (fail closed)', async () => {
    const { signAccessToken, checkAccessTokenRevocation, resetLocalDenyCache } =
      await import('./jwt');
    const { redis } = (await import('../cache/redis')) as unknown as {
      redis: { status: string };
    };
    resetLocalDenyCache();
    const { token } = signAccessToken({ sub: 'user-6', email: 'f@b.co' });
    redis.status = 'end'; // down/reconnecting
    try {
      expect(await checkAccessTokenRevocation(token, 'user-6')).toBe('authority_unavailable');
    } finally {
      redis.status = 'ready';
    }
  });

  it('same-process revocation is enforced from the local cache even without Redis', async () => {
    const { signAccessToken, revokeAccessToken, checkAccessTokenRevocation, resetLocalDenyCache } =
      await import('./jwt');
    const { redis } = (await import('../cache/redis')) as unknown as {
      redis: { status: string };
    };
    resetLocalDenyCache();
    const { token } = signAccessToken({ sub: 'user-4', email: 'd@b.co' });
    redis.status = 'end';
    try {
      await revokeAccessToken(token); // recorded locally only
      expect(await checkAccessTokenRevocation(token, 'user-4')).toBe('revoked');
    } finally {
      redis.status = 'ready';
    }
  });

  it('cross-process revocation via Redis is honored when the local cache is empty', async () => {
    const { signAccessToken, revokeAccessToken, checkAccessTokenRevocation, resetLocalDenyCache } =
      await import('./jwt');
    const { token } = signAccessToken({ sub: 'user-5', email: 'e@b.co' });
    await revokeAccessToken(token); // writes local + redis mock
    resetLocalDenyCache(); // simulate a different process: only Redis holds it
    expect(await checkAccessTokenRevocation(token, 'user-5')).toBe('revoked');
  });

  it('Redis recovery restores normal allowed/revoked behavior', async () => {
    const { signAccessToken, checkAccessTokenRevocation, resetLocalDenyCache } =
      await import('./jwt');
    const { redis } = (await import('../cache/redis')) as unknown as {
      redis: { status: string };
    };
    resetLocalDenyCache();
    const { token } = signAccessToken({ sub: 'user-7', email: 'g@b.co' });
    redis.status = 'end';
    expect(await checkAccessTokenRevocation(token, 'user-7')).toBe('authority_unavailable');
    redis.status = 'ready'; // recovery
    expect(await checkAccessTokenRevocation(token, 'user-7')).toBe('allowed');
  });
});
