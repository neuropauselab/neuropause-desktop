/**
 * Connector executor (NCEA 10.4, Phase 1 execution + Phase 8 governance).
 *
 * The single governed path to invoke a connector action:
 *   installed + enabled → permission gate → policy gate → rate limit →
 *   argument validation → execute (with secret access via the vault at use time,
 *   never exposed) → retry → GOVERNANCE record (audit + event + timeline).
 * A connector action cannot run outside this path or without an audit record.
 */
import { RateLimiter, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { ConnectorRegistry } from './registry';
import type { ConnectorGovernance } from './governance';
import type { SecretVault } from './vault';
import { connectorAction, type ConnectorExecutionContext } from './sdk';

export interface InvokeOptions {
  actor: string;
  grants: string[];
  org?: string;
  workspace?: string;
  retries?: number;
}

export class ConnectorExecutor {
  private readonly limiters = new Map<string, RateLimiter>();

  constructor(
    private readonly runtime: EnterpriseRuntime,
    private readonly registry: ConnectorRegistry,
    private readonly governance: ConnectorGovernance,
    private readonly vault: SecretVault,
    private readonly clock: Clock,
  ) {}

  async invoke<O = unknown>(
    connectorId: string,
    actionName: string,
    input: unknown,
    options: InvokeOptions,
  ): Promise<O> {
    const entry = this.registry.get(connectorId);
    if (!entry) throw new Error(`connector '${connectorId}' is not installed`);
    if (entry.state !== 'enabled') throw new Error(`connector '${connectorId}' is disabled`);
    const def = entry.def;
    const action = connectorAction(def, actionName);
    if (!action) throw new Error(`connector '${connectorId}' has no action '${actionName}'`);

    const traceId = this.runtime.observability().newTraceId();
    const base = {
      connectorId,
      operation: actionName,
      provider: def.category,
      actor: options.actor,
      ...(options.org ? { org: options.org } : {}),
      ...(options.workspace ? { workspace: options.workspace } : {}),
      traceId,
    };

    // Permission gate (connector + action permissions).
    const required = [...def.permissions, ...action.permissions];
    const missing = required.filter((p) => !options.grants.includes(p));
    if (missing.length > 0) {
      await this.governance.record({ ...base, durationMs: 0, retryCount: 0, approval: 'rejected', ok: false, detail: `missing permission(s): ${missing.join(', ')}` });
      throw new Error(`connector '${connectorId}.${actionName}' requires permission(s): ${missing.join(', ')}`);
    }

    // Policy gate.
    const denied = (def.policies ?? []).find((p) => !p.allow);
    if (denied) {
      await this.governance.record({ ...base, durationMs: 0, retryCount: 0, approval: 'rejected', ok: false, detail: `policy '${denied.name}' denies execution` });
      throw new Error(`connector '${connectorId}' blocked by policy '${denied.name}'`);
    }

    // Rate limit (per actor).
    let limiter = this.limiters.get(connectorId);
    if (!limiter && def.rateLimit) {
      limiter = new RateLimiter(this.clock, def.rateLimit);
      this.limiters.set(connectorId, limiter);
    }
    if (limiter && !limiter.allow(options.actor)) {
      await this.governance.record({ ...base, durationMs: 0, retryCount: 0, approval: 'approved', ok: false, detail: 'rate_limited' });
      throw new Error(`connector '${connectorId}' rate limit exceeded`);
    }

    // Argument validation.
    let args = input;
    if (action.schema) {
      const parsed = action.schema.safeParse(input);
      if (!parsed.success) {
        await this.governance.record({ ...base, durationMs: 0, retryCount: 0, approval: 'approved', ok: false, detail: 'invalid arguments' });
        throw new Error(`invalid arguments for '${connectorId}.${actionName}'`);
      }
      args = parsed.data;
    }

    const ctx: ConnectorExecutionContext = {
      traceId,
      actor: options.actor,
      ...(options.org ? { org: options.org } : {}),
      ...(options.workspace ? { workspace: options.workspace } : {}),
      secret: (key) => this.vault.reveal({ scope: connectorId, key }),
      log: (message, fields) => this.runtime.observability().logger.info(message, fields ?? {}),
    };

    const approval = required.length > 0 ? 'approved' : 'not-required';
    const attempts = (options.retries ?? 0) + 1;
    const timer = this.runtime.observability().startTimer(`connector.${connectorId}.${actionName}`);
    let lastError = '';
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const result = (await action.execute(args, ctx)) as O;
        await this.governance.record({ ...base, durationMs: timer.end(), retryCount: attempt - 1, approval, ok: true });
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    await this.governance.record({ ...base, durationMs: timer.end(), retryCount: attempts - 1, approval, ok: false, detail: lastError });
    throw new Error(`connector '${connectorId}.${actionName}' failed after ${attempts} attempt(s): ${lastError}`);
  }
}
