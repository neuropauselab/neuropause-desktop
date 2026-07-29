/**
 * Connector runtime (NCEA 10.3, Phase 6). Connectors execute through the runtime
 * with permission gating, retries, per-actor rate limiting (cloud-core token
 * bucket), and audit. Real connector adapters (GitHub, Slack, …) implement
 * `ConnectorDefinition.execute` but require credentials + network and are not
 * included here.
 */
import { RateLimiter, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { GovernanceRecorder } from './governance';
import type { ExecutionContext } from './context';

export interface ConnectorDefinition<I = unknown, O = unknown> {
  name: string;
  permissions: string[];
  rateLimit?: { capacity: number; refillPerSec: number };
  maxRetries?: number;
  execute(input: I, ctx: ExecutionContext): Promise<O>;
}

export interface ConnectorCallOptions {
  actor: string;
  grants: string[];
}

export class ConnectorRuntime {
  private readonly connectors = new Map<string, ConnectorDefinition>();
  private readonly limiters = new Map<string, RateLimiter>();

  constructor(
    private readonly runtime: EnterpriseRuntime,
    private readonly governance: GovernanceRecorder,
    private readonly clock: Clock,
  ) {}

  register<I, O>(connector: ConnectorDefinition<I, O>): void {
    if (this.connectors.has(connector.name)) throw new Error(`connector '${connector.name}' already registered`);
    this.connectors.set(connector.name, connector as ConnectorDefinition);
    if (connector.rateLimit) {
      this.limiters.set(connector.name, new RateLimiter(this.clock, connector.rateLimit));
    }
  }
  get(name: string): ConnectorDefinition | undefined {
    return this.connectors.get(name);
  }
  list(): ConnectorDefinition[] {
    return [...this.connectors.values()];
  }

  async call<O = unknown>(name: string, input: unknown, options: ConnectorCallOptions): Promise<O> {
    const connector = this.connectors.get(name);
    if (!connector) throw new Error(`connector '${name}' is not registered`);
    const traceId = this.runtime.observability().newTraceId();

    const missing = connector.permissions.filter((p) => !options.grants.includes(p));
    if (missing.length > 0) {
      await this.record(traceId, name, options.actor, 'rejected', false, `missing permission(s): ${missing.join(', ')}`);
      throw new Error(`connector '${name}' requires permission(s): ${missing.join(', ')}`);
    }

    const limiter = this.limiters.get(name);
    if (limiter && !limiter.allow(options.actor)) {
      await this.record(traceId, name, options.actor, 'approved', false, 'rate_limited');
      throw new Error(`connector '${name}' rate limit exceeded`);
    }

    const ctx: ExecutionContext = {
      traceId,
      actor: options.actor,
      context: { runtime: { mode: this.runtime.context().mode } },
    };
    const attempts = (connector.maxRetries ?? 0) + 1;
    let lastError = '';
    const timer = this.runtime.observability().startTimer(`ai.connector.${name}`);
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const result = (await connector.execute(input, ctx)) as O;
        await this.record(traceId, name, options.actor, 'approved', true, undefined, timer.end());
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    await this.record(traceId, name, options.actor, 'approved', false, lastError, timer.end());
    throw new Error(`connector '${name}' failed after ${attempts} attempt(s): ${lastError}`);
  }

  private record(
    traceId: string,
    target: string,
    actor: string,
    approval: 'approved' | 'rejected',
    ok: boolean,
    detail?: string,
    durationMs = 0,
  ): Promise<unknown> {
    return this.governance.record({
      traceId,
      kind: 'connector',
      target,
      actor,
      durationMs,
      approval,
      ok,
      ...(detail !== undefined ? { detail } : {}),
    });
  }
}
