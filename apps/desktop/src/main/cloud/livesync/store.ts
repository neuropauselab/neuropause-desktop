/**
 * The persisted store backing the sync engine: the outbound change queue and the
 * per-org pull cursor, written atomically to a JSON file so they survive restarts.
 *
 * `applyRemote` — writing a pulled change into the local stores for its entity type
 * — is delegated to an injected `applyLocal` port. That is deliberate: the six
 * syncable types live in different local stores (workspace settings, connectors,
 * …) and some do not exist yet, so this module owns only the durable queue + cursor
 * and stays honest about the boundary. The concrete `applyLocal` is wired per entity
 * type separately.
 */
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import type { MergeOutcome, SyncChange } from '@neuropause/shared';
import type { QueuedChange, SyncStore } from './types';

interface SyncFileData {
  version: 1;
  queues: Record<string, QueuedChange[]>;
  cursors: Record<string, number>;
}

function emptyData(): SyncFileData {
  return { version: 1, queues: {}, cursors: {} };
}

export interface PersistentSyncStoreOptions {
  filePath: string;
  /** Applies a pulled change to the local stores (resolving against the local copy
   *  via the shared resolveSync) and reports the outcome. */
  applyLocal: (change: SyncChange) => Promise<MergeOutcome>;
  idFactory?: () => string;
}

export interface PersistentSyncStore extends SyncStore {
  load(): Promise<void>;
  enqueue(orgId: string, change: SyncChange): Promise<QueuedChange>;
  pendingCount(orgId: string): number;
  /** Synchronous read of the in-memory queue, for status projections. */
  pendingSnapshot(orgId: string): QueuedChange[];
}

export function createPersistentSyncStore(opts: PersistentSyncStoreOptions): PersistentSyncStore {
  const newId = opts.idFactory ?? ((): string => randomUUID());
  let data = emptyData();
  let loaded = false;

  async function persist(): Promise<void> {
    const tmp = `${opts.filePath}.tmp`;
    await fs.mkdir(dirname(opts.filePath), { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(data), { mode: 0o600 });
    await fs.rename(tmp, opts.filePath);
  }

  async function ensureLoaded(): Promise<void> {
    if (loaded) return;
    try {
      const raw = JSON.parse(await fs.readFile(opts.filePath, 'utf8')) as Partial<SyncFileData>;
      data = { version: 1, queues: raw.queues ?? {}, cursors: raw.cursors ?? {} };
    } catch {
      data = emptyData();
    }
    loaded = true;
  }

  return {
    async load(): Promise<void> {
      await ensureLoaded();
    },

    async enqueue(orgId, change): Promise<QueuedChange> {
      await ensureLoaded();
      const queued: QueuedChange = { queueId: newId(), change };
      (data.queues[orgId] ??= []).push(queued);
      await persist();
      return queued;
    },

    pendingCount(orgId): number {
      return data.queues[orgId]?.length ?? 0;
    },

    pendingSnapshot(orgId): QueuedChange[] {
      return [...(data.queues[orgId] ?? [])];
    },

    async listPending(orgId): Promise<QueuedChange[]> {
      await ensureLoaded();
      return data.queues[orgId] ?? [];
    },

    async removePending(orgId, queueIds): Promise<void> {
      await ensureLoaded();
      const remove = new Set(queueIds);
      data.queues[orgId] = (data.queues[orgId] ?? []).filter((q) => !remove.has(q.queueId));
      await persist();
    },

    async getCursor(orgId): Promise<number> {
      await ensureLoaded();
      return data.cursors[orgId] ?? 0;
    },

    async setCursor(orgId, cursor): Promise<void> {
      await ensureLoaded();
      data.cursors[orgId] = cursor;
      await persist();
    },

    async applyRemote(change): Promise<MergeOutcome> {
      return opts.applyLocal(change);
    },
  };
}
