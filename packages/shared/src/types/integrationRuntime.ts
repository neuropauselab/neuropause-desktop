/**
 * Enterprise Integration — Runtime policy engine (Phase P2.1 foundation, Parts 1 + 4).
 *
 * The RUNNING machinery already exists in NCF (`connectorService` lifecycle, `unified/sync` orchestrator +
 * `SyncScheduler`, `RateLimiter`, `RetryQueue`). This module does not re-run any of it; it defines the pure,
 * deterministic, reusable POLICY the foundation standardizes on — lifecycle transition rules, the canonical
 * retry/backoff schedule, a token-bucket rate-limit decision model, sync-mode selection, progress math, and
 * next-run scheduling. These are the connector-agnostic building blocks the manifest, health engine, dashboard
 * (and future connectors) share. No I/O; clock injected everywhere.
 */
import type { IntegrationSyncMode, IntegrationCancellationSignal } from './integrationSdk';
import type { IntegrationRateLimit } from './integrationManifest';

/* ── lifecycle state machine ───────────────────────────────────────────────────────── */

export type IntegrationLifecyclePhase =
  | 'idle'
  | 'connecting'
  | 'authenticating'
  | 'connected'
  | 'syncing'
  | 'reauth_required'
  | 'error'
  | 'disconnected';

/** Valid phase transitions. A connector's lifecycle may only move along these edges. */
export const INTEGRATION_LIFECYCLE_TRANSITIONS: Record<
  IntegrationLifecyclePhase,
  IntegrationLifecyclePhase[]
> = {
  idle: ['connecting', 'disconnected'],
  connecting: ['authenticating', 'error', 'disconnected'],
  authenticating: ['connected', 'reauth_required', 'error', 'disconnected'],
  connected: ['syncing', 'reauth_required', 'error', 'disconnected'],
  syncing: ['connected', 'error', 'reauth_required', 'disconnected'],
  reauth_required: ['authenticating', 'disconnected'],
  error: ['connecting', 'syncing', 'disconnected'],
  disconnected: ['connecting', 'idle'],
};

export function canTransition(
  from: IntegrationLifecyclePhase,
  to: IntegrationLifecyclePhase,
): boolean {
  return INTEGRATION_LIFECYCLE_TRANSITIONS[from]?.includes(to) ?? false;
}

/* ── retry / backoff policy ────────────────────────────────────────────────────────── */

export interface IntegrationRetryPolicy {
  baseMs: number;
  capMs: number;
  factor: number;
  maxAttempts: number;
}

export const DEFAULT_INTEGRATION_RETRY_POLICY: IntegrationRetryPolicy = {
  baseMs: 1000,
  capMs: 60_000,
  factor: 2,
  maxAttempts: 6,
};

/** Deterministic (jitter-free) exponential backoff for `attempt` (1-based), capped. */
export function computeRetryDelay(
  attempt: number,
  policy: IntegrationRetryPolicy = DEFAULT_INTEGRATION_RETRY_POLICY,
): number {
  if (attempt <= 0) return 0;
  const raw = policy.baseMs * Math.pow(policy.factor, attempt - 1);
  return Math.min(policy.capMs, Math.round(raw));
}

/** Whether another attempt is warranted. */
export function shouldRetryIntegration(
  attempt: number,
  retryable: boolean,
  policy: IntegrationRetryPolicy = DEFAULT_INTEGRATION_RETRY_POLICY,
): boolean {
  return retryable && attempt < policy.maxAttempts;
}

/** When the next retry is due, for dashboard display. Null when there is nothing to retry. */
export function nextRetryAt(
  consecutiveFailures: number,
  lastAttemptMs: number,
  policy: IntegrationRetryPolicy = DEFAULT_INTEGRATION_RETRY_POLICY,
): number | null {
  if (consecutiveFailures <= 0) return null;
  if (!shouldRetryIntegration(consecutiveFailures, true, policy)) return null;
  return lastAttemptMs + computeRetryDelay(consecutiveFailures, policy);
}

/* ── token-bucket rate limiting (pure decision model) ──────────────────────────────── */

export interface IntegrationRateLimitState {
  capacity: number;
  tokens: number;
  /** Tokens replenished per millisecond. */
  refillPerMs: number;
  lastRefillMs: number;
}

