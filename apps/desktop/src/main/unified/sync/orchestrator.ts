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
import type { PlatformEventInput, UnifiedEntity } from '@neuropause/shared';
import { makeUnifiedId } from '../ids';
import { AuthError, HttpClient, HttpError, NetworkError, RateLimitError, type RateGate } from './http';
import type { ConnectorAdapter } from './adapterSdk';
import { RetryQueue } from './retryQueue';
import type { SyncStateStore } from './syncStateStore';
import { syncEvents } from './events';

/** Stop runaway paging if an adapter never reports `hasMore: false`. */
const MAX_PAGES_PER_RESOURCE = 50;
/** Default cadence between automatic syncs of an account. */
export const SYNC_INTERVAL_MS = 15 * 60 * 1000;

/** Everything the orchestrator depends on, injected so it can be tested. */
export interface OrchestratorPorts {
  upsertMany: (entities: UnifiedEntity[]) => Promise<{ created: number; updated: number; conflicts: number }>;
  markDeleted: (ids: string[], at: string) => Promise<number>;
  countForConnector: (connectorId: string) => number;
  syncState: SyncStateStore;
  getAccessToken: (connectorId: string, accountId: string) => Promise<string | null>;
  getAdapter: (connectorId: string) => ConnectorAdapter | null;
  manifestName: (connectorId: string) => string;
  listConnectedAccounts: () => Array<{ connectorId: string; accountId: string }>;
  publish: (e: PlatformEventInput) => void;
  rate: RateGate;
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
}

export class SyncOrchestrator {
  private readonly retry: RetryQueue;
  private readonly offlineConnectors = new Set<string>();

  constructor(private readonly ports: OrchestratorPorts) {
    this.retry = new RetryQueue(async (c, a) => {
      const o = await this.runAccountSync(c, a);
      return o.retryable;
    });
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

  /** Scheduler tick: sync every connected account whose next run is due. */
  async tick(): Promise<void> {
    const now = Date.now();
    for (const { connectorId, accountId } of this.ports.listConnectedAccounts()) {
      if (!this.ports.getAdapter(connectorId)) continue;
      const st = this.ports.syncState.get(connectorId, accountId);
      const rateLimitedUntil = st.rateLimitedUntil ? Date.parse(st.rateLimitedUntil) : 0;
      if (rateLimitedUntil > now) continue;
      const due = !st.nextSyncAt || Date.parse(st.nextSyncAt) <= now;
      if (due) await this.requestSync(connectorId, accountId);
    }
  }

  /** Run one account's full sync across all its adapter resources. */
  async runAccountSync(connectorId: string, accountId: string): Promise<AccountSyncOutcome> {
    const adapter = this.ports.getAdapter(connectorId);
    const name = this.ports.manifestName(connectorId);
    const zero = { created: 0, updated: 0, deleted: 0, conflicts: 0 };

    if (!adapter) {
      // No data adapter for this provider yet → connection is still "verified".
      return { ok: true, hadAdapter: false, ...zero, durationMs: 0, error: null, retryable: false, rateLimited: false, offline: false };
    }

    const start = Date.now();
    const nowIso = new Date().toISOString();
    this.ports.publish(syncEvents.started(connectorId, name, accountId));
    await this.ports.syncState.recordRun(connectorId, accountId, { status: 'syncing' });

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

    try {
      for (const resource of adapter.resources) {
        let cursor = this.ports.syncState.getCursor(connectorId, accountId, resource.id);
        let pages = 0;
        for (;;) {
          const page = await resource.pull({ connectorId, accountId, http, cursor, now: nowIso });
          if (page.entities.length > 0) {
            const r = await this.ports.upsertMany(page.entities);
            created += r.created;
            updated += r.updated;
            conflicts += r.conflicts;
          }
          if (page.deletedSourceIds && page.deletedSourceIds.length > 0) {
            const ids = page.deletedSourceIds.map((sid) => makeUnifiedId(connectorId, accountId, resource.kind, sid));
            deleted += await this.ports.markDeleted(ids, nowIso);
          }
          cursor = page.cursor;
          await this.ports.syncState.setCursor(connectorId, accountId, resource.id, cursor, nowIso);
          pages += 1;
          if (!page.hasMore || pages >= MAX_PAGES_PER_RESOURCE) break;
        }
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
      });
      this.ports.publish(syncEvents.completed(connectorId, name, accountId, { created, updated, deleted, durationMs }));
      return { ok: true, hadAdapter: true, created, updated, deleted, conflicts, durationMs, error: null, retryable: false, rateLimited: false, offline: false };
    } catch (err) {
      const durationMs = Date.now() - start;
      const prevFailures = this.ports.syncState.get(connectorId, accountId).consecutiveFailures;

      if (err instanceof RateLimitError) {
        const until = new Date(Date.now() + err.retryAfterMs).toISOString();
        await this.ports.syncState.recordRun(connectorId, accountId, {
          status: 'rate_limited',
          lastDurationMs: durationMs,
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
