/**
 * The Infrastructure Discovery Engine (P6).
 *
 * The discovery analog of the connector sync orchestrator: it drives each platform's `DomainCollector`s
 * INCREMENTALLY — reading the durable cursor, paging via `collect()` up to a bound, persisting the cursor so
 * the next run resumes (never an unnecessary full rescan), and degrading one domain gracefully (403/404)
 * without failing the platform. It is a plain class over injected ports (the `OrchestratorPorts` philosophy),
 * so the runtime wires the reused primitives — the `RetryQueue`, `RateLimiter`, and `HttpClient` — around it,
 * and tests drive it with a fake platform + in-memory state. Discovered resources are handed to the sink
 * (the `ResourceStore`), and lifecycle events are published onto the ONE Platform Event Bus (→ Timeline).
 */
import type { CloudPlatformAdapter, CloudResource, DiscoveryHttp, DiscoveryPage, PlatformEventInput } from '@neuropause/shared';
import { HttpError, NetworkError, RateLimitError } from '../unified/sync/http';
import { errorStatus } from '../unified/sync/adapters/delta';
import { infraEvents } from './infraEvents';
import type { DiscoveryStatePort } from './discoveryState';

/** Bound one account's per-collector page walk (matches the sync orchestrator's per-resource cap). */
export const MAX_DISCOVERY_PAGES = 50;
/** Default cadence between automatic discoveries (mirrors SYNC_INTERVAL_MS). */
export const DISCOVERY_INTERVAL_MS = 15 * 60 * 1000;

export interface DiscoverySink {
  (platformId: string, accountId: string, resources: CloudResource[], deletedIds: string[]): Promise<{ created: number; updated: number; deleted: number }>;
}

export interface DiscoveryEnginePorts {
  /** The registered discovery adapter for a platform, or null (unconfigured until P6.1). */
  getPlatform: (platformId: string) => CloudPlatformAdapter | null;
  /** Durable incremental cursor + per-domain stat store. */
  state: DiscoveryStatePort;
  /** Build the rate-gated, token-attached HTTP client for a platform account (reuses the connector HttpClient). */
  makeHttp: (platformId: string, accountId: string) => DiscoveryHttp;
  /** Persist discovered resources into the Resource Store. */
  sink: DiscoverySink;
  /** Publish a lifecycle event onto the Platform Event Bus (→ Timeline). */
  publish: (e: PlatformEventInput) => void;
  /** Logical run clock (ISO). */
  now: () => string;
}

export interface DiscoveryDomainOutcome {
  collectorId: string;
  domain: string;
  status: 'active' | 'unauthorized' | 'unprovisioned' | 'error';
  count: number;
  reason: string | null;
}

export interface DiscoveryOutcome {
  ok: boolean;
  hadAdapter: boolean;
  resources: number;
  created: number;
  updated: number;
  deleted: number;
  domains: DiscoveryDomainOutcome[];
  error?: string;
  /** Whether a hard failure is worth a retry (a 429/5xx/network error, not a 4xx). */
  retryable: boolean;
}

/** A transient failure worth a retry — a 429 (RateLimitError), an offline blip (NetworkError), or a
 *  retryable 5xx (HttpError.retryable). Matches the sync orchestrator's taxonomy; a 4xx is NOT retried. */
function isRetryable(err: unknown): boolean {
  return err instanceof RateLimitError || err instanceof NetworkError || (err instanceof HttpError && err.retryable);
}

export class InfrastructureDiscoveryEngine {
  constructor(private readonly ports: DiscoveryEnginePorts) {}

