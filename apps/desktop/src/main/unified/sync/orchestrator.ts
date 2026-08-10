/**
 * The sync orchestrator — the engine that turns adapters into a populated UDM.
 *
 * It is a plain class over injected ports (no singleton imports), so it unit-tests
 * against a fake adapter with a real Electron-free store. For each connected
 * account it drives every adapter resource's paging loop, persists cursors
 * (incremental sync), writes through the conflict-resolving store, emits Platform
 * Events, and handles rate limits / offline / retries.
 *
 *   manual sync  → connectorService.sync → syncForService → requestSync
 *   auto sync    → scheduler tick        → tick           → requestSync
 *   requestSync  → runAccountSync (+ enqueue retry if the failure was transient)
 *   retry queue  → runAccountSync (re-run, capped backoff)
 */
import type { ConnectorId, PlatformEventInput, UnifiedEntity } from '@neuropause/shared';
import { makeUnifiedId } from '../ids';
import { AuthError, HttpClient, HttpError, NetworkError, RateLimitError, type RateGate } from './http';
import type { ConnectorAdapter, SyncPage } from './adapterSdk';
import { RetryQueue } from './retryQueue';
import type { SyncStateStore } from './syncStateStore';
import { syncEvents } from './events';
import { createLogger } from '../../logger';

const log = createLogger('sync');

/** Stop runaway paging if an adapter never reports `hasMore: false`. */
const MAX_PAGES_PER_RESOURCE = 50;
/** Default cadence between automatic syncs of an account. */
export const SYNC_INTERVAL_MS = 15 * 60 * 1000;
/** Bounded worker pool: max accounts synced concurrently per scheduler tick. */
export const MAX_CONCURRENT_SYNCS = 4;

/** Everything the orchestrator depends on, injected so it can be tested. */
export interface OrchestratorPorts {
  /**
   * The organization this sync run acts for (P13B), or null when none resolves.
   *
   * A PORT, not a global read, and not a parameter on `run()`. It is a port
   * because the orchestrator must not import the tenant resolver (that would
   * couple the sync engine to the enterprise subsystem and break its
   * standalone tests); it is not a parameter because a caller that can name the
   * tenant is a caller that can name someone else's.
   *
   * Returning null STOPS the run. A sync with no owner would mint entities with
   * no owner — invisible to everyone, re-created on every pass — so refusing is
   * both the safe answer and the honest one.
   */
  activeTenantId: () => string | null;
  upsertMany: (entities: UnifiedEntity[], expectedTenantId?: string) => Promise<{ created: number; updated: number; conflicts: number }>;
  markDeleted: (ids: string[], at: string) => Promise<number>;
  countForConnector: (connectorId: string) => number;
  syncState: SyncStateStore;
  getAccessToken: (connectorId: string, accountId: string) => Promise<string | null>;
  getAdapter: (connectorId: string) => ConnectorAdapter | null;
  manifestName: (connectorId: string) => string;
  listConnectedAccounts: () => Array<{ connectorId: string; accountId: string }>;
  publish: (e: PlatformEventInput) => void;
  rate: RateGate;
  /** P4.1 — whether sync is suppressed for this account (paused / disabled). Optional; defaults to false. */
  isSuppressed?: (connectorId: string, accountId: string) => boolean;
  /**
   * P9 — write a resource's entities into the governed business data.
   *
   * Optional so the orchestrator's own tests need not stand up a record store,
   * and so a build without the Data Plane still syncs into the Unified store.
   * A resource with no declared mapping returns zeroes; the orchestrator does
   * not decide what is bridgeable.
   *
   * Deliberately runs AFTER `upsertMany`: the Unified store is the record of
   * what the provider said, and it must not be conditional on the governed
   * write succeeding.
   */
  bridge?: (input: {
    connectorId: ConnectorId;
    accountId: string;
    resourceId: string;
    syncRunId: string;
    entities: UnifiedEntity[];
  }) => Promise<{ created: number; updated: number; adopted: number; ambiguous: number; invalid: number }>;
}

