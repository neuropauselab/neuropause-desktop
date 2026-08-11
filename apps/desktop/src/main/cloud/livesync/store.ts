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
 *
 * P13C ROUND 9 — F17 / F3. ONE FILE, EVERY ORGANIZATION'S PENDING MUTATIONS.
 *
 * This is a single JSON file under userData holding the outbound record mutations
 * of EVERY organization signed in on the machine, and until this round it
 * declared nothing and enforced nothing:
 *
 *   - It was invisible to the structural scope gate. That gate detects
 *     persistence and then demands a declaration, but its retained-state probe
 *     looks for a `private` class field; this store's state is a `let data` in a
 *     factory closure, so it matched no convention and was never asked.
 *   - The OWNER of a row was whatever `orgId` the caller passed. `enqueue`,
 *     `listPending`, `removePending`, `getCursor` and `setCursor` all took the
 *     organization as an ARGUMENT, so any caller who could name an id could read
 *     another organization's queued record mutations, delete them, or rewind its
 *     pull cursor.
 *   - There was no cap at all, so the queue was unbounded.
 *
 * WHAT CHANGED
 *
 * The owner is now stamped AT WRITE TIME from this store's own seam
 * (`TenantOwnership`), never from a caller argument. The `orgId` parameters
 * survive because the engine's `SyncStore` port is written in terms of them, but
 * they are now a CLAIM that is checked against the seam rather than an
 * instruction: reads of another organization return empty, writes throw, and a
 * pulled change for another organization is refused. Rows carry their owner, so
 * the bucket key and the stamp must AGREE for a row to be visible — a file edited
 * by hand cannot move a row between organizations.
 *
 * ROWS WRITTEN BEFORE THIS ROUND ARE UNRESOLVED AND VISIBLE TO NOBODY. They are
 * deliberately not adopted into the bucket they were filed under: adopting them
 * would be inferring an owner, which is the thing this file no longer does. They
 * are inert — never read, never pushed, never counted against a cap, and never
 * deletable by a caller who guesses a queue id.
 */
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import type { MergeOutcome, SyncChange, TenantScope } from '@neuropause/shared';
import { declareStoreScope } from '../../tenancy/storeScope';
import { TenantOwnership } from '../../tenancy/tenantOwnedStore';
import type { QueuedChange, SyncStore } from './types';

/**
 * Every live queue's seam, so the startup gate can see whether the binding
 * happened. A `Set` of seams rather than a boolean because this is a factory:
 * production builds one, tests build many, and a captured boolean would report
 * the first one forever.
 */
const seams = new Set<TenantOwnership>();

/**
 * P13C ROUND 9 — F17. THE STRUCTURAL SCOPE DECLARATION.
 *
 * CUSTOMER_DERIVED is not a judgement call here: a queued row is a customer's
 * record mutation, entity id and payload included, waiting to be pushed. That
 * classification is what makes the two global scopes unavailable — the gate
 * throws — and it is the honest answer, so nothing had to be argued into it.
 */
declareStoreScope({
  name: 'cloud-livesync-queue',
  scope: 'TENANT',
  persistence: 'file',
  authority: 'ORG_ROLE',
  classification: 'CUSTOMER_DERIVED',
  /**
   * P13C ROUND 10 — the checkable form of the prose below.
   *
   * SYSTEM rather than OWNER: neither removal has a user-facing surface. The cap
   * is automatic on enqueue, and `removePending` is driven by the sync engine
   * when the SERVER ACKNOWLEDGES a push — nobody presses a button to delete a
   * queued mutation. Both are still confined to the caller's own rows.
   */
  retentionScope: 'OWNER',
  retentionAuthority: 'SYSTEM',
  retention:
    'Per OWNER cap (maxPendingPerOrg, default 5000), oldest-first, applied only to rows stamped ' +
    "with the writing organization — one organization's backlog can never evict another's. Rows " +
    'leave normally when the server acknowledges them (`removePending`, which also only reaches ' +
    "the caller's own rows). Pre-round-9 rows carry no owner: invisible, never pruned, never pushed.",
  reason:
    'Every row is one organization\'s pending record mutation — entity type, entity id and payload. ' +
    'The owner is stamped from the seam at enqueue time and every read, removal and cursor ' +
    'operation is filtered by it, so the single shared file behaves as one queue per organization.',
  isBound: () => [...seams].every((s) => s.hasScope()),
});

