/**
 * Cache layer (NCEA 12.0, Phase 6). Ephemeral, disposable acceleration for
 * sessions, projections, connector data, and workflows, plus locks, queues, and
 * rate limiting. The Cache interface has a real in-memory adapter (tested) and a
 * Redis adapter for production (infra-pending, identical interface). Constitutional
 * rule: the cache is NEVER the system of record — it holds nothing that isn't
 * reconstructible from Postgres/the event store, and `flush()` must always be
 * safe. The in-memory lock is process-local; a true distributed lock is a Redis
 * concern (SET NX PX) behind the same `withLock` seam.
 */
import type { Clock } from '@neuropause/cloud-core';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export interface Cache {
  readonly kind: string;
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
  enqueue(queue: string, item: unknown): Promise<void>;
  dequeue(queue: string): Promise<unknown | undefined>;
  queueDepth(queue: string): number;
  rateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
  flush(): Promise<void>;
}

interface Entry {
  value: unknown;
  expiresAt: number | null;
}

export class InMemoryCache implements Cache {
  readonly kind = 'memory';
  private readonly store = new Map<string, Entry>();
  private readonly queues = new Map<string, unknown[]>();
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly clock: Clock) {}

  private live(key: string): Entry | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= this.clock.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  async get<T>(key: string): Promise<T | undefined> {
    return this.live(key)?.value as T | undefined;
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    this.store.set(key, { value, expiresAt: ttlMs !== undefined ? this.clock.now() + ttlMs : null });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  /** Serialize access to `key`. Process-local mutex; Redis provides the distributed form. */
  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prior = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    this.locks.set(
      key,
      prior.then(() => gate),
    );
    await prior;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(key)) void this.locks.get(key)!.then(() => this.locks.delete(key));
    }
  }

  async enqueue(queue: string, item: unknown): Promise<void> {
    (this.queues.get(queue) ?? this.queues.set(queue, []).get(queue)!).push(item);
  }

  async dequeue(queue: string): Promise<unknown | undefined> {
    return this.queues.get(queue)?.shift();
  }

  queueDepth(queue: string): number {
    return this.queues.get(queue)?.length ?? 0;
  }

  /** Fixed-window rate limit. */
  async rateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = this.clock.now();
    let win = this.windows.get(key);
    if (!win || win.resetAt <= now) {
      win = { count: 0, resetAt: now + windowMs };
      this.windows.set(key, win);
    }
    if (win.count >= limit) return { allowed: false, remaining: 0, resetAt: win.resetAt };
    win.count += 1;
    return { allowed: true, remaining: limit - win.count, resetAt: win.resetAt };
  }

  async flush(): Promise<void> {
    this.store.clear();
    this.queues.clear();
    this.windows.clear();
  }
}