export interface AccountSyncOutcome {
  ok: boolean;
  hadAdapter: boolean;
  created: number;
  updated: number;
  deleted: number;
  conflicts: number;
  durationMs: number;
  error: string | null;
  /** Transient failure that should be retried (rate limit / offline / 5xx). */
  retryable: boolean;
  rateLimited: boolean;
  offline: boolean;
  /**
   * What reached the GOVERNED business data.
   *
   * Absent when no resource in this connector has a declared mapping — which
   * is the honest representation of "this provider's data is searchable but
   * is not business records".
   */
  bridged?: { created: number; updated: number; adopted: number; ambiguous: number; invalid: number };
  /** Set when the sync succeeded but the governed write did not. */
  bridgeError?: string | null;
}

export class SyncOrchestrator {
  private readonly retry: RetryQueue;
  private readonly offlineConnectors = new Set<string>();
  /** P4.1 — per-account in-flight guard: a second sync of the same account coalesces onto the first. */
  private readonly inFlight = new Map<string, Promise<AccountSyncOutcome>>();

  constructor(private readonly ports: OrchestratorPorts) {
    this.retry = new RetryQueue(
      async (c, a) => {
        const o = await this.runAccountSync(c, a);
        return o.retryable;
      },
      {
        // P4.1 — a retry-budget exhaustion dead-letters the account (durable), instead of a silent drop.
        onExhausted: (c, a, attempts) => {
          void this.ports.syncState.recordDeadLetter(c, a, {
            at: new Date().toISOString(),
            attempts,
            error: this.ports.syncState.get(c, a).lastError,
          });
        },
      },
    );
  }

  /** Live retry-queue depth, for the Health Dashboard. */
  retrySize(connectorId?: string, accountId?: string): number {
    return this.retry.size(connectorId, accountId);
  }

  stop(): void {
    this.retry.stop();
  }

  /** Entry point for manual + scheduled sync: run once, queue a retry if transient. */
  async requestSync(connectorId: string, accountId: string): Promise<AccountSyncOutcome> {
    const outcome = await this.runAccountSync(connectorId, accountId);
    if (outcome.retryable) this.retry.enqueue(connectorId, accountId);
    return outcome;
  }

  /** Shape the connector service expects from its injected sync runner. */
  async syncForService(
    connectorId: string,
    accountId: string,
  ): Promise<{ ok: boolean; total: number; hadAdapter: boolean; error: string | null }> {
    const o = await this.requestSync(connectorId, accountId);
    return { ok: o.ok, total: o.created + o.updated, hadAdapter: o.hadAdapter, error: o.error };
  }

  /** Scheduler tick: sync every due account, suppressed accounts skipped, through a bounded worker pool. */
  async tick(): Promise<void> {
    const now = Date.now();
    const due: Array<{ connectorId: string; accountId: string }> = [];
    for (const { connectorId, accountId } of this.ports.listConnectedAccounts()) {
      if (!this.ports.getAdapter(connectorId)) continue;
      if (this.ports.isSuppressed?.(connectorId, accountId)) continue; // paused / disabled
      const st = this.ports.syncState.get(connectorId, accountId);
      const rateLimitedUntil = st.rateLimitedUntil ? Date.parse(st.rateLimitedUntil) : 0;
      if (rateLimitedUntil > now) continue;
      const isDue = !st.nextSyncAt || Date.parse(st.nextSyncAt) <= now;
      if (isDue) due.push({ connectorId, accountId });
    }
    await this.runPool(due, MAX_CONCURRENT_SYNCS);
  }

  /** Run `items` through `requestSync` with at most `limit` in flight at once. */
  private async runPool(items: Array<{ connectorId: string; accountId: string }>, limit: number): Promise<void> {
    let i = 0;
    const worker = async (): Promise<void> => {
      while (i < items.length) {
        const item = items[i++];
        await this.requestSync(item.connectorId, item.accountId);
      }
    };
    const n = Math.min(Math.max(1, limit), items.length);
    await Promise.all(Array.from({ length: n }, () => worker()));
  }