/** A queued row as PERSISTED: the change plus the owner stamped at write time. */
interface OwnedQueuedChange extends QueuedChange {
  /** Absent ⇒ written before P13C Round 9 ⇒ unresolved ⇒ visible to nobody. */
  tenantId?: string | null;
}

interface SyncFileData {
  version: 1;
  queues: Record<string, OwnedQueuedChange[]>;
  cursors: Record<string, number>;
}

function emptyData(): SyncFileData {
  return { version: 1, queues: {}, cursors: {} };
}

/**
 * Per-ORGANIZATION cap on the durable outbound queue.
 *
 * Deliberately generous: the queue drains on every cycle, so reaching this means
 * the device has been offline for a long time or the backend is refusing pushes.
 * The number matters far less than whose rows it can reach, which is only ever
 * the organization that is writing.
 */
const DEFAULT_MAX_PENDING_PER_ORG = 5_000;

export interface PersistentSyncStoreOptions {
  filePath: string;
  /** Applies a pulled change to the local stores (resolving against the local copy
   *  via the shared resolveSync) and reports the outcome. */
  applyLocal: (change: SyncChange) => Promise<MergeOutcome>;
  idFactory?: () => string;
  /** Per-owner queue cap. See DEFAULT_MAX_PENDING_PER_ORG. */
  maxPendingPerOrg?: number;
}

export interface PersistentSyncStore extends SyncStore {
  /** Bind the tenant boundary. UNBOUND DENIES. Chainable. */
  bindScope(source: () => TenantScope | null): PersistentSyncStore;
  hasScope(): boolean;
  load(): Promise<void>;
  enqueue(orgId: string, change: SyncChange): Promise<QueuedChange>;
  pendingCount(orgId: string): number;
  /** Synchronous read of the in-memory queue, for status projections. */
  pendingSnapshot(orgId: string): QueuedChange[];
}

