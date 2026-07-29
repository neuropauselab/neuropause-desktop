/**
 * Reliability Framework (NCEA 15.0, Phase 2). Centralizes reliability policy. It
 * REUSES the proven primitives from `@neuropause/integrations` (circuit breaker,
 * retry with exponential backoff, timeout) — it does not reimplement them — and
 * adds the missing pieces: bulkhead isolation, fallback policies, failure
 * classification (transient vs permanent), and automatic-recovery hooks. A named
 * `ReliabilityRegistry` composes them so every protected call runs through one
 * consistent policy: bulkhead → circuit breaker → timeout → retry(transient) →
 * fallback. Deterministic (injectable sleep/rng); VERIFIED without wall-clock flake.
 */
import { systemClock, type Clock } from '@neuropause/cloud-core';
import { CircuitBreaker, withRetry, withTimeout, TimeoutError, DEFAULT_RETRY, type RetryPolicy, type CircuitState, type CircuitBreakerOptions } from '@neuropause/integrations';

// Re-export the reused primitives so the operations surface exposes one reliability vocabulary.
export { CircuitBreaker, withRetry, withTimeout, TimeoutError, backoffDelay, DEFAULT_RETRY, type RetryPolicy, type CircuitState, type CircuitBreakerOptions } from '@neuropause/integrations';

// ── failure classification ──
export type FailureClass = 'transient' | 'permanent' | 'unknown';
export type FailureClassifier = (error: unknown) => FailureClass;

/** Default classifier: timeouts / 5xx / 429 / network errors are transient; 4xx / validation are permanent. */
export function classifyFailure(error: unknown): FailureClass {
  if (error instanceof TimeoutError) return 'transient';
  const code = (error as { code?: unknown; status?: unknown } | null)?.status ?? (error as { code?: unknown } | null)?.code;
  if (typeof code === 'number') {
    if (code === 429 || code >= 500) return 'transient';
    if (code >= 400) return 'permanent';
  }
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (/(timeout|timed out|econnreset|econnrefused|enotfound|socket hang up|network|temporarily|unavailable|throttl|rate.?limit|503|502|504|429)/.test(msg)) return 'transient';
  if (/(invalid|not found|unauthor|forbidden|permission|validation|bad request|malformed|conflict|duplicate)/.test(msg)) return 'permanent';
  return 'unknown';
}
export const isTransient = (e: unknown): boolean => classifyFailure(e) === 'transient';
export const isPermanent = (e: unknown): boolean => classifyFailure(e) === 'permanent';

// ── bulkhead (concurrency isolation) ──
export class BulkheadFullError extends Error {
  constructor(max: number, queue: number) {
    super(`bulkhead full (max ${max}, queue ${queue})`);
    this.name = 'BulkheadFullError';
  }
}

/** Limits concurrent execution to `maxConcurrent`, queuing up to `maxQueue`, else rejecting. */
export class Bulkhead {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(
    private readonly maxConcurrent: number,
    private readonly maxQueue = 0,
  ) {}

  private async acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return;
    }
    if (this.waiters.length >= this.maxQueue) throw new BulkheadFullError(this.maxConcurrent, this.maxQueue);
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active += 1;
  }
  private release(): void {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next) next();
  }
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
  stats(): { active: number; queued: number; maxConcurrent: number; maxQueue: number } {
    return { active: this.active, queued: this.waiters.length, maxConcurrent: this.maxConcurrent, maxQueue: this.maxQueue };
  }
}

export class CircuitOpenError extends Error {
  constructor(policy: string) {
    super(`circuit open for policy '${policy}'`);
    this.name = 'CircuitOpenError';
  }
}

// ── centralized named policies ──
export interface PolicySpec {
  retry?: RetryPolicy | false;
  timeoutMs?: number;
  breaker?: CircuitBreakerOptions | false;
  bulkhead?: { maxConcurrent: number; maxQueue?: number } | false;
  /** Which failures to retry. Default: transient only. */
  retryOn?: FailureClass[];
  fallback?: () => unknown | Promise<unknown>;
}

interface Policy {
  name: string;
  retry: RetryPolicy | undefined;
  timeoutMs: number | undefined;
  breaker: CircuitBreaker | undefined;
  bulkhead: Bulkhead | undefined;
  retryOn: FailureClass[];
  fallback: (() => unknown | Promise<unknown>) | undefined;
  unhealthy: boolean;
}

export interface PolicyStats {
  name: string;
  success: number;
  failure: number;
  fallback: number;
  rejectedOpen: number;
  breaker: CircuitState | 'n/a';
  bulkhead?: { active: number; queued: number };
}

export interface MetricsSink {
  inc(name: string, by?: number): void;
}