  /**
   * Run one account's full sync, guarded by a per-account mutex: a concurrent call for the SAME account
   * (e.g. a manual sync landing during a scheduler tick) coalesces onto the in-flight run instead of
   * double-pulling. Distinct accounts still run in parallel.
   */
  async runAccountSync(connectorId: string, accountId: string): Promise<AccountSyncOutcome> {
    // P4.1 — single suppression choke point: paused/disabled accounts never pull, regardless of caller
    // (scheduler tick, manual, or a queued RETRY). Returns a benign, non-retryable no-op so the retry
    // queue drops the item instead of re-running it.
    if (this.ports.isSuppressed?.(connectorId, accountId)) {
      return { ok: true, hadAdapter: Boolean(this.ports.getAdapter(connectorId)), created: 0, updated: 0, deleted: 0, conflicts: 0, durationMs: 0, error: null, retryable: false, rateLimited: false, offline: false };
    }
    const k = `${connectorId}::${accountId}`;
    const existing = this.inFlight.get(k);
    if (existing) return existing;
    const p = this.runAccountSyncInner(connectorId, accountId).finally(() => this.inFlight.delete(k));
    this.inFlight.set(k, p);
    return p;
  }

  /** Run one account's full sync across all its adapter resources. */
  private async runAccountSyncInner(connectorId: string, accountId: string): Promise<AccountSyncOutcome> {
    const adapter = this.ports.getAdapter(connectorId);
    const name = this.ports.manifestName(connectorId);
    const zero = { created: 0, updated: 0, deleted: 0, conflicts: 0 };

    if (!adapter) {
      // No data adapter for this provider yet → connection is still "verified".
      return { ok: true, hadAdapter: false, ...zero, durationMs: 0, error: null, retryable: false, rateLimited: false, offline: false };
    }

    const start = Date.now();
    const nowIso = new Date().toISOString();

    /**
     * P13B — resolve the owning tenant ONCE, before any provider call.
     *
     * Read here rather than per page so a workspace switch mid-run cannot make
     * the first half of a sync land in one tenant and the second half in
     * another. The whole run either belongs to one organization or does not
     * happen.
     */
    const tenantId = this.ports.activeTenantId();
    if (tenantId === null) {
      /**
       * RETRYABLE, not a hard failure. There is nothing wrong with the
       * connector or the provider — the app simply has no active organization
       * yet (cold start, signed out, a workspace still opening). Marking it
       * terminal would leave the account looking broken until a manual retry;
       * marking it retryable lets the normal schedule pick it up once a tenant
       * resolves.
       */
      await this.ports.syncState.recordRun(connectorId, accountId, {
        status: 'error',
        lastError: 'No organization is active, so this sync has no owner.',
      });
      return {
        ok: false,
        hadAdapter: true,
        ...zero,
        durationMs: 0,
        error: 'No organization is active, so this sync has no owner.',
        retryable: true,
        rateLimited: false,
        offline: false,
      };
    }

    const http = new HttpClient(
      connectorId,
      async () => {
        const token = await this.ports.getAccessToken(connectorId, accountId);
        if (!token) throw new AuthError('no valid token');
        return token;
      },
      this.ports.rate,
      adapter.baseHeaders,
    );

    let created = 0;
    let updated = 0;
    let deleted = 0;
    let conflicts = 0;
    /**
     * What reached the GOVERNED business data, counted separately.
     *
     * Separate from `created`/`updated` on purpose: those count Unified
     * entities, and conflating them would make "1,200 records synced" read as
     * "1,200 customers in your business data" when most resources have no
     * mapping at all.
     */
    const bridged = { created: 0, updated: 0, adopted: 0, ambiguous: 0, invalid: 0 };
    let bridgeError: string | null = null;
    /** One id per account sync, carried into every bridged record's provenance. */
    const syncRunId = `sync_${connectorId}_${accountId}_${Date.parse(nowIso) || 0}`;

    try {
      // Inside the try so a persistence error still lands in the catch and records a terminal status
      // (never leaves the account stranded as 'syncing').
      this.ports.publish(syncEvents.started(connectorId, name, accountId));
      await this.ports.syncState.recordRun(connectorId, accountId, { status: 'syncing' });
      for (const resource of adapter.resources) {
        let cursor = this.ports.syncState.getCursor(connectorId, accountId, resource.id);
        let pages = 0;
        let resCreated = 0;
        let resDeleted = 0;
        let degraded: SyncPage['degraded'];
        for (;;) {
          const page = await resource.pull({
            tenantId,
            connectorId,
            accountId,
            http,
            cursor,
            now: nowIso,
          });
          if (page.entities.length > 0) {
            // P13B — assert the run's tenant is still active; see UnifiedStore.upsertMany.
            const r = await this.ports.upsertMany(page.entities, tenantId);
            created += r.created;
            updated += r.updated;
            conflicts += r.conflicts;
            resCreated += r.created;

            /**
             * P9 — and into the governed business data.
             *
             * Failing to bridge must not fail the sync. The Unified store
             * already holds what the provider said; losing a page of that
             * because a destination module was momentarily unwritable would
             * make the cursor advance over data nothing recorded.
             */
            if (this.ports.bridge) {
              try {
                const b = await this.ports.bridge({
                  connectorId,
                  accountId,
                  resourceId: resource.id,
                  syncRunId,
                  entities: page.entities,
                });
                bridged.created += b.created;
                bridged.updated += b.updated;
                bridged.adopted += b.adopted;
                bridged.ambiguous += b.ambiguous;
                bridged.invalid += b.invalid;
              } catch (err) {
                bridgeError = err instanceof Error ? err.message : String(err);
              }
            }
          }
          if (page.deletedSourceIds && page.deletedSourceIds.length > 0) {
            const ids = page.deletedSourceIds.map((sid) => makeUnifiedId(tenantId, connectorId, accountId, resource.kind, sid));
            const d = await this.ports.markDeleted(ids, nowIso);
            deleted += d;
            resDeleted += d;
          }
          if (page.degraded) degraded = page.degraded;

          /**
           * The cursor does NOT advance when the governed write failed.
           *
           * It used to: the catch above recorded `bridgeError` and execution
           * fell straight through to `setCursor`, so the next sync started
           * AFTER the page it had failed to write and those records never
           * reached the business data again — with `ok: true` returned and a
           * log line as the only trace. Holding the cursor makes the next run
           * replay the page, which the external-key idempotency makes safe.
           */
          if (bridgeError !== null) break;

          cursor = page.cursor;
          await this.ports.syncState.setCursor(connectorId, accountId, resource.id, cursor, nowIso);
          pages += 1;
          if (!page.hasMore || pages >= MAX_PAGES_PER_RESOURCE) break;
        }
        // Record per-module stats so the UI can show each resource's authorized/degraded status + count.
        // objectCount is a running live total (created − deleted) attributed to this exact resource, so
        // modules that share a kind (e.g. directory users vs M365 contacts) are never conflated.
        const prevCount =
          this.ports.syncState.get(connectorId, accountId).resources[resource.id]?.objectCount ?? 0;
        await this.ports.syncState.recordResource(connectorId, accountId, resource.id, {
          label: resource.label,
          kind: resource.kind,
          objectCount: Math.max(0, prevCount + resCreated - resDeleted),
          status: degraded ? degraded.kind : 'ok',
          reason: degraded ? degraded.reason : null,
          lastSyncAt: nowIso,
        });
      }

      if (this.offlineConnectors.delete(connectorId)) {
        this.ports.publish(syncEvents.online(connectorId, name, accountId));
      }
      if (created > 0) this.ports.publish(syncEvents.entityCreated(connectorId, name, accountId, created));
      if (updated > 0) this.ports.publish(syncEvents.entityUpdated(connectorId, name, accountId, updated));
      if (deleted > 0) this.ports.publish(syncEvents.entityDeleted(connectorId, name, accountId, deleted));
      if (conflicts > 0) {
        this.ports.publish(syncEvents.conflictDetected(connectorId, name, accountId, conflicts));
        this.ports.publish(syncEvents.conflictResolved(connectorId, name, accountId, conflicts));
      }

      const durationMs = Date.now() - start;
      await this.ports.syncState.recordRun(connectorId, accountId, {
        status: 'success',
        lastSyncAt: nowIso,
        lastDurationMs: durationMs,
        lastError: null,
        consecutiveFailures: 0,
        entityCount: this.ports.countForConnector(connectorId),
        nextSyncAt: new Date(Date.now() + SYNC_INTERVAL_MS).toISOString(),
        rateLimitedUntil: null,
        deadLetter: null, // a successful sync clears any prior dead-letter (replay recovered)
      });
      this.ports.publish(syncEvents.completed(connectorId, name, accountId, { created, updated, deleted, durationMs }));

      /**
       * A bridge failure is reported, never swallowed and never fatal.
       *
       * The provider data IS synced — it is in the Unified store and on the
       * timeline — so the run is a success. But "synced" and "in your business
       * data" are different claims, and a run where the second one failed must
       * not read as though both worked.
       */
      if (bridgeError !== null) {
        log.warn('Sync completed but the governed write failed', {
          connectorId,
          accountId,
          err: bridgeError,
        });
      }
      if (bridged.created + bridged.updated + bridged.adopted > 0) {
        log.info('Bridged into business data', { connectorId, accountId, ...bridged });
      }

      return { ok: true, hadAdapter: true, created, updated, deleted, conflicts, durationMs, error: null, retryable: false, rateLimited: false, offline: false, bridged, bridgeError };
    } catch (err) {
      const durationMs = Date.now() - start;
      const prevFailures = this.ports.syncState.get(connectorId, accountId).consecutiveFailures;

      if (err instanceof RateLimitError) {
        const until = new Date(Date.now() + err.retryAfterMs).toISOString();
        await this.ports.syncState.recordRun(connectorId, accountId, {
          status: 'rate_limited',
          lastDurationMs: durationMs,
          lastError: 'rate limited', // so a dead-letter caused by repeated 429s carries a meaningful reason
          rateLimitedUntil: until,
          nextSyncAt: until,
        });
        this.ports.publish(syncEvents.rateLimited(connectorId, name, accountId, err.retryAfterMs));
        return { ok: false, hadAdapter: true, created, updated, deleted, conflicts, durationMs, error: 'rate limited', retryable: true, rateLimited: true, offline: false };
      }

      if (err instanceof NetworkError) {
        if (!this.offlineConnectors.has(connectorId)) {
          this.offlineConnectors.add(connectorId);
          this.ports.publish(syncEvents.offline(connectorId, name, accountId));
        }
        await this.ports.syncState.recordRun(connectorId, accountId, {
          status: 'offline',
          lastDurationMs: durationMs,
          lastError: err.message,
          consecutiveFailures: prevFailures + 1,
        });
        return { ok: false, hadAdapter: true, created, updated, deleted, conflicts, durationMs, error: err.message, retryable: true, rateLimited: false, offline: true };
      }

      const msg = err instanceof Error ? err.message : 'sync failed';
      const retryable = err instanceof HttpError && err.retryable;
      await this.ports.syncState.recordRun(connectorId, accountId, {
        status: 'error',
        lastDurationMs: durationMs,
        lastError: msg,
        consecutiveFailures: prevFailures + 1,
      });
      this.ports.publish(syncEvents.failed(connectorId, name, accountId, msg));
      return { ok: false, hadAdapter: true, created, updated, deleted, conflicts, durationMs, error: msg, retryable, rateLimited: false, offline: false };
    }
  }
}
