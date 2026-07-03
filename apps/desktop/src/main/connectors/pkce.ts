/**
 * PKCE (RFC 7636) and small OAuth crypto helpers, shared by the OAuth engine.
 * Identical scheme to the app's own auth: base64url(SHA-256(verifier)).
 */
import { createHash, randomBytes } from 'node:crypto';

export function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

/** A fresh PKCE verifier and its S256 challenge. */
export function createPkcePair(): PkcePair {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/** An unguessable opaque value for the OAuth `state` (CSRF defense). */
export function randomState(): string {
  return base64url(randomBytes(24));
}

/** A stable, collision-resistant id for accounts/log lines. */
export function shortId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}
