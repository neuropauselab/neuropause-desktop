import type { TokenPair } from '@neuropause/shared';
import { loadEnv } from '../config/env';
import { query, withTransaction } from '../db/pool';
import { signAccessToken } from './jwt';
import { hashToken, randomToken } from './pkce';
import { AppError } from '../middleware/error';

const env = loadEnv();

interface SessionRow {
  id: string;
  user_id: string;
  rotated_to: string | null;
  revoked_at: Date | null;
  expires_at: Date;
}

/**
 * Issues a fresh access+refresh pair and persists the refresh token's hash.
 * Returns the plaintext refresh token (shown to the client exactly once).
 */
export async function issueTokens(
  userId: string,
  email: string,
  userAgent: string | null,
): Promise<TokenPair> {
  const refreshToken = randomToken(48);
  const tokenHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + env.JWT_REFRESH_TTL * 1_000);

  await query(
    `INSERT INTO auth_sessions (user_id, token_hash, user_agent, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, tokenHash, userAgent, expiresAt],
  );

  const access = signAccessToken({ sub: userId, email });
  return {
    accessToken: access.token,
    refreshToken,
    accessTokenExpiresAt: access.expiresAt,
  };
}

/**
 * Rotates a refresh token: validates the presented token, issues a new pair,
 * and links old->new. Detects reuse of an already-rotated token and revokes
 * the entire chain for that user as a defensive measure.
 */
export async function rotateTokens(
  refreshToken: string,
  userAgent: string | null,
): Promise<TokenPair> {
  const tokenHash = hashToken(refreshToken);

  return withTransaction(async (client) => {
    const { rows } = await client.query<SessionRow & { email: string }>(
      `SELECT s.id, s.user_id, s.rotated_to, s.revoked_at, s.expires_at, u.email
         FROM auth_sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 FOR UPDATE`,
      [tokenHash],
    );
    const session = rows[0];
    if (!session) throw new AppError(401, 'invalid_refresh', 'Invalid refresh token');

    if (session.revoked_at || session.rotated_to) {
      // Reuse of a consumed token => possible theft. Burn the chain.
      await client.query(
        `UPDATE auth_sessions SET revoked_at = now()
          WHERE user_id = $1 AND revoked_at IS NULL`,
        [session.user_id],
      );
      throw new AppError(401, 'refresh_reused', 'Refresh token reuse detected; sessions revoked');
    }

    if (session.expires_at.getTime() < Date.now()) {
      throw new AppError(401, 'refresh_expired', 'Refresh token expired');
    }

    const newRefresh = randomToken(48);
    const newHash = hashToken(newRefresh);
    const expiresAt = new Date(Date.now() + env.JWT_REFRESH_TTL * 1_000);

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO auth_sessions (user_id, token_hash, user_agent, expires_at)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [session.user_id, newHash, userAgent, expiresAt],
    );

    await client.query(
      `UPDATE auth_sessions SET rotated_to = $1, revoked_at = now() WHERE id = $2`,
      [inserted.rows[0].id, session.id],
    );

    const access = signAccessToken({ sub: session.user_id, email: session.email });
    return {
      accessToken: access.token,
      refreshToken: newRefresh,
      accessTokenExpiresAt: access.expiresAt,
    };
  });
}

/** Revokes a single refresh token (logout on one device). */
export async function revokeToken(refreshToken: string): Promise<void> {
  const tokenHash = hashToken(refreshToken);
  await query(
    `UPDATE auth_sessions SET revoked_at = now()
      WHERE token_hash = $1 AND revoked_at IS NULL`,
    [tokenHash],
  );
}
