/**
 * Per-connector circuit breakers, reusing the integrations `CircuitBreaker` (closed →
 * open → half-open). A connector that fails repeatedly trips open and short-circuits
 * further executions until the reset window elapses.
 */
import { CircuitBreaker } from '@neuropause/integrations';
import type { Clock } from '@neuropause/cloud-core';

export interface BreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
}

export class CircuitBreakerRegistry {
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(
    private readonly clock: Clock,
    private readonly config: BreakerConfig = { failureThreshold: 5, resetTimeoutMs: 30_000 },
  ) {}

  get(connectorId: string): CircuitBreaker {
    let b = this.breakers.get(connectorId);
    if (!b) {
      b = new CircuitBreaker(this.clock, this.config);
      this.breakers.set(connectorId, b);
    }
    return b;
  }
}