export interface ReliabilityOptions {
  metrics?: MetricsSink;
  classifier?: FailureClassifier;
  /** Injected for deterministic retry timing in tests. */
  sleep?: (ms: number) => Promise<void>;
  rng?: () => number;
}

export class ReliabilityRegistry {
  private readonly policies = new Map<string, Policy>();
  private readonly recoveryHooks = new Map<string, Array<() => void>>();
  private readonly counters = new Map<string, PolicyStats>();
  private readonly classifier: FailureClassifier;

  constructor(
    private readonly clock: Clock = systemClock,
    private readonly options: ReliabilityOptions = {},
  ) {
    this.classifier = options.classifier ?? classifyFailure;
  }

  define(name: string, spec: PolicySpec = {}): void {
    this.policies.set(name, {
      name,
      retry: spec.retry === false ? undefined : (spec.retry ?? DEFAULT_RETRY),
      timeoutMs: spec.timeoutMs,
      breaker: spec.breaker === false ? undefined : new CircuitBreaker(this.clock, spec.breaker ?? undefined),
      bulkhead: spec.bulkhead === false || spec.bulkhead === undefined ? undefined : new Bulkhead(spec.bulkhead.maxConcurrent, spec.bulkhead.maxQueue ?? 0),
      retryOn: spec.retryOn ?? ['transient'],
      fallback: spec.fallback,
      unhealthy: false,
    });
    this.counters.set(name, { name, success: 0, failure: 0, fallback: 0, rejectedOpen: 0, breaker: spec.breaker === false ? 'n/a' : 'closed' });
  }

  has(name: string): boolean {
    return this.policies.has(name);
  }
  breakerState(name: string): CircuitState | 'n/a' {
    return this.policies.get(name)?.breaker?.state() ?? 'n/a';
  }
  onRecovery(name: string, hook: () => void): void {
    const list = this.recoveryHooks.get(name) ?? [];
    list.push(hook);
    this.recoveryHooks.set(name, list);
  }
  stats(name: string): PolicyStats | undefined {
    const c = this.counters.get(name);
    const p = this.policies.get(name);
    if (!c || !p) return undefined;
    return { ...c, breaker: p.breaker?.state() ?? 'n/a', ...(p.bulkhead ? { bulkhead: { active: p.bulkhead.stats().active, queued: p.bulkhead.stats().queued } } : {}) };
  }

  private metric(name: string, key: string): void {
    this.options.metrics?.inc(`ops.reliability.${name}.${key}`);
  }
  private markSuccess(p: Policy): void {
    const c = this.counters.get(p.name)!;
    c.success += 1;
    this.metric(p.name, 'success');
    if (p.unhealthy) {
      p.unhealthy = false;
      this.metric(p.name, 'recovery');
      for (const hook of this.recoveryHooks.get(p.name) ?? []) hook();
    }
  }
  private markFailure(p: Policy): void {
    this.counters.get(p.name)!.failure += 1;
    p.unhealthy = true;
    this.metric(p.name, 'failure');
  }

  /** Execute `fn` under the named policy. Composition: bulkhead → breaker → timeout → retry(classified) → fallback. */
  async execute<T>(name: string, fn: () => Promise<T>, opts: { fallback?: () => T | Promise<T> } = {}): Promise<T> {
    const p = this.policies.get(name);
    if (!p) throw new Error(`reliability policy '${name}' is not defined`);

    const attempt = async (): Promise<T> => {
      if (p.breaker && !p.breaker.allow()) {
        this.counters.get(name)!.rejectedOpen += 1;
        this.metric(name, 'rejected_open');
        throw new CircuitOpenError(name);
      }
      try {
        const result = p.timeoutMs !== undefined ? await withTimeout(Promise.resolve().then(fn), p.timeoutMs) : await fn();
        p.breaker?.record(true);
        return result;
      } catch (e) {
        p.breaker?.record(false);
        throw e;
      }
    };

    const runRetry = (): Promise<T> =>
      p.retry
        ? withRetry(() => attempt(), {
            policy: p.retry,
            shouldRetry: (e) => e instanceof CircuitOpenError ? false : p.retryOn.includes(this.classifier(e)),
            ...(this.options.sleep ? { sleep: this.options.sleep } : {}),
            ...(this.options.rng ? { rng: this.options.rng } : {}),
          })
        : attempt();

    const guarded = (): Promise<T> => (p.bulkhead ? p.bulkhead.run(runRetry) : runRetry());

    try {
      const result = await guarded();
      this.markSuccess(p);
      return result;
    } catch (e) {
      this.markFailure(p);
      const fb = opts.fallback ?? (p.fallback as (() => T | Promise<T>) | undefined);
      if (fb) {
        this.counters.get(name)!.fallback += 1;
        this.metric(name, 'fallback');
        return await fb();
      }
      throw e;
    }
  }
}