  /**
   * Discover one platform account. Drives every collector incrementally, degrading a domain gracefully on
   * 403/404 and isolating a domain-level hard error so one domain never fails the account. Persists cursors
   * as it goes, sinks the resources, and records the run. Returns a per-domain outcome for the UI.
   */
  async discoverAccount(platformId: string, accountId: string, region: string | null = null): Promise<DiscoveryOutcome> {
    const adapter = this.ports.getPlatform(platformId);
    if (!adapter) {
      return { ok: false, hadAdapter: false, resources: 0, created: 0, updated: 0, deleted: 0, domains: [], retryable: false };
    }
    const now = this.ports.now();
    await this.ports.state.recordRun(platformId, accountId, { status: 'discovering', region });
    this.ports.publish(infraEvents.discoveryStarted(platformId, accountId));

    const http = this.ports.makeHttp(platformId, accountId);
    const collected: CloudResource[] = [];
    const deleted: string[] = [];
    const domains: DiscoveryDomainOutcome[] = [];
    let hardError: string | undefined;
    let retryable = false;

    for (const collector of adapter.collectors) {
      try {
        const { count, status, reason } = await this.runCollector(adapter, collector, platformId, accountId, region, now, http, collected, deleted);
        await this.ports.state.recordDomain(platformId, accountId, collector.id, { label: collector.label, domain: collector.domain, resourceCount: count, status, reason, lastDiscoveryAt: now });
        domains.push({ collectorId: collector.id, domain: collector.domain, status, count, reason });
      } catch (err) {
        const s = errorStatus(err);
        const status = s === 403 ? 'unauthorized' : s === 404 ? 'unprovisioned' : 'error';
        const reason = err instanceof Error ? err.message : String(err);
        if (status === 'error') {
          retryable = retryable || isRetryable(err);
          if (!hardError) hardError = reason;
        }
        await this.ports.state.recordDomain(platformId, accountId, collector.id, { label: collector.label, domain: collector.domain, resourceCount: 0, status, reason, lastDiscoveryAt: now });
        domains.push({ collectorId: collector.id, domain: collector.domain, status, count: 0, reason });
      }
    }

    const sink = await this.ports.sink(platformId, accountId, collected, deleted);
    const ok = !hardError;
    this.ports.publish(infraEvents.discoveryCompleted(platformId, accountId, { created: sink.created, updated: sink.updated, deleted: sink.deleted, total: collected.length }));
    if (!ok) this.ports.publish(infraEvents.discoveryFailed(platformId, accountId, hardError!));

    const degraded = domains.some((d) => d.status === 'unauthorized' || d.status === 'unprovisioned');
    const prev = this.ports.state.get(platformId, accountId);
    await this.ports.state.recordRun(platformId, accountId, {
      status: ok ? (degraded ? 'degraded' : 'idle') : 'error',
      lastDiscoveryAt: now,
      nextDiscoveryAt: new Date(Date.parse(now) + DISCOVERY_INTERVAL_MS).toISOString(),
      resourceCount: collected.length,
      consecutiveFailures: ok ? 0 : prev.consecutiveFailures + 1,
      region,
    });

    return { ok, hadAdapter: true, resources: collected.length, created: sink.created, updated: sink.updated, deleted: sink.deleted, domains, error: hardError, retryable };
  }

  /** Page one collector incrementally into the accumulators; returns its per-domain result. */
  private async runCollector(
    _adapter: CloudPlatformAdapter,
    collector: CloudPlatformAdapter['collectors'][number],
    platformId: string,
    accountId: string,
    region: string | null,
    now: string,
    http: DiscoveryHttp,
    collected: CloudResource[],
    deleted: string[],
  ): Promise<{ count: number; status: DiscoveryDomainOutcome['status']; reason: string | null }> {
    let cursor = this.ports.state.getCursor(platformId, accountId, collector.id);
    let pages = 0;
    let count = 0;
    let degraded: DiscoveryPage['degraded'];
    for (;;) {
      const page = await collector.collect({ platformId, accountId, region, cursor, now, http });
      for (const r of page.resources) collected.push(r);
      count += page.resources.length;
      if (page.deletedResourceIds) for (const d of page.deletedResourceIds) deleted.push(d);
      cursor = page.cursor;
      await this.ports.state.setCursor(platformId, accountId, collector.id, cursor, now);
      if (page.degraded) {
        degraded = page.degraded;
        break;
      }
      pages += 1;
      if (!page.hasMore || pages >= MAX_DISCOVERY_PAGES) break;
    }
    if (degraded) return { count, status: degraded.kind, reason: degraded.reason };
    return { count, status: 'active', reason: null };
  }
}
