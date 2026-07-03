/**
 * The local mirror of synced org-scoped records — the landing zone for changes
 * pulled from the cloud. It holds a local copy of each synced record keyed by
 * (org, entityType, entityId) and applies an incoming change with the shared
 * `resolveSync` (last-write-wins), writing only when the incoming change wins. It is
 * persisted atomically so the local copy survives restarts.
 *
 * This is the local-first store for the six syncable types. For org_prefs (which had
 * no prior local store) the mirror *is* the store; for types that also have a
 * dedicated store (e.g. workspace settings), reconciling the mirror with that store
 * so the UI reads synced values is a separate integration — the mirror itself
 * persists and conflict-resolves every synced record correctly today.
 */
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import type { MergeOutcome, SyncChange, SyncEntityType, SyncRecord } from '@neuropause/shared';
import { resolveSync } from '@neuropause/shared';

interface MirrorFileData {
  version: 1;
  records: Record<string, SyncRecord>;
}

function emptyData(): MirrorFileData {
  return { version: 1, records: {} };
}

const key = (orgId: string, entityType: SyncEntityType, entityId: string): string =>
  `${orgId}|${entityType}|${entityId}`;

export interface LocalSyncMirror {
  load(): Promise<void>;
  get(orgId: string, entityType: SyncEntityType, entityId: string): SyncRecord | null;
  list(orgId: string, entityType?: SyncEntityType): SyncRecord[];
  /** Apply a change (from a pull) against the local copy via resolveSync. */
  apply(change: SyncChange): Promise<MergeOutcome>;
}

export function createLocalSyncMirror(opts: { filePath: string }): LocalSyncMirror {
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
      const raw = JSON.parse(await fs.readFile(opts.filePath, 'utf8')) as Partial<MirrorFileData>;
      data = { version: 1, records: raw.records ?? {} };
    } catch {
      data = emptyData();
    }
    loaded = true;
  }

  return {
    async load(): Promise<void> {
      await ensureLoaded();
    },

    get(orgId, entityType, entityId): SyncRecord | null {
      return data.records[key(orgId, entityType, entityId)] ?? null;
    },

    list(orgId, entityType): SyncRecord[] {
      return Object.values(data.records).filter(
        (r) => r.orgId === orgId && (entityType === undefined || r.entityType === entityType),
      );
    },

    async apply(change): Promise<MergeOutcome> {
      await ensureLoaded();
      const k = key(change.orgId, change.entityType, change.entityId);
      const current = data.records[k] ?? null;
      const { winner, outcome } = resolveSync(current, change);
      if (winner !== current) {
        data.records[k] = winner;
        await persist();
      }
      return outcome;
    },
  };
}
