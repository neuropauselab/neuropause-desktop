/**
 * Enterprise Integration — Health Engine (Phase P2.1 foundation, Part 5).
 *
 * NCF already produces a real `ConnectorSyncSnapshot` per account (status, lastSyncAt, duration, nextSyncAt,
 * entityCount, lastError, consecutiveFailures, rateLimitedUntil, queueSize) and streams it over
 * `ipc.connectors.syncState()/onSyncState()` — but nothing scores it or reads it in the UI. This module is
 * the pure, deterministic engine that turns that REAL snapshot into a connection/auth/latency/rate-limit/
 * error picture plus a 0–100 health score, aggregate roll-up, and recommendations. No fabricated values —
 * every output is derived from the snapshot fields (+ optional real credential expiry). Clock is injected.
 */
import type { ConnectorSyncSnapshot } from './connectors';
import type { IntegrationAuthState } from './integrationCredential';

export type IntegrationConnectionState = 'connected' | 'degraded' | 'disconnected' | 'offline';
export type IntegrationHealthState = 'healthy' | 'degraded' | 'unhealthy' | 'idle';

export interface IntegrationHealth {
  connectorId: string;
  accountId: string;
  /** 0–100. */
  score: number;
  state: IntegrationHealthState;
  connection: IntegrationConnectionState;
  auth: IntegrationAuthState;
  /** Last sync duration, ms. */
  latencyMs: number | null;
  rateLimited: boolean;
  lastSyncAt: string | null;
  nextSyncAt: string | null;
  entityCount: number;
  consecutiveFailures: number;
  queueSize: number;
  errors: string[];
  warnings: string[];
}

export interface IntegrationHealthOptions {
  /** Epoch ms the account's access credential expires (from the Credential Manager), if known. */
  authExpiresAt?: number | null;
  /** Skew for "expiring soon" classification. */
  authSkewMs?: number;
  /** Age (ms) beyond which last-sync data is considered stale. Default 24h. */
  staleAfterMs?: number;
}