/** Build a full bucket from a documented rate limit. */
export function createRateLimitState(
  rate: IntegrationRateLimit,
  nowMs: number,
): IntegrationRateLimitState {
  const capacity = rate.burst && rate.burst > 0 ? rate.burst : rate.requestsPerInterval;
  return {
    capacity,
    tokens: capacity,
    refillPerMs: rate.requestsPerInterval / rate.intervalMs,
    lastRefillMs: nowMs,
  };
}

/** Refill the bucket up to capacity based on elapsed time. Pure — returns a new state. */
export function refillRateLimit(
  state: IntegrationRateLimitState,
  nowMs: number,
): IntegrationRateLimitState {
  const elapsed = Math.max(0, nowMs - state.lastRefillMs);
  const tokens = Math.min(state.capacity, state.tokens + elapsed * state.refillPerMs);
  return { ...state, tokens, lastRefillMs: nowMs };
}

/** Attempt to consume `n` tokens. Pure — returns whether it succeeded and the resulting state. */
export function consumeRateLimit(
  state: IntegrationRateLimitState,
  nowMs: number,
  n = 1,
): { ok: boolean; state: IntegrationRateLimitState } {
  const refilled = refillRateLimit(state, nowMs);
  if (refilled.tokens >= n) {
    return { ok: true, state: { ...refilled, tokens: refilled.tokens - n } };
  }
  return { ok: false, state: refilled };
}

/** Epoch ms at which `n` tokens will be available. */
export function rateLimitAvailableAt(
  state: IntegrationRateLimitState,
  nowMs: number,
  n = 1,
): number {
  const refilled = refillRateLimit(state, nowMs);
  if (refilled.tokens >= n) return nowMs;
  if (refilled.refillPerMs <= 0) return Number.POSITIVE_INFINITY;
  const deficit = n - refilled.tokens;
  return nowMs + Math.ceil(deficit / refilled.refillPerMs);
}

/* ── sync plan / progress / scheduling ─────────────────────────────────────────────── */

const SYNC_MODE_PREFERENCE: readonly IntegrationSyncMode[] = [
  'incremental',
  'delta',
  'full',
  'scheduled',
  'webhook',
  'manual',
];

/** Choose a sync mode: honor `requested` if available, else the most-preferred available mode. */
export function selectSyncMode(
  available: readonly IntegrationSyncMode[],
  requested?: IntegrationSyncMode,
): IntegrationSyncMode | null {
  if (requested && available.includes(requested)) return requested;
  for (const mode of SYNC_MODE_PREFERENCE) {
    if (available.includes(mode)) return mode;
  }
  return available[0] ?? null;
}

export interface IntegrationSyncProgress {
  processed: number;
  total: number;
  pages: number;
  done: boolean;
  /** 0–100. */
  percent: number;
}

/** Compute sync progress. When total is unknown (0), percent is 0 until done. Deterministic. */
export function computeSyncProgress(
  processed: number,
  total: number,
  pages: number,
  done: boolean,
): IntegrationSyncProgress {
  const p = Math.max(0, processed);
  const t = Math.max(0, total);
  let percent: number;
  if (done) percent = 100;
  else if (t > 0) percent = Math.min(99, Math.round((p / t) * 100));
  else percent = 0;
  return { processed: p, total: t, pages: Math.max(0, pages), done, percent };
}

/** The next scheduled sync time; if the computed time is in the past it is due now. */
export function nextScheduledSyncAt(
  lastSyncAtMs: number | null,
  intervalMs: number,
  nowMs: number,
): number {
  const base = lastSyncAtMs ?? nowMs;
  const next = base + Math.max(0, intervalMs);
  return next < nowMs ? nowMs : next;
}

/* ── cooperative cancellation ──────────────────────────────────────────────────────── */

export interface IntegrationCancellationController {
  signal: IntegrationCancellationSignal;
  cancel(reason?: string): void;
}

/** A minimal cancellation controller. Concrete NCF impls may bridge this to an AbortController. */
export function createCancellation(): IntegrationCancellationController {
  const state = { cancelled: false, reason: null as string | null };
  const signal: IntegrationCancellationSignal = {
    get cancelled(): boolean {
      return state.cancelled;
    },
    throwIfCancelled(): void {
      if (state.cancelled) throw new Error(state.reason ?? 'Integration operation cancelled');
    },
  };
  return {
    signal,
    cancel(reason?: string): void {
      state.cancelled = true;
      state.reason = reason ?? null;
    },
  };
}
