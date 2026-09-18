import { describe, it, expect, vi, beforeAll } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// Same controllable Redis mock shape as jwt.test.ts.
const redisStore = new Map<string, string>();
const redisMock = {
  status: 'ready',
  async get(key: string): Promise<string | null> {
    return redisStore.get(key) ?? null;
  },
  async set(key: string, value: string): Promise<string> {
    redisStore.set(key, value);
    return 'OK';
  },
};
vi.mock('../cache/redis', () => ({ redis: redisMock }));
vi.mock('../config/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// Force the PRODUCTION posture ('closed') regardless of the vitest env, which
// sets REVOCATION_FAIL_MODE='open' for the infra-free suites. This file tests
// the closed path against a mocked Redis boundary.
const mockEnv = {
  JWT_ACCESS_SECRET: 'test-secret-test-secret-test-secret-123456',
  JWT_ACCESS_TTL: 900,
  REVOCATION_FAIL_MODE: 'closed',
};
vi.mock('../config/env', () => ({
  loadEnv: () => mockEnv,
  env: mockEnv,
}));

function run(mwToken: string | null) {
  const req = {
    header: (name: string) =>
      name.toLowerCase() === 'authorization' && mwToken ? `Bearer ${mwToken}` : undefined,
  } as unknown as Request;
  const res = {} as Response;
  return new Promise<unknown>((resolve) => {
    const next: NextFunction = ((err?: unknown) => resolve(err ?? null)) as NextFunction;
    import('./requireAuth').then(({ requireAuth }) => void requireAuth(req, res, next));
  });
}

describe('requireAuth — fail-closed revocation (NP-RELEASE-044 §5)', () => {
  beforeAll(() => {
    process.env.JWT_ACCESS_SECRET = 'test-secret-test-secret-test-secret-123456';
    process.env.DATABASE_URL = 'postgres://u:p@127.0.0.1:5432/db';
    process.env.REDIS_URL = 'redis://127.0.0.1:6379';
  });

  it('valid token + Redis healthy => request proceeds', async () => {
    const { signAccessToken } = await import('./jwt');
    const { token } = signAccessToken({ sub: 'ra-1', email: 'a@b.co' });
    redisMock.status = 'ready';
    expect(await run(token)).toBeNull();
  });

  it('revoked token => 401 token_revoked', async () => {
    const { signAccessToken, revokeAccessToken } = await import('./jwt');
    const { token } = signAccessToken({ sub: 'ra-2', email: 'b@b.co' });
    await revokeAccessToken(token);
    const err = (await run(token)) as { status: number; code: string };
    expect(err.status).toBe(401);
    expect(err.code).toBe('token_revoked');
  });

  it('Redis unavailable => deterministic 503 revocation_unavailable (NOT allowed)', async () => {
    const { signAccessToken, resetLocalDenyCache } = await import('./jwt');
    resetLocalDenyCache();
    const { token } = signAccessToken({ sub: 'ra-3', email: 'c@b.co' });
    redisMock.status = 'end';
    try {
      const err = (await run(token)) as { status: number; code: string };
      expect(err.status).toBe(503);
      expect(err.code).toBe('revocation_unavailable');
    } finally {
      redisMock.status = 'ready';
    }
  });

  it('missing token => 401 missing_token', async () => {
    const err = (await run(null)) as { status: number; code: string };
    expect(err.status).toBe(401);
    expect(err.code).toBe('missing_token');
  });

  it('garbage token => 401 invalid_token', async () => {
    const err = (await run('not-a-jwt')) as { status: number; code: string };
    expect(err.status).toBe(401);
    expect(err.code).toBe('invalid_token');
  });
});
