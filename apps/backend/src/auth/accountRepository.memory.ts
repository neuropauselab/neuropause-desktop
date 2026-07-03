/**
 * In-memory AuthAccountRepo for unit tests. Callers pass the user records they
 * want to seed; the repo mutates those records in place (setEmailVerified /
 * updatePasswordHash), so a test can assert on its own array afterward.
 */
import type { TokenKind } from './tokens';
import type { AuthAccountRepo } from './accountService';

export interface MemUser {
  id: string;
  email: string;
  emailVerified: boolean;
  passwordHash: string | null;
}

interface TokenRow {
  userId: string;
  kind: TokenKind;
  tokenHash: string;
  expiresAt: string;
  consumedAt: string | null;
}

export function createMemoryAuthAccountRepo(users: MemUser[]): AuthAccountRepo {
  const tokens: TokenRow[] = [];
  const view = (u: MemUser | undefined) =>
    u ? { id: u.id, email: u.email, emailVerified: u.emailVerified } : null;

  return {
    async findUserById(id) {
      return view(users.find((u) => u.id === id));
    },
    async findUserByEmail(email) {
      return view(users.find((u) => u.email.toLowerCase() === email.toLowerCase()));
    },
    async setEmailVerified(userId) {
      const u = users.find((x) => x.id === userId);
      if (u) u.emailVerified = true;
    },
    async updatePasswordHash(userId, passwordHash) {
      const u = users.find((x) => x.id === userId);
      if (u) u.passwordHash = passwordHash;
    },
    async createToken(input) {
      tokens.push({ ...input, consumedAt: null });
    },
    async consumeToken(tokenHash, kind) {
      const t = tokens.find(
        (x) =>
          x.tokenHash === tokenHash &&
          x.kind === kind &&
          !x.consumedAt &&
          Date.parse(x.expiresAt) > Date.now(),
      );
      if (!t) return null;
      t.consumedAt = new Date().toISOString();
      return { userId: t.userId };
    },
    async invalidateActiveTokens(userId, kind) {
      const at = new Date().toISOString();
      for (const t of tokens) {
        if (t.userId === userId && t.kind === kind && !t.consumedAt) t.consumedAt = at;
      }
    },
  };
}
