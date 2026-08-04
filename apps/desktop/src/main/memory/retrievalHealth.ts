/**
 * Retrieval health + circuit breaker for the semantic (vector) leg of recall (A6).
 *
 * Two jobs, one object, because they share the same state:
 *
 *   1. **Breaker** — when the backend semantic API, Qdrant, or the embedding
 *      provider is down, every recall pays the full timeout before falling back
 *      to lexical. `MemoryView` debounces at 200 ms, so a dead dependency is
 *      re-dialled on every keystroke. After N consecutive systemic failures the
 *      circuit opens and recall skips straight to lexical until a cooldown
 *      elapses, then admits one trial call.
 *   2. **Health record** — the last outcome, the counters, and the mean success
 *      latency, projected as `RetrievalHealthSnapshot` for the diagnostics
 *      probe. Nothing here is estimated; every number is observed.
 *
 * The breaker's state machine (closed → open → half-open, a failed trial
 * re-opens) is deliberately identical to the tested `CircuitBreaker` in
 * `packages/integrations/src/reliability.ts`. It is restated here rather than
 * imported because `apps/desktop` depends on exactly one workspace package —
 * `@neuropause/shared`, across 1159 imports in main — and pulling
 * `@neuropause/integrations` (plus its `@neuropause/cloud-core` clock) into the
 * Electron main bundle is an architecture change this increment does not need.
 * The desktop already keeps its own reliability primitives for the same reason:
 * `unified/sync/rateLimiter.ts`, `unified/sync/retryQueue.ts`, and the error
 * taxonomy in `unified/sync/http.ts` all have counterparts in that package.
 *
 * Pure and Electron-free; the clock is injected, so every transition is tested
 * without wall-clock flakiness.
 */
import type {
  RetrievalHealthSnapshot,
  SemanticFailureKind,
  SemanticOutcome,
} from '@neuropause/shared';

export type BreakerState = RetrievalHealthSnapshot['breaker'];

/**
 * Failure kinds that count towards opening the circuit — the ones that say the
 * retrieval *path* is broken, so the next call will fail the same way.
 *
 * `backend_error` is deliberately excluded: the backend answered coherently with
 * an error it does not expect to recover from (a rejected query shape, say), which
 * is a property of that one request. One malformed query must not blind semantic
 * search for every other query in the process.
 */
const BREAKER_TRIPPING_FAILURES: ReadonlySet<SemanticFailureKind> = new Set<SemanticFailureKind>([
  'network',
  'timeout',
  'auth',
  'dependency_down',
  'malformed_response',
]);

export interface RetrievalHealthOptions {
  /** Consecutive tripping failures before the circuit opens. Default 3. */
  failureThreshold?: number;
  /** How long the circuit stays open before admitting a trial call. Default 30 s. */
  resetTimeoutMs?: number;
  /** Injected clock (epoch ms). Defaults to `Date.now`. */
  now?: () => number;
}

export const DEFAULT_FAILURE_THRESHOLD = 3;
export const DEFAULT_RESET_TIMEOUT_MS = 30_000;

export class RetrievalHealthTracker {
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly now: () => number;

  private consecutiveFailures = 0;
  private openedAt = 0;
  private trialInFlight = false;

  private lastOutcome: SemanticOutcome | null = null;
  private lastOutcomeAt: number | null = null;

  private attempts = 0;
  private successes = 0;
  private failures = 0;
  private skipped = 0;
  private successLatencyTotalMs = 0;

  constructor(options: RetrievalHealthOptions = {}) {
    this.failureThreshold = Math.max(1, options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD);
    this.resetTimeoutMs = Math.max(0, options.resetTimeoutMs ?? DEFAULT_RESET_TIMEOUT_MS);
    this.now = options.now ?? Date.now;
  }

  /** Current breaker state, derived — never stored, so it cannot go stale. */
  state(): BreakerState {
    if (this.consecutiveFailures < this.failureThreshold) return 'closed';
    if (this.now() - this.openedAt >= this.resetTimeoutMs) return 'half_open';
    return 'open';
  }

  /**
   * Whether a semantic call may proceed: always when closed, and once per
   * cooldown when half-open (that call is the trial whose result decides whether
   * the circuit closes again or re-opens for another cooldown).
   */
  allow(): boolean {
    const state = this.state();
    if (state === 'open') return false;
    if (state === 'half_open') this.trialInFlight = true;
    return true;
  }

  /**
   * Record what happened. Skips never move the breaker — no call was made — but
   * they are counted and become the last outcome, so diagnostics can distinguish
   * "not attempted" from "attempted and fine".
   */
  record(outcome: SemanticOutcome): void {
    const at = this.now();
    this.lastOutcome = outcome;
    this.lastOutcomeAt = at;

    switch (outcome.state) {
      case 'ok':
        this.attempts++;
        this.successes++;
        this.successLatencyTotalMs += Math.max(0, outcome.latencyMs);
        this.consecutiveFailures = 0;
        this.trialInFlight = false;
        return;
      case 'failed':
        this.attempts++;
        this.failures++;
        if (BREAKER_TRIPPING_FAILURES.has(outcome.kind)) this.recordTrippingFailure(at);
        return;
      case 'skipped':
        this.skipped++;
        return;
    }
  }

  private recordTrippingFailure(at: number): void {
    if (this.trialInFlight) {
      // A failed trial re-opens the circuit for a fresh cooldown rather than
      // letting the next caller through immediately.
      this.trialInFlight = false;
      this.consecutiveFailures = this.failureThreshold;
      this.openedAt = at;
      return;
    }
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.failureThreshold) this.openedAt = at;
  }

  snapshot(): RetrievalHealthSnapshot {
    const breaker = this.state();
    return {
      breaker,
      consecutiveFailures: this.consecutiveFailures,
      retryAt: breaker === 'open' ? new Date(this.openedAt + this.resetTimeoutMs).toISOString() : null,
      lastOutcome: this.lastOutcome,
      lastOutcomeAt: this.lastOutcomeAt === null ? null : new Date(this.lastOutcomeAt).toISOString(),
      totals: {
        attempts: this.attempts,
        successes: this.successes,
        failures: this.failures,
        skipped: this.skipped,
      },
      avgSuccessLatencyMs:
        this.successes === 0 ? null : Math.round(this.successLatencyTotalMs / this.successes),
    };
  }
}
