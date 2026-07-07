/**
 * Failure classification + retry policy (V7.2.1, pure). Deterministic rules for how
 * a failed workflow step should be handled: which failures are retryable, the
 * backoff strategy, and escalation. No I/O — the orchestrator/runtime consult these
 * functions to drive retry behavior. The core guarantee: DETERMINISTIC failures
 * (validation, user error, internal bug) are never retried; only transient ones
 * (network, rate limit, temporary service outage) back off and retry.
 */

export type FailureClass =
  | 'network'
  | 'authentication'
  | 'rate_limit'
  | 'temporary_service'
  | 'validation'
  | 'user_error'
  | 'internal';

export interface FailurePolicy {
  retryable: boolean;
  backoff: 'none' | 'fixed' | 'exponential';
  escalation: 'none' | 'notify' | 'block';
}

const POLICIES: Record<FailureClass, FailurePolicy> = {
  network: { retryable: true, backoff: 'exponential', escalation: 'none' },
  rate_limit: { retryable: true, backoff: 'exponential', escalation: 'none' },
  temporary_service: { retryable: true, backoff: 'exponential', escalation: 'none' },
  authentication: { retryable: false, backoff: 'none', escalation: 'notify' }, // needs user re-auth
  validation: { retryable: false, backoff: 'none', escalation: 'notify' }, // deterministic input error
  user_error: { retryable: false, backoff: 'none', escalation: 'notify' },
  // Unclassified / internal: may be transient (a race, a flaky dependency), so retry
  // cautiously within budget. Misclassifying a transient failure as permanent — and
  // giving up on work that would have succeeded — is worse than retrying a genuine
  // bug a few times. Only CONFIDENTLY deterministic failures above skip retry.
  internal: { retryable: true, backoff: 'exponential', escalation: 'notify' },
};

export function policyFor(cls: FailureClass): FailurePolicy {
  return POLICIES[cls];
}

export interface FailureSignal {
  message?: string;
  code?: string;
  status?: number;
}

/** Classify a failure deterministically from its message / code / HTTP status. */
export function classifyFailure(signal: FailureSignal): FailureClass {
  const msg = (signal.message ?? '').toLowerCase();
  const status = signal.status;

  if (status === 401 || status === 403 || /\b(unauthor|forbidden|invalid token|auth)\b/.test(msg)) {
    return 'authentication';
  }
  if (status === 429 || /rate.?limit|too many requests/.test(msg)) return 'rate_limit';
  if (status === 400 || status === 422 || /validation|invalid input|schema|malformed/.test(msg)) {
    return 'validation';
  }
  if (/network|econnrefused|econnreset|etimedout|dns|socket|timeout/.test(msg)) return 'network';
  if (
    (status != null && status >= 500) ||
    /service unavailable|bad gateway|gateway timeout/.test(msg)
  ) {
    return 'temporary_service';
  }
  if (/permission denied|not allowed|user cancel/.test(msg)) return 'user_error';
  return 'internal';
}

export interface RetryLimits {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY_LIMITS: RetryLimits = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
};

export interface RetryDecision {
  retry: boolean;
  delayMs: number;
  escalation: FailurePolicy['escalation'];
  reason: string;
}

function backoffDelay(
  strategy: FailurePolicy['backoff'],
  attempt: number,
  limits: RetryLimits,
): number {
  if (strategy === 'none') return 0;
  if (strategy === 'fixed') return limits.baseDelayMs;
  // exponential: base * 2^(attempt-1), capped at maxDelayMs.
  return Math.min(limits.baseDelayMs * 2 ** (attempt - 1), limits.maxDelayMs);
}

/**
 * Decide whether (and after how long) to retry, given the failure class and the
 * attempt just completed (1-based). Deterministic. Non-retryable classes never
 * retry; retryable classes back off until the attempt budget is exhausted, then
 * escalate.
 */
export function retryDecision(
  cls: FailureClass,
  attempt: number,
  limits: RetryLimits = DEFAULT_RETRY_LIMITS,
): RetryDecision {
  const policy = policyFor(cls);
  if (!policy.retryable) {
    return {
      retry: false,
      delayMs: 0,
      escalation: policy.escalation,
      reason: `${cls} is not retryable`,
    };
  }
  if (attempt >= limits.maxAttempts) {
    return {
      retry: false,
      delayMs: 0,
      escalation: 'notify',
      reason: `exhausted ${limits.maxAttempts} attempts`,
    };
  }
  return {
    retry: true,
    delayMs: backoffDelay(policy.backoff, attempt, limits),
    escalation: 'none',
    reason: `${cls}: retry ${attempt + 1}/${limits.maxAttempts}`,
  };
}
