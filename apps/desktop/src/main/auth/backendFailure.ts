/**
 * NP-GLOBAL-PUBLIC-LAUNCH-002 — TRANSIENT IS NOT REJECTION.
 *
 * Measured 2026-09-12: the baked production backend answered HTTP 530 (the
 * Cloudflare edge with its origin down). `status === 0` was the only shape
 * treated as "unreachable", so an edge 5xx at launch was classified as a
 * credential REJECTION: the stored refresh token was destroyed and a returning
 * user was walled on the sign-in screen by an outage that was not theirs. A
 * 429, any 5xx and the Cloudflare 52x/53x family are the service being absent,
 * not the credential being wrong. Only a genuine 4xx rejection may clear.
 */
export function isTransientBackendFailure(err: unknown): boolean {
  // Structural check (not instanceof): this module must stay Electron-free and
  // mock-proof, and BackendError is the only error shape that carries these fields.
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: unknown; code?: unknown; status?: unknown };
  if (typeof e.status !== 'number' || typeof e.code !== 'string') return false;
  if (e.code === 'network_error' || e.status === 0) return true;
  return e.status === 429 || e.status >= 500;
}