export function createPersistentSyncStore(opts: PersistentSyncStoreOptions): PersistentSyncStore {
  const newId = opts.idFactory ?? ((): string => randomUUID());
  const maxPending = opts.maxPendingPerOrg ?? DEFAULT_MAX_PENDING_PER_ORG;
  const tenancy = new TenantOwnership('cloud-livesync-queue');
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
      const raw = JSON.parse(await fs.readFile(opts.filePath, 'utf8')) as Partial<SyncFileData>;
      data = { version: 1, queues: raw.queues ?? {}, cursors: raw.cursors ?? {} };
    } catch {
      data = emptyData();
    }
    loaded = true;
  }

  /** The caller's own organization, or null. Null means DENY, never "everything". */
  function owner(): string | null {
    const scope = tenancy.scopeOrDeny();
    return scope !== null && scope.tenantId ? scope.tenantId : null;
  }

  /**
   * The owner, but only when the caller's CLAIM names it. Null denies.
   *
   * The claim is the `orgId` argument the `SyncStore` port carries. It selects
   * among the caller's own queues — of which there is exactly one — and can
   * never widen the answer.
   */
  function claimed(orgId: string): string | null {
    const own = owner();
    return own !== null && own === orgId ? own : null;
  }

  /** A refusal for a write. Writes throw where reads return empty. */
  function refuseWrite(orgId: string): never {
    throw new Error(
      `A live-sync queue write for "${orgId}" is not the active organization's to make.`,
    );
  }

  /** The caller's OWN rows in their own bucket: bucket key and stamp must agree. */
  function myRows(own: string): OwnedQueuedChange[] {
    return tenancy.onlyMine(data.queues[own] ?? []);
  }

  return {
    bindScope(source): PersistentSyncStore {
      tenancy.bindScope(source);
      return this;
    },

    hasScope(): boolean {
      return tenancy.hasScope();
    },

    async load(): Promise<void> {
      await ensureLoaded();
    },

    async enqueue(orgId, change): Promise<QueuedChange> {
      await ensureLoaded();
      // `requireTenant` throws when no organization is active: a queued mutation
      // with no owner would be invisible to everyone while still occupying the
      // file and, worse, still being eligible for push.
      const own = tenancy.requireTenant();
      if (orgId !== own) refuseWrite(orgId);
      /**
       * THE CHANGE MUST ALSO BELONG TO THE WRITER.
       *
       * `SyncChange.orgId` travels with the payload and decides where the mirror
       * files it. A row whose change names another organization would be pushed
       * on this organization's credentials and applied into that one's
       * namespace, so it is refused here rather than filtered later.
       */
      if (change.orgId !== own) refuseWrite(change.orgId);

      const queued = tenancy.stamp<OwnedQueuedChange>({ queueId: newId(), change });
      const bucket = [...(data.queues[own] ?? []), queued];
      /**
       * THE CAP IS PER OWNER, and `pruneOwn` is the reason it can be stated that
       * flatly: it sorts and evicts only rows stamped with the caller's own
       * tenant, so an organization that floods the queue chooses which of ITS
       * OWN oldest mutations is dropped and can reach nobody else's.
       */
      data.queues[own] = tenancy.pruneOwn(bucket, maxPending, (a, b) =>
        a.change.updatedAt.localeCompare(b.change.updatedAt),
      );
      await persist();
      return { queueId: queued.queueId, change: queued.change };
    },

    pendingCount(orgId): number {
      const own = claimed(orgId);
      return own === null ? 0 : myRows(own).length;
    },

    pendingSnapshot(orgId): QueuedChange[] {
      const own = claimed(orgId);
      return own === null ? [] : myRows(own).map((q) => ({ queueId: q.queueId, change: q.change }));
    },

    async listPending(orgId): Promise<QueuedChange[]> {
      await ensureLoaded();
      const own = claimed(orgId);
      return own === null ? [] : myRows(own).map((q) => ({ queueId: q.queueId, change: q.change }));
    },

    async removePending(orgId, queueIds): Promise<void> {
      await ensureLoaded();
      const own = claimed(orgId);
      if (own === null) refuseWrite(orgId);
      const remove = new Set(queueIds);
      // `tenancy.mine` before the id test, so a guessed queue id belonging to
      // another organization — or to an unresolved pre-migration row — survives.
      data.queues[own] = (data.queues[own] ?? []).filter(
        (q) => !(tenancy.mine(q) && remove.has(q.queueId)),
      );
      await persist();
    },

    async getCursor(orgId): Promise<number> {
      await ensureLoaded();
      const own = claimed(orgId);
      return own === null ? 0 : (data.cursors[own] ?? 0);
    },

    async setCursor(orgId, cursor): Promise<void> {
      await ensureLoaded();
      const own = claimed(orgId);
      // The cursor is how much of an organization's change feed this device has
      // consumed. Rewinding another organization's would re-pull and re-apply
      // its records, so a mismatched claim is refused rather than ignored.
      if (own === null) refuseWrite(orgId);
      data.cursors[own] = cursor;
      await persist();
    },

    async applyRemote(change): Promise<MergeOutcome> {
      /**
       * The engine already refuses a pulled change that names a different
       * organization than the one it pulled for. This is the same rule at the
       * store's own seam, which is the layer that cannot be bypassed by a future
       * caller of `applyRemote` that skips `runSyncCycle`.
       */
      const own = owner();
      if (own === null || change.orgId !== own) return 'ignored';
      return opts.applyLocal(change);
    },
  };
}
