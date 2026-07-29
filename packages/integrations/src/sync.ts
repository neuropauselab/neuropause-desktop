/**
 * Synchronization engine (NCEA 13.0, Phase 5). Incremental, resumable sync whose
 * checkpoint state is PERSISTED through the Enterprise Persistence Platform (Phase
 * 12) — so a sync survives restart and resumes from its last cursor. It detects
 * conflicts (incoming older than stored), checkpoints after every page, replays
 * from scratch on demand, and recovers from offline errors without losing
 * progress. Records land in a caller-supplied durable repository; checkpoints live
 * in `runtime_metadata`. This is VERIFIED against a real Postgres engine with a
 * deterministic source; LIVE sources are the connectors (INFRA-PENDING).
 */
import type { Clock } from '@neuropause/cloud-core';
import type { PersistenceLayer, TableRepository, Entity } from '@neuropause/persistence';

export interface SyncRecord extends Entity {
  id: string;
  /** Monotonic source version, for conflict detection. */
  version: number;
}

export interface SourcePage<T> {
  items: T[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface SyncSource<T extends SyncRecord> {
  pull(cursor: string | undefined, limit: number): Promise<SourcePage<T>>;
}

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline';

export interface SyncCheckpoint extends Entity {
  id: string; // `sync:${connector}`
  cursor?: string;
  lastSyncAt: number;
  recordsSynced: number;
  conflicts: number;
  status: SyncStatus;
}

export interface SyncResult {
  synced: number;
  conflicts: number;
  pages: number;
  resumedFrom?: string;
  status: SyncStatus;
  cursor?: string;
}

export class SyncEngine {
  private readonly checkpoints: TableRepository<SyncCheckpoint>;

  constructor(
    persistence: PersistenceLayer,
    private readonly clock: Clock,
  ) {
    // Checkpoints reuse the existing runtime_metadata table — no new schema.
    this.checkpoints = persistence.repositories().runtimeMetadata as unknown as TableRepository<SyncCheckpoint>;
  }

  async loadCheckpoint(tenant: string, connector: string): Promise<SyncCheckpoint | undefined> {
    return (await this.checkpoints.get(tenant, `sync:${connector}`))?.value;
  }

  private async saveCheckpoint(tenant: string, cp: SyncCheckpoint): Promise<void> {
    await this.checkpoints.upsert(tenant, cp);
  }

  /**
   * Run an incremental sync, resuming from the persisted cursor. Records upsert
   * into `sink`; a record whose source version is not newer than the stored one
   * is a conflict and is skipped. The checkpoint is saved after every page.
   */
  async sync<T extends SyncRecord>(
    tenant: string,
    connector: string,
    source: SyncSource<T>,
    sink: TableRepository<T>,
    opts: { limit?: number; maxPages?: number } = {},
  ): Promise<SyncResult> {
    const limit = opts.limit ?? 100;
    const maxPages = opts.maxPages ?? 1000;
    const existing = await this.loadCheckpoint(tenant, connector);
    let cursor = existing?.cursor;
    const resumedFrom = cursor;
    let synced = existing?.recordsSynced ?? 0;
    let conflicts = existing?.conflicts ?? 0;
    let pages = 0;

    for (let i = 0; i < maxPages; i++) {
      let page: SourcePage<T>;
      try {
        page = await source.pull(cursor, limit);
      } catch {
        // offline / transient — persist progress and stop; a later sync resumes.
        await this.saveCheckpoint(tenant, this.checkpoint(connector, cursor, synced, conflicts, 'offline'));
        return { synced, conflicts, pages, ...(resumedFrom ? { resumedFrom } : {}), status: 'offline', ...(cursor ? { cursor } : {}) };
      }
      pages += 1;
      for (const item of page.items) {
        const current = await sink.get(tenant, item.id);
        if (current && (current.value.version ?? 0) >= item.version) {
          conflicts += 1; // incoming is not newer — do not clobber
          continue;
        }
        await sink.upsert(tenant, item);
        synced += 1;
      }
      cursor = page.nextCursor;
      await this.saveCheckpoint(tenant, this.checkpoint(connector, cursor, synced, conflicts, page.hasMore ? 'syncing' : 'idle'));
      if (!page.hasMore) break;
    }

    return { synced, conflicts, pages, ...(resumedFrom ? { resumedFrom } : {}), status: 'idle', ...(cursor ? { cursor } : {}) };
  }

  /** Replay: discard the cursor and re-sync from the beginning (idempotent upserts). */
  async replay<T extends SyncRecord>(tenant: string, connector: string, source: SyncSource<T>, sink: TableRepository<T>, opts: { limit?: number; maxPages?: number } = {}): Promise<SyncResult> {
    await this.saveCheckpoint(tenant, this.checkpoint(connector, undefined, 0, 0, 'syncing'));
    return this.sync(tenant, connector, source, sink, opts);
  }

  private checkpoint(connector: string, cursor: string | undefined, synced: number, conflicts: number, status: SyncStatus): SyncCheckpoint {
    return {
      id: `sync:${connector}`,
      ...(cursor !== undefined ? { cursor } : {}),
      lastSyncAt: this.clock.now(),
      recordsSynced: synced,
      conflicts,
      status,
    };
  }
}
