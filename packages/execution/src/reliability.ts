/**
 * Modules 7 & 8 — Retry & Recovery Engine + Rate Limiter. The rate limiter is a per-
 * (tenant, connector) token bucket reusing the cloud-core RateLimiter. The recovery engine
 * owns the dead-letter queue: executions that exhaust their retries are dead-lettered and
 * can be recovered (re-executed). The retry/backoff/timeout mechanics themselves are the
 * reused integrations reliability primitives, applied inside the execution engine.
 */
import { RateLimiter, type Clock } from '@neuropause/cloud-core';
import type { ExecutionRequest } from './types';

export interface RateLimitConfig {
  capacity: number;
  refillPerSec: number;
}

export class ConnectorRateLimiter {
  private readonly limiters = new Map<string, RateLimiter>();
  private readonly configs = new Map<string, RateLimitConfig>();

  constructor(
    private readonly clock: Clock,
    private readonly defaults: RateLimitConfig = { capacity: 100, refillPerSec: 50 },
  ) {}

  configure(connectorId: string, config: RateLimitConfig): void {
    this.configs.set(connectorId, config);
  }

  private limiter(tenantId: string, connectorId: string): RateLimiter {
    const key = `${tenantId}:${connectorId}`;
    let l = this.limiters.get(key);
    if (!l) {
      l = new RateLimiter(this.clock, this.configs.get(connectorId) ?? this.defaults);
      this.limiters.set(key, l);
    }
    return l;
  }

  allow(tenantId: string, connectorId: string): boolean {
    return this.limiter(tenantId, connectorId).allow(`${tenantId}:${connectorId}`);
  }
}

export interface DeadLetter {
  id: string;
  request: ExecutionRequest;
  reason: string;
  attempts: number;
  at: number;
}

export class RetryRecoveryEngine {
  private readonly dlq: DeadLetter[] = [];
  private counter = 0;

  constructor(private readonly clock: Clock) {}

  deadLetter(request: ExecutionRequest, reason: string, attempts: number): DeadLetter {
    const entry: DeadLetter = { id: `dlq_${(this.counter += 1)}`, request, reason, attempts, at: this.clock.now() };
    this.dlq.push(entry);
    return entry;
  }

  deadLetters(tenantId?: string): DeadLetter[] {
    return tenantId ? this.dlq.filter((d) => d.request.tenantId === tenantId) : [...this.dlq];
  }

  /** Remove a dead letter for recovery (the caller re-executes its request). */
  recover(id: string): DeadLetter | undefined {
    const idx = this.dlq.findIndex((d) => d.id === id);
    if (idx === -1) return undefined;
    return this.dlq.splice(idx, 1)[0];
  }
}
