import { beforeAll, describe, expect, it } from 'vitest';

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
});
