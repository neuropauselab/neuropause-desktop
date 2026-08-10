/**
 * The Unified Store — the single source of truth for canonical entities.
 *
 * Holds every `UnifiedEntity`, keeps the search index in sync, resolves write
 * conflicts (source-authoritative, last-updated-wins with a content tie-break),
 * answers structured queries, and emits `changed` so higher layers (and the
 * renderer) can react. Persisted as JSON today; the same interface can sit on
 * SQLite/Postgres later with no caller changes.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import type {
  UnifiedCounts,
  UnifiedEntity,
  UnifiedQuery,
  UnifiedQueryResult,
} from '@neuropause/shared';
import { createLogger } from '../logger';
import { LocalSearchBackend, type SearchBackend } from './searchBackend';

const log = createLogger('unified-store');

export interface UpsertResult {
  created: number;
  updated: number;
  unchanged: number;
  /** Same-timestamp-but-changed writes the store had to resolve by content. */
  conflicts: number;
}

/** Stable signature of the meaningful fields, for tie-breaking equal timestamps. */
function signature(e: UnifiedEntity): string {
  return JSON.stringify([
    e.title, e.url, e.body, e.status, e.author, e.timestamp, e.endTimestamp,
    e.parentId, e.containerId, e.labels, e.syncState, e.metadata,
  ]);
}

export class UnifiedStore extends EventEmitter {
  private entities = new Map<string, UnifiedEntity>();
  private search: SearchBackend = new LocalSearchBackend();
  private loaded = false;

  constructor(private readonly filePath: string) {
    super();
  }

  /** The backing search index (read-only handle for the search facade). */
  get searchBackend(): SearchBackend {
    return this.search;
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const list = JSON.parse(raw) as UnifiedEntity[];
      if (Array.isArray(list)) {
        for (const e of list) if (e && e.id) this.entities.set(e.id, e);
        this.search.index([...this.entities.values()]);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.warn('Failed to read unified store; starting empty', err);
      }
    }
    this.loaded = true;
    log.info('Unified store ready', { entities: this.entities.size });
  }

  private async persist(): Promise<void> {
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify([...this.entities.values()]), { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }

  /**
   * Insert/merge a batch. Source is authoritative: an incoming record replaces
   * the stored one when its `updatedAt` is newer, or equal but with changed
   * content. Older incoming records are ignored (a stale re-sync never clobbers
   * fresher local state). Returns per-outcome counts.
   */
  async upsertMany(incoming: UnifiedEntity[]): Promise<UpsertResult> {
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    let conflicts = 0;
    const changed: UnifiedEntity[] = [];

    for (const next of incoming) {
      const prev = this.entities.get(next.id);
      if (!prev) {
        this.entities.set(next.id, next);
        changed.push(next);
        created += 1;
        continue;
      }
      const newer = next.updatedAt > prev.updatedAt;
      const sameTimeButChanged = next.updatedAt === prev.updatedAt && signature(next) !== signature(prev);
      if (sameTimeButChanged) conflicts += 1;
      if (newer || sameTimeButChanged) {
        this.entities.set(next.id, next);
        changed.push(next);
        updated += 1;
      } else {
        unchanged += 1;
      }
    }

    if (changed.length > 0) {
      this.search.index(changed);
      await this.persist();
      this.emit('changed', { kind: 'upsert', ids: changed.map((e) => e.id) });
    }
    return { created, updated, unchanged, conflicts };
  }

  get(id: string): UnifiedEntity | null {
    return this.entities.get(id) ?? null;
  }

  /** Soft-delete records (marks syncState='deleted'; query hides them by default). */
  async markDeleted(ids: string[], at: string): Promise<number> {
    const removed: string[] = [];
    for (const id of ids) {
      const e = this.entities.get(id);
      if (e && e.syncState !== 'deleted') {
        this.entities.set(id, { ...e, syncState: 'deleted', syncedAt: at });
        removed.push(id);
      }
    }
    if (removed.length > 0) {
      this.search.remove(removed);
      await this.persist();
      this.emit('changed', { kind: 'delete', ids: removed });
    }
    return removed.length;
  }

  /** Hard-remove every record for a connector (called on disconnect). */
  /**
   * Drop a connector's synced entities — one ACCOUNT's, when one is named.
   *
   * The account filter is not optional politeness: a connector can hold two
   * accounts (a sales portal and a support portal), and disconnecting one used
   * to delete the other's data too, because this only ever filtered on
   * `connectorId`. Silent, and unrecoverable without a re-sync that the
   * remaining account had no reason to run.
   */
  async removeConnector(connectorId: string, accountId?: string): Promise<number> {
    const ids: string[] = [];
    for (const [id, e] of this.entities) {
      if (e.connectorId !== connectorId) continue;
      if (accountId !== undefined && e.accountId !== accountId) continue;
      ids.push(id);
    }
    for (const id of ids) this.entities.delete(id);
    if (ids.length > 0) {
      this.search.remove(ids);
      await this.persist();
      this.emit('changed', { kind: 'delete', ids });
    }
    return ids.length;
  }

  query(q: UnifiedQuery): UnifiedQueryResult {
    const kinds = q.kinds && q.kinds.length > 0 ? new Set(q.kinds) : null;
    const text = q.text?.trim().toLowerCase();
    const filtered: UnifiedEntity[] = [];
    for (const e of this.entities.values()) {
      if (!q.includeDeleted && e.syncState === 'deleted') continue;
      if (kinds && !kinds.has(e.kind)) continue;
      if (q.connectorId && e.connectorId !== q.connectorId) continue;
      if (q.accountId && e.accountId !== q.accountId) continue;
      if (q.containerId && e.containerId !== q.containerId) continue;
      if (q.parentId && e.parentId !== q.parentId) continue;
      if (q.status && e.status !== q.status) continue;
      if (q.since && e.updatedAt < q.since) continue;
      if (q.until && e.updatedAt > q.until) continue;
      if (text && !(`${e.title} ${e.body ?? ''}`.toLowerCase().includes(text))) continue;
      filtered.push(e);
    }

    const sortBy = q.sortBy ?? 'updatedAt';
    const dir = q.order === 'asc' ? 1 : -1;
    filtered.sort((a, b) => {
      const av = sortBy === 'title' ? a.title : (a[sortBy] ?? '');
      const bv = sortBy === 'title' ? b.title : (b[sortBy] ?? '');
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });

    const total = filtered.length;
    const offset = q.cursor ? Math.max(0, parseInt(q.cursor, 10) || 0) : 0;
    const limit = q.limit ?? 50;
    const items = filtered.slice(offset, offset + limit);
    const nextOffset = offset + limit;
    return { items, total, nextCursor: nextOffset < total ? String(nextOffset) : null };
  }

  counts(): UnifiedCounts {
    const byKind: Record<string, number> = {};
    const byConnector: Record<string, number> = {};
    let total = 0;
    let lastUpdatedAt: string | null = null;
    for (const e of this.entities.values()) {
      if (e.syncState === 'deleted') continue;
      total += 1;
      byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
      byConnector[e.connectorId] = (byConnector[e.connectorId] ?? 0) + 1;
      if (!lastUpdatedAt || e.updatedAt > lastUpdatedAt) lastUpdatedAt = e.updatedAt;
    }
    return { total, byKind, byConnector, lastUpdatedAt };
  }

  /** Count of live records for a connector (used by the health dashboard). */
  countForConnector(connectorId: string): number {
    let n = 0;
    for (const e of this.entities.values()) {
      if (e.syncState !== 'deleted' && e.connectorId === connectorId) n += 1;
    }
    return n;
  }
}