const STALE_DEFAULT_MS = 24 * 60 * 60 * 1000;
const AUTH_SKEW_DEFAULT_MS = 60_000;
const FAIL_PENALTY = 12;
const FAIL_PENALTY_CAP = 48;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function parseMs(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** Compute the full, deterministic health picture for one account snapshot. */
export function computeIntegrationHealth(
  snapshot: ConnectorSyncSnapshot,
  nowMs: number,
  options: IntegrationHealthOptions = {},
): IntegrationHealth {
  const staleAfterMs = options.staleAfterMs ?? STALE_DEFAULT_MS;
  const authSkewMs = options.authSkewMs ?? AUTH_SKEW_DEFAULT_MS;
  const errors: string[] = [];
  const warnings: string[] = [];

  const rateLimitedUntilMs = parseMs(snapshot.rateLimitedUntil);
  const rateLimited =
    snapshot.status === 'rate_limited' || (rateLimitedUntilMs !== null && rateLimitedUntilMs > nowMs);

  // Connection state
  let connection: IntegrationConnectionState;
  if (snapshot.status === 'offline') connection = 'offline';
  else if (snapshot.status === 'error') connection = snapshot.consecutiveFailures >= 5 ? 'disconnected' : 'degraded';
  else if (rateLimited) connection = 'degraded';
  else connection = 'connected';

  // Auth state (from real credential expiry if provided; else inferred from a working connection)
  let auth: IntegrationAuthState;
  if (options.authExpiresAt !== undefined && options.authExpiresAt !== null) {
    const remaining = options.authExpiresAt - nowMs;
    if (remaining <= 0) auth = 'reauth_required';
    else if (remaining <= authSkewMs) auth = 'expiring';
    else auth = 'authorized';
  } else if (snapshot.status === 'success' || snapshot.status === 'syncing' || snapshot.status === 'idle') {
    auth = snapshot.status === 'idle' && snapshot.lastSyncAt === null ? 'unknown' : 'authorized';
  } else {
    auth = 'unknown';
  }

  // Score
  let score = 100;
  if (snapshot.status === 'offline') score -= 50;
  if (snapshot.status === 'error') score -= 40;
  if (rateLimited) score -= 15;
  score -= Math.min(FAIL_PENALTY_CAP, snapshot.consecutiveFailures * FAIL_PENALTY);
  if (auth === 'reauth_required') score -= 40;
  else if (auth === 'expiring') score -= 10;

  const lastSyncMs = parseMs(snapshot.lastSyncAt);
  const stale = lastSyncMs !== null && nowMs - lastSyncMs > staleAfterMs;
  if (stale) score -= 15;
  if (snapshot.queueSize > 100) score -= 5;
  score = clamp(Math.round(score), 0, 100);

  // Messages
  if (snapshot.lastError) errors.push(snapshot.lastError);
  if (snapshot.status === 'offline') errors.push('Connector is offline');
  if (auth === 'reauth_required') errors.push('Reauthorization required');
  if (rateLimited) warnings.push('Rate limited by the provider');
  if (auth === 'expiring') warnings.push('Access credential expiring soon');
  if (stale) warnings.push('Last sync is stale');
  if (snapshot.consecutiveFailures > 0) {
    warnings.push(`${snapshot.consecutiveFailures} consecutive failure${snapshot.consecutiveFailures > 1 ? 's' : ''}`);
  }
  if (snapshot.queueSize > 100) warnings.push(`Large retry queue (${snapshot.queueSize})`);

  // State
  let state: IntegrationHealthState;
  if (snapshot.status === 'idle' && snapshot.lastSyncAt === null) state = 'idle';
  else if (score >= 80) state = 'healthy';
  else if (score >= 50) state = 'degraded';
  else state = 'unhealthy';

  return {
    connectorId: snapshot.connectorId,
    accountId: snapshot.accountId,
    score,
    state,
    connection,
    auth,
    latencyMs: snapshot.lastDurationMs,
    rateLimited,
    lastSyncAt: snapshot.lastSyncAt,
    nextSyncAt: snapshot.nextSyncAt,
    entityCount: snapshot.entityCount,
    consecutiveFailures: snapshot.consecutiveFailures,
    queueSize: snapshot.queueSize,
    errors,
    warnings,
  };
}

export interface IntegrationHealthAggregate {
  total: number;
  healthy: number;
  degraded: number;
  unhealthy: number;
  idle: number;
  /** Average score across accounts (0 when none). */
  score: number;
  /** Worst state present (idle counts as healthy for the roll-up). */
  overall: IntegrationHealthState;
}

/** Roll up per-account health into an org-level picture. Deterministic. */
export function aggregateIntegrationHealth(healths: readonly IntegrationHealth[]): IntegrationHealthAggregate {
  const total = healths.length;
  const healthy = healths.filter((h) => h.state === 'healthy').length;
  const degraded = healths.filter((h) => h.state === 'degraded').length;
  const unhealthy = healths.filter((h) => h.state === 'unhealthy').length;
  const idle = healths.filter((h) => h.state === 'idle').length;
  const score = total === 0 ? 0 : Math.round(healths.reduce((s, h) => s + h.score, 0) / total);
  let overall: IntegrationHealthState = 'healthy';
  if (unhealthy > 0) overall = 'unhealthy';
  else if (degraded > 0) overall = 'degraded';
  else if (healthy === 0) overall = 'idle'; // nothing healthy (all idle, or empty) → idle
  return { total, healthy, degraded, unhealthy, idle, score, overall };
}

/** Deterministic, non-destructive recommendations from a health picture. */
export function integrationHealthRecommendations(health: IntegrationHealth): string[] {
  const out: string[] = [];
  if (health.auth === 'reauth_required') out.push('Reconnect this account to restore access.');
  else if (health.auth === 'expiring') out.push('Refresh credentials before they expire.');
  if (health.connection === 'offline') out.push('Check network connectivity to the provider.');
  if (health.rateLimited) out.push('Reduce sync frequency or wait for the rate-limit window to reset.');
  if (health.consecutiveFailures >= 3) out.push('Review the last error and verify provider configuration.');
  if (health.queueSize > 100) out.push('A large retry backlog is building — investigate persistent failures.');
  return out;
}
