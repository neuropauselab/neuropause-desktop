import { createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { loadEnv } from '../config/env';
import { redis } from '../cache/redis';
import { logger } from '../config/logger';

const env = loadEnv();

export interface AccessTokenClaims {
  sub: string; // user id
  email: string;
  /** JWT ID — unique per token, used for revocation. */
  jti?: string;
}

const ISSUER = 'neuropause';
const AUDIENCE = 'neuropause-desktop';
const DENY_PREFIX = 'atdeny:';

/**
 * SHA-256 fingerprint of a token, used as the Redis deny-list key.
 * We never store the raw JWT in Redis — only its hash.
 */
function tokenFingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 32);
}

/**
 * In-process deny cache (NP-RELEASE-043 §6/§29). Two purposes:
 *  1. LIVENESS — `requireAuth` sits on every authenticated request; it must
 *     never block on a down Redis (ioredis queues commands while reconnecting,
 *     which turned every request into a multi-second stall and timed out the
 *     unit suites). Redis is consulted only when its connection is `ready`.
 *  2. ENFORCEMENT — revocations performed by THIS process (logout, account
 *     deletion) are enforced immediately and unconditionally from this map,
 *     even during a Redis outage.
 * Trade-off (documented, honest — mirrors the TD-3 rate-limit fallback): while
 * Redis is down, a revocation performed by ANOTHER process is not visible
 * here, so a stolen token remains usable in this process for at most
 * JWT_ACCESS_TTL (15 min). Entries expire at token TTL; the map is pruned
 * opportunistically and bounded.
 */
const localDenyTokens = new Map<string, number>(); // fingerprint -> deny-entry expiry (ms epoch)
const localDenyUsers = new Map<string, number>(); // userId -> revocation time (s epoch)
const LOCAL_DENY_MAX = 50_000;

function pruneLocalDeny(now: number): void {
  for (const [k, v] of localDenyTokens) if (v < now) localDenyTokens.delete(k);
  for (const [k, v] of localDenyUsers) if ((v + env.JWT_ACCESS_TTL) * 1000 < now) localDenyUsers.delete(k);
}

/** Redis is consulted only when the connection is ready — never block requests on a reconnecting client. */
function redisReady(): boolean {
  return (redis as { status?: string }).status === 'ready';
}

/** Test helper — clears the in-process deny cache. */
export function resetLocalDenyCache(): void {
  localDenyTokens.clear();
  localDenyUsers.clear();
}

export function signAccessToken(claims: AccessTokenClaims): { token: string; expiresAt: number } {
  const expiresInSeconds = env.JWT_ACCESS_TTL;
  const token = jwt.sign(claims, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: expiresInSeconds,
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  return { token, expiresAt: Date.now() + expiresInSeconds * 1_000 };
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
    algorithms: ['HS256'],
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  if (typeof payload === 'string') throw new Error('Malformed token');
  return { sub: String(payload.sub), email: String(payload.email) };
}

/**
 * Revokes an access token: records its fingerprint in the in-process deny
 * cache (immediate, unconditional) and in the Redis deny list (cross-process)
 * when Redis is available. Entries auto-expire after the access token TTL.
 */
export async function revokeAccessToken(token: string): Promise<void> {
  const now = Date.now();
  const fp = tokenFingerprint(token);
  pruneLocalDeny(now);
  localDenyTokens.set(fp, now + env.JWT_ACCESS_TTL * 1000);
  if (localDenyTokens.size > LOCAL_DENY_MAX) pruneLocalDeny(now);
  if (!redisReady()) {
    logger.warn('Access-token revocation recorded locally only (Redis unavailable)');
    return;
  }
  try {
    await redis.set(`${DENY_PREFIX}${fp}`, '1', 'EX', env.JWT_ACCESS_TTL);
  } catch (err) {
    logger.warn({ err }, 'Failed to deny-list access token in Redis (local cache holds it)');
  }
}

/**
 * Revokes ALL access tokens for a given user by recording a per-user
 * revocation timestamp (locally and in Redis). Any token issued at or before
 * this timestamp is rejected. The stored value is now+1 second so that tokens
 * minted in the current whole second (JWT `iat` granularity) are also caught.
 */
export async function revokeAllAccessTokensForUser(userId: string): Promise<void> {
  const revokedAt = Math.floor(Date.now() / 1000) + 1;
  pruneLocalDeny(Date.now());
  localDenyUsers.set(userId, revokedAt);
  if (!redisReady()) {
    logger.warn({ userId }, 'User-level token revocation recorded locally only (Redis unavailable)');
    return;
  }
  try {
    await redis.set(`${DENY_PREFIX}user:${userId}`, String(revokedAt), 'EX', env.JWT_ACCESS_TTL);
  } catch (err) {
    logger.warn({ err }, 'Failed to set user-level revocation in Redis (local cache holds it)');
  }
}

/** `iat` (seconds) strictly below the recorded revocation second ⇒ denied. */
function issuedBefore(token: string, revokedAtSec: number): boolean {
  const decoded = jwt.decode(token);
  if (decoded && typeof decoded === 'object' && typeof decoded.iat === 'number') {
    return decoded.iat < revokedAtSec;
  }
  return false;
}

/**
 * Three-state revocation check (NP-RELEASE-044 §5 / DECISION-4).
 *
 * REVOCATION_AUTHORITY_UNAVAILABLE is a distinct state and is NEVER collapsed
 * into TOKEN_ALLOWED: when Redis (the cross-process revocation authority) is
 * unreachable, a protected request cannot prove the token was not revoked by
 * another process, so the caller must fail closed (deterministic 503), not
 * silently proceed.
 */
export type RevocationCheckResult = 'allowed' | 'revoked' | 'authority_unavailable';

/**
 * Checks whether an access token has been revoked. Order:
 *  1. In-process cache (no I/O) — same-process revocations are always
 *     recognized, even while Redis is down.
 *  2. Redis — consulted ONLY when the connection is `ready`, so a
 *     down/reconnecting Redis can never stall the request path (ioredis
 *     queues commands while reconnecting).
 *  3. Redis not ready, or the query fails ⇒ `authority_unavailable` — the
 *     caller decides; the protected authentication path fails closed.
 */
export async function checkAccessTokenRevocation(
  token: string,
  userId: string,
): Promise<RevocationCheckResult> {
  const now = Date.now();
  const fp = tokenFingerprint(token);

  const localToken = localDenyTokens.get(fp);
  if (localToken !== undefined && localToken >= now) return 'revoked';
  const localUser = localDenyUsers.get(userId);
  if (localUser !== undefined && issuedBefore(token, localUser)) return 'revoked';

  if (!redisReady()) {
    logger.warn({ userId }, 'Revocation authority unavailable (Redis not ready) — failing closed');
    return 'authority_unavailable';
  }
  try {
    const [denied, userRevokedAt] = await Promise.all([
      redis.get(`${DENY_PREFIX}${fp}`),
      redis.get(`${DENY_PREFIX}user:${userId}`),
    ]);
    if (denied) return 'revoked';
    if (userRevokedAt && issuedBefore(token, Number(userRevokedAt))) return 'revoked';
    return 'allowed';
  } catch (err) {
    logger.warn({ err, userId }, 'Revocation authority query failed — failing closed');
    return 'authority_unavailable';
  }
}
