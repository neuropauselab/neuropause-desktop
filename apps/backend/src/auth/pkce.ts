import { createHash, randomBytes } from 'node:crypto';

/** base64url without padding, per RFC 7636. */
function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function sha256Base64url(input: string): string {
  return base64url(createHash('sha256').update(input).digest());
}

/** Generates a PKCE verifier (43-128 chars) and its S256 challenge. */
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  return { verifier, challenge: sha256Base64url(verifier) };
}

/** Constant-time-ish verification of a PKCE challenge. */
export function verifyPkce(verifier: string, expectedChallenge: string): boolean {
  return sha256Base64url(verifier) === expectedChallenge;
}

export function randomToken(bytes = 32): string {
  return base64url(randomBytes(bytes));
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
