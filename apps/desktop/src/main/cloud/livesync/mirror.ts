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
 *
 * P13C ROUND 9 — F17 / F3. THE SAME DEFECT AS THE QUEUE, IN THE SAME SUBSYSTEM.
 *
 * This file is the queue's twin: one JSON file under userData holding EVERY
 * organization's synced records, closure state rather than a class field (so the
 * structural gate never asked it to declare a scope), and an organization taken
 * from a caller argument on `get`/`list` and from the REMOTE PAYLOAD on `apply`.
 * A caller who named another organization read its mirrored records; a pulled
 * change that named another organization was filed under it.
 *
 * The owner is now stamped from this store's own seam at write time, the key is
 * built from the OWNER rather than from the payload, and a record is visible only
 * when the key and the stamp agree. Records mirrored before this round carry no
 * owner and are visible to nobody.
 */
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import type {
  MergeOutcome,
  SyncChange,
  SyncEntityType,
  SyncRecord,
  TenantScope,
} from '@neuropause/shared';
import { resolveSync } from '@neuropause/shared';
import { declareStoreScope } from '../../tenancy/storeScope';
import { TenantOwnership } from '../../tenancy/tenantOwnedStore';

/** Every live mirror's seam, so the startup gate can see the binding. */
const seams = new Set<TenantOwnership>();

/** P13C ROUND 9 — the structural scope declaration. See tenancy/storeScope.ts. */
declareStoreScope({
  name: 'cloud-livesync-mirror',
  scope: 'TENANT',
  persistence: 'file',
  authority: 'ORG_ROLE',
  classification: 'CUSTOMER_DERIVED',
  retention:
    'No cap: the mirror holds one row per synced record, so it is bounded by the organization\'s ' +
    'own record count rather than by traffic. Rows are replaced in place by a winning change and ' +
    'removed only by a tombstone for the same (owner, entityType, entityId). No operation here ' +
    "can reach another organization's row. Rows mirrored before Round 9 are unresolved: invisible, " +
    'and superseded in place the first time their organization pulls them again.',
  reason:
    'The mirror holds the synced copy of a customer\'s org-scoped records — settings, connector ' +
    'configuration, org preferences, memory. The owner is stamped from the seam on apply and both ' +
    'the key and the stamp are checked on read, so one file behaves as one mirror per organization.',
  isBound: () => [...seams].every((s) => s.hasScope()),
});

/** A mirrored record as PERSISTED: the record plus the owner stamped on apply. */
interface OwnedSyncRecord extends SyncRecord {
  /** Absent ⇒ mirrored before P13C Round 9 ⇒ unresolved ⇒ visible to nobody. */
  tenantId?: string | null;
}

interface MirrorFileData {
  version: 1;
  records: Record<string, OwnedSyncRecord>;
}

function emptyData(): MirrorFileData {
  return { version: 1, records: {} };
}

const key = (orgId: string, entityType: SyncEntityType, entityId: string): string =>
  `${orgId}|${entityType}|${entityId}`;

export interface LocalSyncMirror {
  /** Bind the tenant boundary. UNBOUND DENIES. Chainable. */
  bindScope(source: () => TenantScope | null): LocalSyncMirror;
  hasScope(): boolean;
  load(): Promise<void>;
  get(orgId: string, entityType: SyncEntityType, entityId: string): SyncRecord | null;
  list(orgId: string, entityType?: SyncEntityType): SyncRecord[];
  /** Apply a change (from a pull) against the local copy via resolveSync. */
  apply(change: SyncChange): Promise<MergeOutcome>;
}

export function createLocalSyncMirror(opts: { filePath: string }): LocalSyncMirror {
  const tenancy = new TenantOwnership('cloud-livesync-mirror');
  seams.add(tenancy);
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

  /** The caller's own organization, or null. Null means DENY. */
  function owner(): string | null {
    const scope = tenancy.scopeOrDeny();
    return scope !== null && scope.tenantId ? scope.tenantId : null;
  }

  /** The owner, but only when the caller's claim names it. Null denies. */
  function claimed(orgId: string): string | null {
    const own = owner();
    return own !== null && own === orgId ? own : null;
  }

  /** Strip the ownership stamp back off, so callers see a plain SyncRecord. */
  function plain(row: OwnedSyncRecord): SyncRecord {
    const { tenantId: _owner, ...record } = row;
    return record;
  }

  return {
    bindScope(source): LocalSyncMirror {
      tenancy.bindScope(source);
      return this;
    },

    hasScope(): boolean {
      return tenancy.hasScope();
    },

    async load(): Promise<void> {
      await ensureLoaded();
    },

    get(orgId, entityType, entityId): SyncRecord | null {
      const own = claimed(orgId);
      if (own === null) return null;
      // The key is built from the OWNER, so a record filed under another
      // organization is not merely filtered out — it is never looked up.
      const row = data.records[key(own, entityType, entityId)];
      return row !== undefined && tenancy.mine(row) ? plain(row) : null;
    },

    list(orgId, entityType): SyncRecord[] {
      const own = claimed(orgId);
      if (own === null) return [];
      return tenancy
        .onlyMine(Object.values(data.records))
        .filter((r) => r.orgId === own && (entityType === undefined || r.entityType === entityType))
        .map(plain);
    },

    async apply(change): Promise<MergeOutcome> {
      await ensureLoaded();
      /**
       * THE PAYLOAD DOES NOT NAME ITS OWN OWNER.
       *
       * `change.orgId` arrives from the backend. Filing by it meant a response
       * served on one organization's pull could write into another's local
       * namespace. The owner is the seam's, and a change that disagrees is
       * IGNORED — the same outcome the merge already uses for "this did not
       * win", so no caller needs a new branch.
       */
      const own = owner();
      if (own === null || change.orgId !== own) return 'ignored';

      const k = key(own, change.entityType, change.entityId);
      const existing = data.records[k];
      // An unresolved legacy row is nobody's, so it cannot be the local copy a
      // merge resolves against: the incoming change replaces it outright.
      const current = existing !== undefined && tenancy.mine(existing) ? plain(existing) : null;
      const { winner, outcome } = resolveSync(current, change);
      if (winner !== current) {
        data.records[k] = tenancy.stamp<OwnedSyncRecord>({ ...winner });
        await persist();
      }
      return outcome;
    },
  };
}
