/**
 * Observability (NCEA 13.0, Phase 8). Aggregates integration metrics — provider,
 * connector, sync, webhook, token-refresh, retry, and cost — and feeds them into
 * the existing runtime observability (no parallel metrics system). Cost is
 * computed from an operator-supplied price table applied to real token counts;
 * it is NEVER fabricated — with no price table, cost is reported as unknown (0).
 */
import type { EnterpriseRuntime } from '@neuropause/runtime';

export interface IntegrationMetricsSnapshot {
  providers: Record<string, { calls: number; errors: number; totalTokens: number }>;
  connectors: Record<string, { calls: number; errors: number }>;
  sync: { runs: number; records: number; conflicts: number };
  webhooks: { received: number; accepted: number; rejected: number; deduped: number; deadLettered: number };
  retries: { attempts: number; exhausted: number };
  tokenRefresh: { refreshes: number; failures: number };
  cost: { estUsd: number; priced: boolean };
}

/** Optional price table: model → USD per 1k prompt/completion tokens. */
export type PriceTable = Record<string, { prompt: number; completion: number }>;

export class IntegrationObservability {
  private readonly providers = new Map<string, { calls: number; errors: number; totalTokens: number }>();
  private readonly connectors = new Map<string, { calls: number; errors: number }>();
  private sync = { runs: 0, records: 0, conflicts: 0 };
  private webhooks = { received: 0, accepted: 0, rejected: 0, deduped: 0, deadLettered: 0 };
  private retries = { attempts: 0, exhausted: 0 };
  private tokenRefresh = { refreshes: 0, failures: 0 };
  private cost = 0;
  private priced = false;

  constructor(
    private readonly runtime?: EnterpriseRuntime,
    private readonly prices?: PriceTable,
  ) {}

  recordProvider(id: string, input: { ok: boolean; promptTokens?: number; completionTokens?: number; model?: string }): void {
    const p = this.providers.get(id) ?? { calls: 0, errors: 0, totalTokens: 0 };
    p.calls += 1;
    if (!input.ok) p.errors += 1;
    const total = (input.promptTokens ?? 0) + (input.completionTokens ?? 0);
    p.totalTokens += total;
    this.providers.set(id, p);
    const price = input.model ? this.prices?.[input.model] : undefined;
    if (price) {
      this.cost += ((input.promptTokens ?? 0) / 1000) * price.prompt + ((input.completionTokens ?? 0) / 1000) * price.completion;
      this.priced = true;
    }
    this.runtime?.observability().metrics.inc('integration.provider.calls');
    if (!input.ok) this.runtime?.observability().metrics.inc('integration.provider.errors');
  }

  recordConnector(id: string, ok: boolean): void {
    const c = this.connectors.get(id) ?? { calls: 0, errors: 0 };
    c.calls += 1;
    if (!ok) c.errors += 1;
    this.connectors.set(id, c);
  }

  recordSync(records: number, conflicts: number): void {
    this.sync.runs += 1;
    this.sync.records += records;
    this.sync.conflicts += conflicts;
  }

  recordWebhooks(stat: { received: number; accepted: number; rejected: number; deduped: number; deadLettered: number }): void {
    this.webhooks = { ...stat };
  }

  recordRetry(exhausted: boolean): void {
    this.retries.attempts += 1;
    if (exhausted) this.retries.exhausted += 1;
  }

  recordTokenRefresh(ok: boolean): void {
    this.tokenRefresh.refreshes += 1;
    if (!ok) this.tokenRefresh.failures += 1;
  }

  snapshot(): IntegrationMetricsSnapshot {
    return {
      providers: Object.fromEntries(this.providers),
      connectors: Object.fromEntries(this.connectors),
      sync: { ...this.sync },
      webhooks: { ...this.webhooks },
      retries: { ...this.retries },
      tokenRefresh: { ...this.tokenRefresh },
      cost: { estUsd: Number(this.cost.toFixed(6)), priced: this.priced },
    };
  }
}
