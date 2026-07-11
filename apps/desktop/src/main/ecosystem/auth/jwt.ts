/**
 * Minimal HS256 JWT sign/verify (P3.0, Increment 3) — dependency-free, Node crypto.
 *
 * Used to mint OAuth 2.1 client-credentials access tokens. Standard compact JWS:
 * `base64url(header).base64url(payload).base64url(HMAC-SHA256(header.payload))`.
 * Verification is signature-first with a timing-safe comparison, then `exp`. Pure:
 * the secret + clock are injected, so it unit-tests deterministically.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

function b64urlJson(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}

function hmac(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

/** Sign a claims object into a compact HS256 JWT. Pure. */
export function signJwt(claims: Record<string, unknown>, secret: string): string {
  const header = b64urlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = b64urlJson(claims);
  const data = `${header}.${payload}`;
  return `${data}.${hmac(data, secret)}`;
}

/**
 * Verify a compact HS256 JWT. Returns the decoded claims when the signature is valid
 * and the token is unexpired (per `nowMs`), else null. Never throws.
 */
export function verifyJwt(
  token: string,
  secret: string,
  nowMs: number = Date.now(),
): Record<string, unknown> | null {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  const expected = hmac(`${header}.${payload}`, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
  const exp = typeof claims.exp === 'number' ? claims.exp : 0;
  if (exp > 0 && exp * 1000 <= nowMs) return null;
  return claims;
}
