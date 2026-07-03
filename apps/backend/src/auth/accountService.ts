/**
 * Account security flows — email verification and password reset — as pure logic
 * over an injected repository, mailer, and password hasher. No HTTP, no database
 * specifics, so it is fully unit-testable. Routes (next slice) inject the
 * Postgres repository, the real (or dev) mailer, and the argon2 hasher.
 *
 * Privacy: `requestPasswordReset` never reveals whether an email is registered.
 */
import { TOKEN_TTL_MS, type TokenKind, hashToken, newToken } from './tokens';
import type { Mailer } from './mailer';

export type AuthAccountErrorCode = 'invalid' | 'weak_password';

export class AuthAccountError extends Error {
  constructor(
    public readonly code: AuthAccountErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AuthAccountError';
  }
}

export const MIN_PASSWORD_LENGTH = 8;

export interface AuthAccountRepo {
  findUserById(id: string): Promise<{ id: string; email: string; emailVerified: boolean } | null>;
  findUserByEmail(
    email: string,
  ): Promise<{ id: string; email: string; emailVerified: boolean } | null>;
  setEmailVerified(userId: string): Promise<void>;
  updatePasswordHash(userId: string, passwordHash: string): Promise<void>;
  createToken(input: {
    userId: string;
    kind: TokenKind;
    tokenHash: string;
    expiresAt: string;
  }): Promise<void>;
  /** Atomically consume a valid, unexpired, unconsumed token; returns its user, or null. */
  consumeToken(tokenHash: string, kind: TokenKind): Promise<{ userId: string } | null>;
  /** Supersede any active (unconsumed) tokens of this kind for the user. */
  invalidateActiveTokens(userId: string, kind: TokenKind): Promise<void>;
}

export interface AuthAccountDeps {
  repo: AuthAccountRepo;
  mailer: Mailer;
  hashPassword: (plain: string) => Promise<string>;
  /** Base URL used to build verification/reset links. */
  appUrl: string;
  /** Injectable clock (tests). */
  now?: () => number;
}

const clock = (deps: AuthAccountDeps): number => deps.now?.() ?? Date.now();
const expiryFor = (deps: AuthAccountDeps, kind: TokenKind): string =>
  new Date(clock(deps) + TOKEN_TTL_MS[kind]).toISOString();

/* ── Email verification ───────────────────────────────────────────────────── */

export async function requestEmailVerification(
  deps: AuthAccountDeps,
  userId: string,
): Promise<void> {
  const user = await deps.repo.findUserById(userId);
  if (!user) throw new AuthAccountError('invalid', 'User not found.');
  if (user.emailVerified) return; // already verified — nothing to do

  const { token, hash } = newToken();
  await deps.repo.invalidateActiveTokens(user.id, 'email_verify');
  await deps.repo.createToken({
    userId: user.id,
    kind: 'email_verify',
    tokenHash: hash,
    expiresAt: expiryFor(deps, 'email_verify'),
  });
  await deps.mailer.sendEmailVerification(
    user.email,
    `${deps.appUrl}/auth/verify-email?token=${token}`,
  );
}

export async function confirmEmailVerification(
  deps: AuthAccountDeps,
  token: string,
): Promise<void> {
  const consumed = await deps.repo.consumeToken(hashToken(token), 'email_verify');
  if (!consumed)
    throw new AuthAccountError('invalid', 'This verification link is invalid or has expired.');
  await deps.repo.setEmailVerified(consumed.userId);
}

/* ── Password reset ───────────────────────────────────────────────────────── */

export async function requestPasswordReset(deps: AuthAccountDeps, email: string): Promise<void> {
  const user = await deps.repo.findUserByEmail(email.trim().toLowerCase());
  // Do not reveal whether the email is registered: succeed either way.
  if (!user) return;

  const { token, hash } = newToken();
  await deps.repo.invalidateActiveTokens(user.id, 'password_reset');
  await deps.repo.createToken({
    userId: user.id,
    kind: 'password_reset',
    tokenHash: hash,
    expiresAt: expiryFor(deps, 'password_reset'),
  });
  await deps.mailer.sendPasswordReset(
    user.email,
    `${deps.appUrl}/auth/reset-password?token=${token}`,
  );
}

export async function resetPassword(
  deps: AuthAccountDeps,
  token: string,
  newPassword: string,
): Promise<void> {
  // Check the policy before consuming the token, so a weak attempt is retryable.
  if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new AuthAccountError(
      'weak_password',
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  }
  const consumed = await deps.repo.consumeToken(hashToken(token), 'password_reset');
  if (!consumed)
    throw new AuthAccountError('invalid', 'This reset link is invalid or has expired.');
  const passwordHash = await deps.hashPassword(newPassword);
  await deps.repo.updatePasswordHash(consumed.userId, passwordHash);
}
