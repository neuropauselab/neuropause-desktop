/**
 * API Gateway — the pure decision authority. Given a request, the resolved API
 * key, the caller's rate/quota state, and the target version's status, it returns
 * exactly one `GatewayDecision` (200 / 401 / 403 / 410 / 429). No I/O: the store
 * resolves the key, meters rate + quota, and writes the audit trail around this.
 */
import type {
  ApiKey,
  ApiVersionInfo,
  GatewayDecision,
  GatewayRequestInput,
  QuotaPolicy,
  RateLimitPolicy,
} from '@neuropause/shared';

export interface GatewayContext {
  key: ApiKey | null;
  developerId: string | null;
  versionInfo: ApiVersionInfo;
  rateLimit: RateLimitPolicy;
  quota: QuotaPolicy;
  /** Remaining requests in the current rate window (peeked, not consumed). */
  rateRemaining: number;
  /** Requests used in the current quota period. */
  quotaUsed: number;
  now: number;
}

const API_VERSIONS: Record<string, ApiVersionInfo> = {
  v1: { version: 'v1', status: 'current', since: '2026-01-01', sunsetAt: null, notes: 'Stable, generally available.' },
  v2: { version: 'v2', status: 'beta', since: '2026-06-01', sunsetAt: null, notes: 'Beta — surface may change.' },
};

export function apiVersionInfo(version: string): ApiVersionInfo {
  return API_VERSIONS[version] ?? { version: 'v1', status: 'sunset', since: '', sunsetAt: '', notes: 'Unknown version.' };
}

export function allApiVersions(): ApiVersionInfo[] {
  return Object.values(API_VERSIONS);
}

export function decideGateway(input: GatewayRequestInput, ctx: GatewayContext): GatewayDecision {
  const base = {
    developerId: ctx.developerId,
    keyId: ctx.key?.id ?? null,
    rateLimit: ctx.rateLimit.max,
    quotaLimit: ctx.quota.limit,
    version: input.version,
  };
  const quotaRemaining = Math.max(0, ctx.quota.limit - ctx.quotaUsed);

  // 1) version routing
  if (ctx.versionInfo.status === 'sunset') {
    return { ...base, allowed: false, status: 410, reason: `API ${input.version} is sunset`, rateRemaining: ctx.rateRemaining, quotaRemaining, retryAfterMs: null };
  }

  // 2) authentication
  if (!ctx.key) {
    return { ...base, allowed: false, status: 401, reason: 'Missing or invalid API key', rateRemaining: ctx.rateRemaining, quotaRemaining, retryAfterMs: null };
  }

  // 3) authorization (scope)
  if (input.scope && !ctx.key.scopes.includes(input.scope)) {
    return { ...base, allowed: false, status: 403, reason: `API key missing required scope "${input.scope}"`, rateRemaining: ctx.rateRemaining, quotaRemaining, retryAfterMs: null };
  }

  // 4) rate limit
  if (ctx.rateRemaining <= 0) {
    return { ...base, allowed: false, status: 429, reason: 'Rate limit exceeded', rateRemaining: 0, quotaRemaining, retryAfterMs: ctx.rateLimit.windowMs };
  }

  // 5) quota
  if (quotaRemaining <= 0) {
    return { ...base, allowed: false, status: 429, reason: `Quota exceeded (${ctx.quota.limit}/${ctx.quota.period})`, rateRemaining: ctx.rateRemaining, quotaRemaining: 0, retryAfterMs: null };
  }

  // allowed — reflect post-commit remaining
  return {
    ...base,
    allowed: true,
    status: 200,
    reason: ctx.versionInfo.status === 'deprecated' ? `OK (API ${input.version} deprecated)` : 'OK',
    rateRemaining: ctx.rateRemaining - 1,
    quotaRemaining: quotaRemaining - 1,
    retryAfterMs: null,
  };
}
