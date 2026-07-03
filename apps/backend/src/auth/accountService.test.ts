import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryAuthAccountRepo, type MemUser } from './accountRepository.memory';
import type { Mailer } from './mailer';
import type { AuthAccountDeps } from './accountService';
import {
  AuthAccountError,
  confirmEmailVerification,
  requestEmailVerification,
  requestPasswordReset,
  resetPassword,
} from './accountService';
import { TOKEN_TTL_MS } from './tokens';

interface FakeMailer extends Mailer {
  verifications: { email: string; url: string }[];
  resets: { email: string; url: string }[];
}
function fakeMailer(): FakeMailer {
  return {
    verifications: [],
    resets: [],
    async sendEmailVerification(email, url) {
      this.verifications.push({ email, url });
    },
    async sendPasswordReset(email, url) {
      this.resets.push({ email, url });
    },
  };
}

/** Pull the ?token= value out of a link the mailer received. */
function tokenFrom(url: string): string {
  return new URL(url).searchParams.get('token') ?? '';
}

let users: MemUser[];
let mailer: FakeMailer;
let deps: AuthAccountDeps;

beforeEach(() => {
  users = [{ id: 'u1', email: 'user@acme.com', emailVerified: false, passwordHash: 'old-hash' }];
  mailer = fakeMailer();
  deps = {
    repo: createMemoryAuthAccountRepo(users),
    mailer,
    hashPassword: async (pw) => `hashed:${pw}`,
    appUrl: 'https://app.test',
  };
});

describe('email verification', () => {
  it('issues a link and verifies the user on confirm', async () => {
    await requestEmailVerification(deps, 'u1');
    expect(mailer.verifications).toHaveLength(1);
    const token = tokenFrom(mailer.verifications[0]!.url);

    await confirmEmailVerification(deps, token);
    expect(users[0]!.emailVerified).toBe(true);
  });

  it('is a no-op for an already-verified user (no email sent)', async () => {
    users[0]!.emailVerified = true;
    await requestEmailVerification(deps, 'u1');
    expect(mailer.verifications).toHaveLength(0);
  });

  it('rejects an unknown token', async () => {
    await expect(confirmEmailVerification(deps, 'nope')).rejects.toMatchObject({
      name: 'AuthAccountError',
      code: 'invalid',
    });
  });

  it('rejects a reused token (single use)', async () => {
    await requestEmailVerification(deps, 'u1');
    const token = tokenFrom(mailer.verifications[0]!.url);
    await confirmEmailVerification(deps, token);
    await expect(confirmEmailVerification(deps, token)).rejects.toMatchObject({ code: 'invalid' });
  });

  it('rejects an expired token', async () => {
    // Issue the token as if it were created a day-plus ago, so it is already expired.
    deps.now = () => Date.now() - TOKEN_TTL_MS.email_verify - 1000;
    await requestEmailVerification(deps, 'u1');
    const token = tokenFrom(mailer.verifications[0]!.url);
    deps.now = undefined; // confirm "now"
    await expect(confirmEmailVerification(deps, token)).rejects.toMatchObject({ code: 'invalid' });
  });

  it('throws for an unknown user', async () => {
    await expect(requestEmailVerification(deps, 'ghost')).rejects.toBeInstanceOf(AuthAccountError);
  });
});

describe('password reset', () => {
  it('emails a link and resets the password on confirm', async () => {
    await requestPasswordReset(deps, 'user@acme.com');
    expect(mailer.resets).toHaveLength(1);
    const token = tokenFrom(mailer.resets[0]!.url);

    await resetPassword(deps, token, 'a-strong-password');
    expect(users[0]!.passwordHash).toBe('hashed:a-strong-password');
  });

  it('does not reveal unknown emails (no throw, no email)', async () => {
    await requestPasswordReset(deps, 'stranger@acme.com');
    expect(mailer.resets).toHaveLength(0);
  });

  it('rejects a weak password without consuming the token', async () => {
    await requestPasswordReset(deps, 'user@acme.com');
    const token = tokenFrom(mailer.resets[0]!.url);
    await expect(resetPassword(deps, token, 'short')).rejects.toMatchObject({
      code: 'weak_password',
    });
    // token still valid — a strong retry works
    await resetPassword(deps, token, 'a-strong-password');
    expect(users[0]!.passwordHash).toBe('hashed:a-strong-password');
  });

  it('rejects an unknown reset token', async () => {
    await expect(resetPassword(deps, 'nope', 'a-strong-password')).rejects.toMatchObject({
      code: 'invalid',
    });
  });

  it('invalidates a prior token when a new reset is requested', async () => {
    await requestPasswordReset(deps, 'user@acme.com');
    const first = tokenFrom(mailer.resets[0]!.url);
    await requestPasswordReset(deps, 'user@acme.com');
    const second = tokenFrom(mailer.resets[1]!.url);

    await expect(resetPassword(deps, first, 'a-strong-password')).rejects.toMatchObject({
      code: 'invalid',
    });
    await resetPassword(deps, second, 'a-strong-password');
    expect(users[0]!.passwordHash).toBe('hashed:a-strong-password');
  });
});
