/**
 * Opaque single-use tokens for account flows (email verification, password
 * reset). We hand the raw token to the user (via email) and persist only its
 * SHA-256 hash, so a database leak does not expose usable tokens.
 */
import { createHash, randomBytes } from 'node:crypto';

export type TokenKind = 'email_verify' | 'password_reset';

/** How long each kind of token is valid for. */
export const TOKEN_TTL_MS: Record<TokenKind, number> = {
  email_verify: 1000 * 60 * 60 * 24, // 24 hours
  password_reset: 1000 * 60 * 60, // 1 hour
};

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** A fresh opaque token and its storage hash. */
export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: sha256(token) };
}

/** The storage hash for a presented token. */
export function hashToken(token: string): string {
  return sha256(token);
}
