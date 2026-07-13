/**
 * Pure, Electron-free token helpers for the OAuth engine. Kept in their own module so the
 * standards-sensitive expiry logic is unit-testable without importing `oauthEngine` (which pulls in
 * Electron's `shell`).
 */

/**
 * Compute the access-token expiry (epoch ms). Standard providers return `expires_in`; that always wins.
 * When it is absent, `ttlSeconds` (the manifest's `accessTokenTtlSeconds`) is a FALLBACK for providers
 * that issue short-lived tokens with a refresh token but omit `expires_in` — notably Salesforce.
 * Synthesizing an expiry here is what arms the proactive-refresh path downstream (`getValidAccessToken` +
 * `maybeRotate` both no-op while `expiresAt` is null); without it such tokens read as "never expiring" and
 * the account stalls once the provider session lapses. No `expires_in` and no positive ttl ⇒ null (every
 * other connector's unchanged, standards-exact behavior). Pure (takes `nowMs`) so it is unit-testable.
 */
export function computeExpiresAt(
  expiresInSeconds: number | undefined,
  ttlSeconds: number | null,
  nowMs: number,
): number | null {
  if (typeof expiresInSeconds === 'number') return nowMs + expiresInSeconds * 1000;
  if (typeof ttlSeconds === 'number' && ttlSeconds > 0) return nowMs + ttlSeconds * 1000;
  return null;
}
