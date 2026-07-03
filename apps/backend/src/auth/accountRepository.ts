/**
 * Postgres AuthAccountRepo. Token consumption is atomic: a single conditional
 * UPDATE marks the token consumed only if it is unconsumed and unexpired, so a
 * token cannot be redeemed twice even under concurrency. Exercised by the
 * integration suite.
 */
import { query } from '../db/pool';
import type { AuthAccountRepo } from './accountService';

export function createPgAuthAccountRepo(): AuthAccountRepo {
  return {
    async findUserById(id) {
      const { rows } = await query<{ id: string; email: string; email_verified: boolean }>(
        'SELECT id, email, email_verified FROM users WHERE id = $1',
        [id],
      );
      const r = rows[0];
      return r ? { id: r.id, email: r.email, emailVerified: r.email_verified } : null;
    },
    async findUserByEmail(email) {
      const { rows } = await query<{ id: string; email: string; email_verified: boolean }>(
        'SELECT id, email, email_verified FROM users WHERE email = $1',
        [email],
      );
      const r = rows[0];
      return r ? { id: r.id, email: r.email, emailVerified: r.email_verified } : null;
    },
    async setEmailVerified(userId) {
      await query('UPDATE users SET email_verified = TRUE WHERE id = $1', [userId]);
    },
    async updatePasswordHash(userId, passwordHash) {
      await query('UPDATE users SET password_hash = $2 WHERE id = $1', [userId, passwordHash]);
    },
    async createToken(input) {
      await query(
        'INSERT INTO auth_tokens (user_id, kind, token_hash, expires_at) VALUES ($1, $2, $3, $4)',
        [input.userId, input.kind, input.tokenHash, input.expiresAt],
      );
    },
    async consumeToken(tokenHash, kind) {
      const { rows } = await query<{ user_id: string }>(
        `UPDATE auth_tokens SET consumed_at = now()
         WHERE token_hash = $1 AND kind = $2 AND consumed_at IS NULL AND expires_at > now()
         RETURNING user_id`,
        [tokenHash, kind],
      );
      return rows[0] ? { userId: rows[0].user_id } : null;
    },
    async invalidateActiveTokens(userId, kind) {
      await query(
        'UPDATE auth_tokens SET consumed_at = now() WHERE user_id = $1 AND kind = $2 AND consumed_at IS NULL',
        [userId, kind],
      );
    },
  };
}
