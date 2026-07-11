/**
 * Webhook retry policy (P3.0, Increment 4) — pure.
 * A fixed exponential-ish backoff schedule; once exhausted, a delivery is
 * dead-lettered. Attempt 1 fires immediately (0s); subsequent attempts wait the
 * next schedule entry. Pure so the outbox behavior is deterministic in tests.
 */

/** Seconds to wait before attempt N (index = attempts already made). */
export const WEBHOOK_BACKOFF_SEC: readonly number[] = [0, 30, 120, 600, 3600, 21_600];
export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_BACKOFF_SEC.length;

export interface NextAttempt {
  status: 'pending' | 'dead';
  nextAttemptAtMs: number | null;
}

/**
 * Plan the next attempt after `attemptsMade` failures. Returns `dead` once the
 * schedule is exhausted, else the next scheduled time.
 */
export function planNextAttempt(attemptsMade: number, nowMs: number): NextAttempt {
  if (attemptsMade >= WEBHOOK_MAX_ATTEMPTS) return { status: 'dead', nextAttemptAtMs: null };
  const delaySec = WEBHOOK_BACKOFF_SEC[attemptsMade] ?? WEBHOOK_BACKOFF_SEC[WEBHOOK_BACKOFF_SEC.length - 1];
  return { status: 'pending', nextAttemptAtMs: nowMs + delaySec * 1000 };
}
