/**
 * Auth integration tests against a REAL Postgres + Redis (Phase 3 desktop-E2E
 * certification of the desktop's authentication path). Excluded from the default
 * run; invoked via `npm run test:integration` with TEST_DATABASE_URL (and a
 * reachable REDIS_URL). Exercises the production service + session layer — the
 * same code the `/auth/email/*`, `/auth/token/refresh`, and `/auth/logout`
 * routes call — so registration, credential verification (argon2), refresh-token
 * rotation, and revocation are proven end-to-end against the database, not mocks.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../db/pool';
import { closeRedis } from '../cache/redis';
import { runMigrations } from '../db/migrate';
import { registerEmailUser, authenticateEmailUser } from '../users/service';
import { findUserById } from '../users/repository';
import { issueTokens, rotateTokens, revokeToken } from '../auth/session';

beforeAll(async () => {
  await runMigrations();
});

afterAll(async () => {
  await Promise.allSettled([closePool(), closeRedis()]);
});

beforeEach(async () => {
  await query('TRUNCATE auth_tokens, auth_sessions, auth_identities, users RESTART IDENTITY CASCADE');
});

const PW = 'E2e-Test-Pass-9271';

describe('email registration + credential verification (real Postgres, argon2)', () => {
  it('registers a user that is retrievable by id', async () => {
    const user = await registerEmailUser('e2e_reg@acme.test', PW);
    expect(user.email).toBe('e2e_reg@acme.test');
    const found = await findUserById(user.id);
    expect(found?.email).toBe('e2e_reg@acme.test');
  });

  it('rejects a duplicate registration', async () => {
    await registerEmailUser('e2e_dup@acme.test', PW);
    await expect(registerEmailUser('e2e_dup@acme.test', PW)).rejects.toMatchObject({
      code: 'email_taken',
    });
  });

  it('authenticates with the correct password and rejects a wrong one', async () => {
    const user = await registerEmailUser('e2e_login@acme.test', PW);
    const ok = await authenticateEmailUser('e2e_login@acme.test', PW);
    expect(ok.id).toBe(user.id);
    await expect(authenticateEmailUser('e2e_login@acme.test', 'WRONG')).rejects.toThrow();
  });

  it('does not leak whether an unknown email exists (rejects the same way)', async () => {
    await expect(authenticateEmailUser('nobody@acme.test', PW)).rejects.toThrow();
  });
});

describe('refresh-token rotation + revocation (real Postgres)', () => {
  it('rotates a refresh token and invalidates the used one', async () => {
    const user = await registerEmailUser('e2e_rotate@acme.test', PW);
    const first = await issueTokens(user.id, user.email, 'integration-test');
    expect(first.accessToken).toBeTruthy();
    expect(first.refreshToken).toBeTruthy();

    const rotated = await rotateTokens(first.refreshToken, 'integration-test');
    expect(rotated.refreshToken).toBeTruthy();
    expect(rotated.refreshToken).not.toBe(first.refreshToken);

    // The consumed refresh token must no longer be usable.
    await expect(rotateTokens(first.refreshToken, 'integration-test')).rejects.toThrow();
  });

  it('revokes a refresh token so it can no longer be rotated', async () => {
    const user = await registerEmailUser('e2e_revoke@acme.test', PW);
    const tokens = await issueTokens(user.id, user.email, 'integration-test');
    await revokeToken(tokens.refreshToken);
    await expect(rotateTokens(tokens.refreshToken, 'integration-test')).rejects.toThrow();
  });
});
