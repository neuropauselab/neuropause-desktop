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
import type { ConnectorAdapter, SyncPage } from './adapterSdk';
import { RetryQueue } from './retryQueue';
import type { SyncStateStore } from './syncStateStore';
import { syncEvents } from './events';

/** Stop runaway paging if an adapter never reports `hasMore: false`. */
const MAX_PAGES_PER_RESOURCE = 50;
/** Default cadence between automatic syncs of an account. */
export const SYNC_INTERVAL_MS = 15 * 60 * 1000;
/** Bounded worker pool: max accounts synced concurrently per scheduler tick. */
export const MAX_CONCURRENT_SYNCS = 4;

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
  /** P4.1 — whether sync is suppressed for this account (paused / disabled). Optional; defaults to false. */
  isSuppressed?: (connectorId: string, accountId: string) => boolean;
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
          const page = await resource.pull({ connectorId, accountId, http, cursor, now: nowIso });
          if (page.entities.length > 0) {
            const r = await this.ports.upsertMany(page.entities);
            created += r.created;
            updated += r.updated;
            conflicts += r.conflicts;
            resCreated += r.created;
          }
          if (page.deletedSourceIds && page.deletedSourceIds.length > 0) {
            const ids = page.deletedSourceIds.map((sid) => makeUnifiedId(connectorId, accountId, resource.kind, sid));
            const d = await this.ports.markDeleted(ids, nowIso);
            deleted += d;
            resDeleted += d;
          }
          if (page.degraded) degraded = page.degraded;
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
      return { ok: true, hadAdapter: true, created, updated, deleted, conflicts, durationMs, error: null, retryable: false, rateLimited: false, offline: false };
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
