/**
 * The MemoryStore — persistent organizational memory.
 *
 * Holds two kinds of memory side by side without blurring them: **projected**
 * items derived from the UDM (replaced wholesale on each rebuild via
 * `applyProjected`, preserving their first-seen time) and **explicit** items
 * authored in the app via `remember` (never touched by a rebuild). Every change
 * re-indexes the retriever and persists. `recall` filters by kind / entity /
 * tag / time, then ranks by relevance when given free text.
 *
 * Electron-free: file path and retriever are injected, so it unit-tests on a
 * temp file with a real lexical retriever. The userData singleton lives in
 * memoryInstance.ts.
 */
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import type {
  AuthoredMemoryVisibility,
  MemoryCounts,
  MemoryHit,
  MemoryItem,
  MemoryMeta,
  MemoryRecallQuery,
  MemoryRecallResult,
  MemoryState,
  MemorySyncResult,
  MemoryViewer,
  MemoryWriteInput,
  SemanticOutcome,
} from '@neuropause/shared';
import {
  hashMemoryContent,
  memoryOwnerFor,
  memoryOwnershipOf,
  memoryMaySync,
  memorySyncOrgOf,
  memoryVisibleTo,
  nextMemoryVersion,
  resolveMemorySync,
} from '@neuropause/shared';
import { memoryFieldsFromVersion, memoryVersionPayload, toSyncState } from './memorySyncAdapter';
import { createLogger } from '../logger';
import { envelopeStamp, readStoreFile } from '../storage/storeEnvelope';
import { LexicalMemoryRetriever, type MemoryRetriever } from './memoryRetriever';
import { rankRecallHits } from './memoryRecallRanking';
import { hybridRecall, type SemanticSearchFn } from './memorySemanticRecall';
import type { RetrievalHit } from './memoryHybridSearch';
import { buildRetrievalDiagnostics, semanticSkipReason } from './retrievalDiagnostics';
import { classifySemanticError } from './semanticFailure';
import { declareStoreScope } from '../tenancy/storeScope';

/** P13C ROUND 8 — the structural scope declaration. See tenancy/storeScope.ts. */
declareStoreScope({
  name: 'ai-memory-store',
  scope: 'TENANT',
  persistence: 'file',
  authority: 'ORG_ROLE',
  classification: 'CUSTOMER_DERIVED',
  retention: "No cap. The stale-projection sweep checks memoryVisibleTo before deleting, so it can only reach the sweeping viewer's own items.",
  reason: 'item.owner, stamped from the resolved viewer at remember() and never patchable. Unbound denies.',
});

const log = createLogger('memory-store');

interface MemoryFile {
  /** Phase 9: store schema stamp — absent on legacy files (= v1). */
  schemaVersion?: number;
  items: MemoryItem[];
  lastBuiltAt: string | null;
}

export interface MemoryApplyResult {
  added: number;
  updated: number;
  removed: number;
}

/**
 * The tenant boundary for memory (P13A).
 *
 * A FUNCTION, for the same reason `AppendOnlyScopeSource` is one: the active
 * workspace changes at runtime, so a value captured at construction would be
 * the wrong tenant the moment someone switched. `null` means DENY — never
 * "unfiltered".
 */
export type MemoryViewerSource = () => MemoryViewer | null;

/**
 * A process-wide fallback viewer, for TESTS ONLY.
 *
 * Mirrors `setAmbientAppendOnlyScopeForTests` exactly, including the runtime
 * guard. Dozens of test files construct a `MemoryStore` directly and would
 * otherwise each have to bind one; a per-store binding always wins, `null`
 * still denies, and the setter refuses outside a test runner.
 */
let ambientMemoryViewer: MemoryViewerSource | null = null;

export function setAmbientMemoryViewerForTests(source: MemoryViewerSource | null): void {
  if (process.env.VITEST === undefined && process.env.NODE_ENV !== 'test') {
    throw new Error(
      'setAmbientMemoryViewerForTests is a test-only seam and must not be called at runtime.',
    );
  }
  ambientMemoryViewer = source;
}

export class MemoryStore extends EventEmitter {
  private items = new Map<string, MemoryItem>();
  private readonly retriever: MemoryRetriever;
  private lastBuiltAt: string | null = null;
  private loaded = false;
  private lastPersist: Promise<void> = Promise.resolve();
  private persisting = false;
  private dirty = false;
  /** V8.2: semantic hit source (backend client or local adapter); unset ⇒ lexical-only. */
  private searchSemantic?: SemanticSearchFn;
  /** P13A: the tenant boundary. Unbound DENIES — see `viewerOrDeny`. */
  private viewerSource: MemoryViewerSource | null = null;

  constructor(
    private readonly filePath: string,
    retriever?: MemoryRetriever,
  ) {
    super();
    this.retriever = retriever ?? new LexicalMemoryRetriever();
  }

  /**
   * Bind the tenant boundary. Chainable, matching the record stores.
   *
   * UNBOUND DENIES. A store nobody bound holds every memory and hands back
   * none of them, which fails loudly in a test rather than quietly in
   * production — and is the only safe default for a store that already has
   * items on disk from before ownership existed.
   */
  bindViewer(source: MemoryViewerSource): this {
    this.viewerSource = source;
    return this;
  }

  /** Whether a boundary has been bound. For the migration inventory. */
  hasViewer(): boolean {
    return this.viewerSource !== null;
  }

  /** The active viewer, or `null` meaning DENY. */
  private viewerOrDeny(): MemoryViewer | null {
    const source = this.viewerSource ?? ambientMemoryViewer;
    return source === null ? null : source();
  }

  /**
   * The viewer a WRITE needs. Throws rather than denying quietly.
   *
   * Same asymmetry the append-only store documents: a read that returns
   * nothing is a correct quiet answer, while a write with no owner produces
   * exactly the unowned memory this program exists to make impossible. Phase 3
   * of the program is this method — "if required ownership is unavailable, FAIL
   * CLOSED" — and a throw is the only way to fail closed from a function whose
   * return type is a memory.
   */
  private requireViewer(what: string): MemoryViewer {
    const viewer = this.viewerOrDeny();
    if (viewer === null) {
      throw new Error(
        `Cannot ${what}: no organization and workspace are active, so it would have no owner.`,
      );
    }
    return viewer;
  }

  /**
   * Ownership counts across every memory. Three integers, no memory content.
   *
   * DELIBERATELY UNSCOPED, and it is the only read on this class that is.
   * It answers "how many memories has nobody claimed yet", which is a question
   * about the MIGRATION rather than about anyone's data — and scoping it would
   * make it unable to see the unresolved rows it exists to count, since an
   * unowned memory is in no scope by definition. It returns no ids, no titles
   * and no content, and it is the same contract, unscoped for the same reason,
   * as `AppendOnlyJsonStore.ownershipCounts`.
   */
  ownershipCounts(): { total: number; assigned: number; unresolved: number } {
    let assigned = 0;
    let unresolved = 0;
    for (const item of this.items.values()) {
      if (memoryOwnershipOf(item) === 'assigned') assigned += 1;
      else unresolved += 1;
    }
    return { total: this.items.size, assigned, unresolved };
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    // Phase 9 (certification fix): envelope read — a corrupt memory.json is
    // QUARANTINED beside itself (bytes preserved), never silently treated as
    // first run and overwritten. Closes the audit finding that AI Memory sat
    // outside the Phase 8 quarantine protection.
    const result = await readStoreFile<Partial<MemoryFile>>(this.filePath);
    if (result.state === 'loaded' && result.data) {
      const data = result.data;
      for (const it of data.items ?? []) if (it && it.id) this.items.set(it.id, it);
      this.lastBuiltAt = data.lastBuiltAt ?? null;
    } else if (result.state !== 'first-run') {
      this.quarantinedTo = result.quarantinedTo;
      log.warn('AI memory store quarantined at load', { quarantinedTo: result.quarantinedTo });
    }
    this.reindex();
    this.loaded = true;
    log.info('AI memory ready', { items: this.items.size });
  }

  /** Where a corrupt/newer store file was preserved at load, if any. */
  quarantinedTo: string | null = null;

  private reindex(): void {
    this.retriever.index([...this.items.values()]);
  }

  private async persist(): Promise<void> {
    const file: MemoryFile = { ...envelopeStamp(), items: [...this.items.values()], lastBuiltAt: this.lastBuiltAt };
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(file), { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }

  private schedulePersist(): void {
    this.dirty = true;
    if (this.persisting) return;
    this.persisting = true;
    this.lastPersist = this.drainPersist();
  }

  private async drainPersist(): Promise<void> {
    try {
      while (this.dirty) {
        this.dirty = false;
        await this.persist();
      }
    } catch (err) {
      log.error('Memory persist failed', { error: String(err) });
    } finally {
      this.persisting = false;
    }
  }

  async flush(): Promise<void> {
    while (this.persisting) await this.lastPersist;
  }

  private mutated(at: string | null): void {
    if (at) this.lastBuiltAt = at;
    this.reindex();
    this.schedulePersist();
    this.emit('changed');
  }

  /**
   * Explicitly remember something (a decision, note, captured context).
   *
   * P13A — THE OWNER IS STAMPED HERE, BEFORE PERSISTENCE, AND IT IS NOT THE
   * CALLER'S TO CHOOSE.
   *
   * The pre-P13A signature took `scope: { orgId, deviceId, userId }` from the
   * caller and used `orgId` verbatim as the sync namespace, so any caller could
   * author a memory into any organization by naming it. `orgId` and `userId`
   * are gone from the parameter list: both now come from the resolved viewer.
   * `deviceId` remains, because a device is attribution rather than authority —
   * it decides nothing about who may read the result.
   *
   * `visibility` chooses how widely the memory may be read and defaults to
   * `tenant`, matching the pre-P13A reality that an explicit memory was
   * readable by whoever was using the app. It cannot be `system`: that is
   * excluded at the type level by `AuthoredMemoryVisibility`.
   *
   * Sync stays OPT-IN via `sync`, exactly as it was — a memory only joins
   * append-only cloud sync when a caller asks it to. What changed is that the
   * org it syncs within is now read from the stamped owner, so opting in can no
   * longer choose a destination.
   *
   * Throws when no viewer resolves. There is no path through this method that
   * produces a memory without an owner.
   */
  remember(
    input: MemoryWriteInput,
    now = new Date().toISOString(),
    options?: {
      visibility?: AuthoredMemoryVisibility;
      /** Opt into org-scoped cloud sync. The org comes from the owner, not from here. */
      sync?: { deviceId: string };
    },
  ): MemoryItem {
    const viewer = this.requireViewer('remember this');
    const visibility = options?.visibility ?? 'tenant';
    const owner = memoryOwnerFor(viewer, visibility);
    if (owner === null) {
      /**
       * The only way to get here is a PERSONAL memory requested by a principal
       * with no identity — a background service. Refused rather than downgraded
       * to workspace visibility, because a personal memory silently widened to
       * everyone in the workspace is a disclosure wearing a fallback's clothes.
       */
      throw new Error(
        `Cannot remember this as ${visibility}: the current principal has no personal identity to own it.`,
      );
    }

    const id = `mem:explicit:${randomUUID()}`;
    const item: MemoryItem = {
      id,
      kind: input.kind,
      origin: 'explicit',
      title: input.title,
      content: input.content,
      connectorId: null,
      source: 'manual',
      entityRefs: input.entityRefs ?? [],
      tags: input.tags ?? [],
      occurredAt: input.occurredAt ?? now,
      createdAt: now,
      updatedAt: now,
      evidence: null,
      metadata: input.metadata ?? {},
      owner,
    };

    if (options?.sync) {
      /**
       * `memorySyncOrgOf` returns null for a personal or system owner, so a
       * caller that opts a personal memory into sync gets a local-only memory
       * rather than an egress. The refusal is silent because it is not an
       * error: "personal never syncs" is the rule, not a failed request.
       */
      const orgId = memorySyncOrgOf(owner);
      if (orgId !== null) {
        const payload = memoryVersionPayload(item);
        const version = nextMemoryVersion(null, {
          versionId: randomUUID(),
          memoryId: id,
          orgId,
          timestamp: now,
          deviceId: options.sync.deviceId,
          userId: viewer.userId ?? 'system',
          text: payload.text,
          metadata: payload.metadata,
          deleted: false,
        });
        item.sync = {
          orgId,
          versionId: version.versionId,
          parentVersion: null,
          history: [version],
          deleted: false,
        };
      }
    }

    this.items.set(item.id, item);
    this.mutated(null);
    return item;
  }

  /**
   * Forget items. A local-only item is hard-deleted (unchanged behavior). A
   * synced (org-scoped) item is SOFT-deleted: the delete becomes a new tombstone
   * version, so the deletion propagates across devices and prior versions stay
   * recoverable — a synced item is never physically removed here (that would lose
   * its history). Uses `actor` for attribution, falling back to a local/system
   * actor for programmatic deletes. Returns the number of items affected.
   */
  forget(
    ids: string[],
    now = new Date().toISOString(),
    actor?: { deviceId: string; userId: string },
  ): number {
    let n = 0;
    const who = actor ?? { deviceId: 'local', userId: 'system' };
    for (const id of ids) {
      /**
       * P13A — resolved through `visible`, so a caller holding another
       * tenant's memory id deletes nothing and is told nothing. This also
       * bounds "delete all": every delete-all path in the app collects ids
       * from a scoped read first, and even one that did not would find each
       * out-of-scope id silently skipped here. Delete-all means "delete all
       * the memories I can see", which is the only reading that is safe when
       * one file holds several tenants.
       */
      const item = this.visible(id);
      if (!item) continue;
      if (item.sync) {
        const currentHead =
          item.sync.history.find((v) => v.versionId === item.sync!.versionId) ?? null;
        if (currentHead?.deleted) continue; // already a tombstone — idempotent
        const payload = memoryVersionPayload(item);
        const version = nextMemoryVersion(currentHead, {
          versionId: randomUUID(),
          memoryId: id,
          orgId: item.sync.orgId,
          timestamp: now,
          deviceId: who.deviceId,
          userId: who.userId,
          text: payload.text,
          metadata: payload.metadata,
          deleted: true,
        });
        this.items.set(id, {
          ...item,
          updatedAt: now,
          sync: {
            orgId: item.sync.orgId,
            versionId: version.versionId,
            parentVersion: currentHead?.versionId ?? null,
            history: [...item.sync.history, version],
            deleted: true,
          },
        });
        n++;
      } else if (this.items.delete(id)) {
        n++;
      }
    }
    if (n > 0) this.mutated(null);
    return n;
  }

  /**
   * Apply a remote memory state (from another device) into the local store via the
   * tested resolveMemorySync engine. Never overwrites — concurrent edits are kept
   * in history and the deterministic head becomes current; a memory this device
   * hasn't seen adopts the remote head + history. Returns the merge result, whose
   * `requiredEmbeddings` tells the caller what to re-embed locally. Emits 'changed'
   * so the retriever + UI refresh. NOTE: authoring is not done here — no new
   * version is created; only existing local/remote versions are reconciled.
   */
  applyMerged(remote: MemoryState, now = new Date().toISOString()): MemorySyncResult {
    /**
     * P13A — INBOUND OWNERSHIP VALIDATION. The store's half of the highest
     * severity finding in the previous audit: this method adopted whatever a
     * peer sent, with no check that the sender was entitled to write it.
     *
     * Two separate refusals, and they close different attacks:
     *
     *   1. The payload's org must be the ACTIVE VIEWER's tenant. Without this,
     *      a device signed into tenant B can inject a memory stamped tenant A
     *      and have it land in the shared store file, where A's next recall
     *      would serve it back as A's own memory. That is an injection, not a
     *      leak, and it is the one that survives a restart.
     *
     *   2. A memory that ALREADY EXISTS locally may only be merged by its own
     *      tenant. Otherwise B could take over A's memory id and rewrite its
     *      content through the merge engine — `resolveMemorySync` is designed
     *      to preserve both sides of a concurrent edit, which is exactly the
     *      wrong instinct when one of the sides is an intruder.
     *
     * `null` is not an option here, so a refusal is reported as `ignored` — the
     * same outcome the sync engine already uses for a payload it cannot read,
     * and it deliberately tells the sender nothing about why.
     */
    const viewer = this.viewerOrDeny();
    if (viewer === null || remote.orgId !== viewer.tenantId) {
      return this.rejectedMerge(remote);
    }

    /**
     * The payload's OWN owner must be one this viewer could read.
     *
     * A payload with no owner is refused outright rather than adopted with an
     * inferred one. That refusal is the whole inbound fix: `remote.orgId`
     * alone was never evidence of anything, because the sender chose it.
     * Requiring an owner that independently passes `memoryVisibleTo` means a
     * sender cannot describe a memory into existence anywhere it could not
     * already be read.
     */
    if (!memoryVisibleTo(remote.owner, viewer)) {
      return this.rejectedMerge(remote);
    }

    /**
     * THE INBOUND VISIBILITY MUST BE ONE THAT SYNCS AT ALL.
     *
     * Found by adversarial review, and it defeated everything above it.
     * `memoryVisibleTo` answers "may this viewer READ it", and it answers YES
     * for a SYSTEM memory in every tenant — correctly, because a system memory
     * carries no customer data when the product creates one. But the owner here
     * arrives OFF THE WIRE, so a peer could send `visibility: 'system'` and have
     * it accepted by the read predicate, persisted verbatim, and then served to
     * EVERY tenant on the device, embedded into every org's vector namespace by
     * backfill, and counted in everyone's totals. A full escape.
     *
     * `remember` cannot produce a system memory — `AuthoredMemoryVisibility`
     * excludes it at the type level — but that guarantee only ever covered the
     * authoring path. `applyMerged` is not an authoring path, and it had no
     * equivalent check. The same hole admitted `visibility: 'personal'` aimed at
     * a named colleague's private namespace, since userIds are account emails.
     *
     * `memoryMaySync` is the existing answer to "may this kind of memory travel
     * at all" — tenant and workspace yes, system and personal never. It already
     * governed the OUTBOUND side; applying it inbound makes the two directions
     * agree, which is what they should have done from the start.
     */
    if (!memoryMaySync(remote.owner)) {
      return this.rejectedMerge(remote);
    }

    const local = this.items.get(remote.memoryId);
    if (local && !memoryVisibleTo(local.owner, viewer)) {
      return this.rejectedMerge(remote);
    }

    /**
     * A local memory that exists but never joined sync is NOT adoptable.
     *
     * `toSyncState` returns null for any item without `sync`, which sent an
     * existing local item down the "brand new to this device" branch below —
     * where it is replaced wholesale, bypassing the merge engine that exists to
     * preserve both sides. Projected memory ids are deterministic
     * (`mem:${entityId}`), so a peer could name one and overwrite its content.
     * Refused instead: a memory that has never synced has no remote history to
     * reconcile with, so there is nothing here that is a merge.
     */
    if (local && !local.sync) {
      return this.rejectedMerge(remote);
    }

    const localState = local ? toSyncState(local) : null;

    if (!localState) {
      // New-to-this-device memory (or a local item without sync): adopt the remote
      // head + full history wholesale.
      const head = remote.history.find((v) => v.versionId === remote.head.versionId) ?? remote.head;
      const f = memoryFieldsFromVersion(head);
      const item: MemoryItem = {
        id: remote.memoryId,
        kind: f.kind,
        origin: 'explicit',
        title: f.title,
        content: f.content,
        connectorId: null,
        source: 'manual',
        entityRefs: f.entityRefs,
        tags: f.tags,
        occurredAt: f.occurredAt,
        createdAt: remote.history[0]?.timestamp ?? now,
        updatedAt: head.timestamp,
        evidence: null,
        metadata: f.metadata,
        sync: {
          orgId: remote.orgId,
          versionId: head.versionId,
          parentVersion: head.parentVersion,
          history: remote.history,
          deleted: head.deleted,
        },
        /**
         * Stamped from the VALIDATED payload owner, not re-derived from the
         * viewer. Re-deriving would quietly widen a workspace-scoped memory to
         * the whole tenant whenever it landed on a device whose active
         * workspace differed; the guard above has already proved this owner is
         * one the viewer may read, so carrying it verbatim is both safe and
         * faithful to what the author intended.
         */
        owner: remote.owner,
      };
      this.items.set(item.id, item);
      this.mutated(null);
      return {
        memoryId: remote.memoryId,
        winner: head,
        history: remote.history,
        conflict: false,
        mergeType: 'fast_forward',
        requiredEmbeddings: [head.versionId],
        syncActions: [{ type: 'apply_head', versionId: head.versionId }],
      };
    }

    const result = resolveMemorySync(localState, remote);
    const winner = result.winner;
    const f = memoryFieldsFromVersion(winner);
    const next: MemoryItem = {
      ...local!,
      kind: f.kind,
      title: f.title,
      content: f.content,
      entityRefs: f.entityRefs,
      tags: f.tags,
      occurredAt: f.occurredAt,
      metadata: f.metadata,
      updatedAt: winner.timestamp,
      sync: {
        orgId: local!.sync!.orgId,
        versionId: winner.versionId,
        parentVersion: winner.parentVersion,
        history: result.history,
        deleted: winner.deleted,
      },
    };
    this.items.set(remote.memoryId, next);
    this.mutated(null);
    return result;
  }

  /**
   * The result of an inbound change this device refused to apply.
   *
   * Shaped as a no-op merge whose winner is the payload's own head, so the
   * caller's bookkeeping (the loop guard, the conflict tally) reads it as
   * "nothing happened here" without needing to understand refusal. Critically
   * it requests NO embedding and NO sync action: a refused memory must not be
   * embedded into this device's vector namespace, which would reintroduce the
   * leak through the semantic leg after the store had already denied it.
   *
   * `mergeType: 'identical'` is deliberate. The alternative — inventing a
   * `rejected` merge type — would ripple through the sync engine's exhaustive
   * switches for no gain, and "identical" is true in the only sense the caller
   * acts on: local state is unchanged.
   */
  private rejectedMerge(remote: MemoryState): MemorySyncResult {
    log.warn('Rejected an inbound memory change that failed ownership validation', {
      // The memory id only. Never the content, the sending org or the payload
      // owner — a log line is a place another tenant's identifiers should not
      // come to rest.
      memoryId: remote.memoryId,
    });
    return {
      memoryId: remote.memoryId,
      winner: remote.head,
      history: [],
      conflict: false,
      mergeType: 'identical',
      requiredEmbeddings: [],
      syncActions: [],
      refused: true,
    };
  }

  /**
   * One memory by id, or null when the viewer may not read it.
   *
   * An id is a REFERENCE, NOT AN AUTHORIZATION. Memory ids are uuid-suffixed
   * and therefore unguessable, but unguessable is a property of the id rather
   * than a property of the boundary — and ids leak, through logs, exports and
   * the sync payloads this same store accepts. Indistinguishable from "no such
   * memory" on purpose: a null that meant "exists, not yours" would answer a
   * question the caller is not entitled to ask.
   */
  get(id: string): MemoryItem | null {
    return this.visible(id);
  }

  /** The item behind an id if this viewer may read it, else null. */
  private visible(id: string): MemoryItem | null {
    const item = this.items.get(id);
    if (!item) return null;
    return memoryVisibleTo(item.owner, this.viewerOrDeny()) ? item : null;
  }

  /**
   * Patch an existing item's metadata (and optionally title/content), bumping
   * updatedAt. Re-indexes and persists. Returns the updated item, or null if the
   * id is unknown. Used for executive-memory pin/resolve, which only touch metadata.
   *
   * For an org-scoped (synced) item with an `actor`, a syncable-content change
   * APPENDS a new version — it never overwrites history — so concurrent edits
   * across devices can both survive under resolveMemorySync. A synced edit without
   * an actor patches locally without versioning (see Known limitations).
   */
  update(
    id: string,
    patch: { metadata?: MemoryMeta; title?: string; content?: string },
    now = new Date().toISOString(),
    actor?: { deviceId: string; userId: string },
  ): MemoryItem | null {
    /**
     * P13A — the same `visible` gate as `get` and `forget`. Enforced at the
     * STORE boundary rather than in the handlers above it, because the pin,
     * resolve and status paths in `conversationMemory` all reach this method by
     * different routes and a gate in three of them is a gate in none.
     */
    const item = this.visible(id);
    if (!item) return null;
    const next: MemoryItem = {
      ...item,
      title: patch.title ?? item.title,
      content: patch.content ?? item.content,
      metadata: patch.metadata ? { ...item.metadata, ...patch.metadata } : item.metadata,
      updatedAt: now,
      /**
       * The owner is carried over from the existing item and is NOT patchable —
       * the patch type cannot express it. A memory therefore cannot be moved
       * between tenants by editing it, which is the same guarantee
       * `AppendOnlyJsonStore.mutate` gets by stripping the scope keys.
       */
      owner: item.owner,
    };
    if (item.sync && actor) {
      const currentHead =
        item.sync.history.find((v) => v.versionId === item.sync!.versionId) ?? null;
      const payload = memoryVersionPayload(next);
      const newHash = hashMemoryContent(payload.text, payload.metadata);
      // Only append when the syncable content actually changed — a no-op edit
      // shouldn't bloat history or trigger a needless re-embed.
      if (!currentHead || newHash !== currentHead.contentHash) {
        const version = nextMemoryVersion(currentHead, {
          versionId: randomUUID(),
          memoryId: id,
          orgId: item.sync.orgId,
          timestamp: now,
          deviceId: actor.deviceId,
          userId: actor.userId,
          text: payload.text,
          metadata: payload.metadata,
          deleted: item.sync.deleted,
        });
        next.sync = {
          orgId: item.sync.orgId,
          versionId: version.versionId,
          parentVersion: currentHead?.versionId ?? null,
          history: [...item.sync.history, version],
          deleted: item.sync.deleted,
        };
      }
    }
    this.items.set(id, next);
    this.mutated(null);
    return next;
  }

  /**
   * Replace the projected set FOR THE ACTIVE TENANT; explicit memories are left
   * untouched.
   *
   * P13A changes two things about this method.
   *
   * OWNERSHIP. Projected memories are stamped with the projecting viewer's
   * tenant. A projection has no owner of its own to inherit — it is derived
   * from the unified store, which is not tenant-scoped and is explicitly out of
   * scope for this program — so the honest available answer is "whoever was
   * looking when it was projected". This is a REAL LIMITATION and it is stated
   * plainly rather than papered over: memory is no better isolated than the
   * source it projects from, and the source is still `REQUIRES_MIGRATION` in
   * the inventory. What P13A does buy is that a projection stamped tenant A is
   * never served to tenant B, which is what closes the memory-side exposure.
   *
   * SCOPED REPLACEMENT. The sweep that deletes stale projections used to run
   * over EVERY projected memory in the file. With two tenants that is
   * cross-tenant destruction: A's rebuild would delete B's projected memories,
   * because they were absent from A's projection by construction. It now
   * deletes only projections this viewer can see — the same correction
   * `AppendOnlyJsonStore.append` makes for cap eviction, and for the same
   * reason.
   *
   * Throws when no viewer resolves: a projection with no owner is exactly the
   * unowned memory this program exists to eliminate.
   *
   * KNOWN LIMITATION, stated precisely because adversarial review raised it.
   * Projected ids are deterministic functions of the source entity
   * (`mem:${entityId}`), and the source is shared and unscoped, so two tenants
   * on one device project the SAME ids. `this.items` is keyed by id alone, so
   * the later rebuild re-stamps those rows with its own tenant and the earlier
   * tenant's projections disappear from its view until it rebuilds again.
   *
   * What that is and is not: it is an AVAILABILITY flap between two tenants
   * sharing an install, not a disclosure — both projections are byte-identical
   * derivations of the same unscoped source, so neither tenant learns anything
   * from the other's row that it could not read directly from the unified store
   * today. It is also strictly better than the pre-P13A behaviour, where the
   * delete sweep removed the other tenant's projected memories outright.
   *
   * The real fix is scoping the unified store, which is explicitly a later
   * slice. Tenant-qualifying the id here would paper over that while leaving
   * the underlying entity readable by both tenants anyway.
   */
  applyProjected(projected: MemoryItem[], at: string): MemoryApplyResult {
    const viewer = this.requireViewer('rebuild projected memory');
    const owner = memoryOwnerFor(viewer, 'tenant');
    if (owner === null) throw new Error('Cannot rebuild projected memory: no tenant owner.');

    let added = 0;
    let updated = 0;
    let removed = 0;
    const newIds = new Set(projected.map((p) => p.id));
    for (const p of projected) {
      const owned: MemoryItem = { ...p, owner };
      const prev = this.items.get(p.id);
      if (!prev) {
        this.items.set(p.id, owned);
        added++;
      } else {
        this.items.set(p.id, { ...owned, createdAt: prev.createdAt });
        updated++;
      }
    }
    for (const [id, it] of this.items) {
      if (it.origin !== 'projected' || newIds.has(id)) continue;
      // Only this viewer's stale projections. Another tenant's are not this
      // rebuild's to remove, and a projection that predates P13A has no owner,
      // so it is not visible and not deleted here either — it is inert.
      if (!memoryVisibleTo(it.owner, viewer)) continue;
      this.items.delete(id);
      removed++;
    }
    this.mutated(at);
    return { added, updated, removed };
  }

  /** Wire a semantic hit source (V8.2). Until called, recallSemantic stays purely lexical. */
  configureSemantic(searchSemantic: SemanticSearchFn): void {
    this.searchSemantic = searchSemantic;
  }

  /**
   * Semantic-aware recall (V8.2; hardened in A6). Same result shape as `recall`,
   * plus the optional `retrieval` envelope saying what the semantic leg actually
   * did — so a hybrid answer and a degraded one stop looking identical.
   *
   * A6 makes this method **total with respect to the semantic leg**: a source that
   * fails, times out, or is short-circuited by its breaker no longer propagates
   * out of here. It degrades to the lexical ranking of the pool that was *already*
   * retrieved; before A6 the failure escaped to `semanticRecallHandler.ts:36`,
   * which called `recall` and re-ran `this.retriever.search` from scratch — a
   * second full lexical pass on every single semantic failure. That handler's
   * try/catch is kept as a genuine backstop for anything that is not the semantic
   * leg (see the rethrow below).
   *
   * P13A — THE VECTOR NAMESPACE IS DERIVED, NOT SUPPLIED.
   *
   * `orgId` used to be the caller's to choose, and it selects which org's
   * vectors are searched. The vector store's own isolation is real (`orgId` is
   * in the key and a hard filter on search), which made this parameter the way
   * to defeat it: name another tenant's org and the isolated store faithfully
   * returns that tenant's neighbours.
   *
   * It now comes from the resolved viewer. The parameter is kept because the
   * IPC handler still passes one, but it is ASSERTED, NOT TRUSTED: a value that
   * disagrees with the viewer's tenant is treated as a forgery and the semantic
   * leg is skipped entirely rather than run against either candidate. Skipping
   * (rather than silently substituting the correct org) means the mismatch is
   * visible in the diagnostics as `no_org` instead of being papered over.
   *
   * The lexical leg still runs, so the answer degrades rather than failing —
   * and every hit it returns has passed `filterFor`, so a forged org yields the
   * caller's own memories, never the named tenant's.
   */
  async recallSemantic(q: MemoryRecallQuery, orgId?: string): Promise<MemoryRecallResult> {
    const text = q.text?.trim() ?? '';
    const source = this.searchSemantic;
    const viewer = this.viewerOrDeny();
    const authoritativeOrg =
      viewer === null || (orgId !== undefined && orgId !== viewer.tenantId)
        ? undefined
        : viewer.tenantId;
    const skip = semanticSkipReason({
      hasSource: Boolean(source),
      orgId: authoritativeOrg,
      text,
    });

    if (skip !== null || source === undefined || authoritativeOrg === undefined) {
      // `skip` is already non-null whenever either of the other two conditions
      // holds; they are repeated only to narrow the types for the compiler, not
      // to express a second opinion about when semantic runs.
      const lexical = this.lexicalRecall(q);
      return {
        hits: lexical.hits,
        total: lexical.hits.length,
        retriever: this.retriever.name,
        retrieval: buildRetrievalDiagnostics(
          { state: 'skipped', reason: skip ?? 'not_configured' },
          lexical.candidates,
        ),
      };
    }

    const limit = q.limit ?? 25;
    const passes = this.filterFor(q);
    const getItem = this.itemResolver(passes);
    const lexicalHits = this.lexicalPool(text, limit, passes);
    const startedAt = Date.now();
    let reported: SemanticOutcome | undefined;

    try {
      const hits = await hybridRecall(
        { searchSemantic: source },
        {
          text,
          // The viewer's tenant, never the caller's argument. This is the value
          // that reaches the vector store's namespace filter.
          orgId: authoritativeOrg,
          limit,
          lexicalHits,
          getItem,
          onSemanticOutcome: (outcome) => {
            reported = outcome;
          },
        },
      );
      const outcome = reported;
      return {
        hits,
        total: hits.length,
        // Only claim the semantic retriever when the semantic leg actually served.
        retriever:
          outcome?.state === 'ok' ? `${this.retriever.name}+semantic` : this.retriever.name,
        // Absent rather than invented if the source broke the report-once contract:
        // `retrieval` is optional precisely so "no diagnostics" stays sayable.
        ...(outcome ? { retrieval: buildRetrievalDiagnostics(outcome, lexicalHits.length) } : {}),
      };
    } catch (err) {
      // Only the semantic leg is absorbed here. If the source already reported
      // success then the throw came from ranking — a defect, not a degradation —
      // and it belongs to the handler's backstop rather than to this fallback.
      const outcome = reported;
      if (outcome?.state === 'ok') throw err;

      const ranked = rankRecallHits({ query: { limit }, lexicalHits, getItem });
      return {
        hits: ranked,
        total: ranked.length,
        retriever: this.retriever.name,
        retrieval: buildRetrievalDiagnostics(
          // Prefer the source's own verdict: it measured the latency and knows the
          // cause. Classify here only when the source threw without reporting.
          outcome ?? classifySemanticError(err, Date.now() - startedAt),
          lexicalHits.length,
        ),
      };
    }
  }

  recall(q: MemoryRecallQuery): MemoryRecallResult {
    const { hits } = this.lexicalRecall(q);
    return { hits, total: hits.length, retriever: this.retriever.name };
  }

  /**
   * The lexical half of recall, plus the size of the candidate pool it ranked.
   * `recall` and `recallSemantic`'s degraded path both go through it, so the two
   * can never drift apart and a degradation costs no extra retrieval work (A6).
   */
  private lexicalRecall(q: MemoryRecallQuery): { hits: MemoryHit[]; candidates: number } {
    const passes = this.filterFor(q);
    const limit = q.limit ?? 25;
    const text = q.text?.trim();

    if (text) {
      // Retrieve a wide lexical pool, then re-rank via the hybrid ranking engine
      // (V6.7.0) so recency / importance / pinned influence order — not raw TF-IDF
      // alone. Filters live in the getItem closure, preserving recall's existing
      // kind / entity / tag / time / tombstone semantics.
      const lexicalHits = this.lexicalPool(text, limit, passes);
      return {
        hits: rankRecallHits({ query: { limit }, lexicalHits, getItem: this.itemResolver(passes) }),
        candidates: lexicalHits.length,
      };
    }

    const pool = [...this.items.values()].filter(passes);
    pool.sort((a, b) => {
      const ta = a.occurredAt ?? a.createdAt;
      const tb = b.occurredAt ?? b.createdAt;
      return ta < tb ? 1 : ta > tb ? -1 : 0;
    });
    return {
      hits: pool.slice(0, limit).map((item) => ({ item, score: 1 })),
      candidates: pool.length,
    };
  }

  /**
   * Recall's OWNERSHIP + kind / entity / tag / time / tombstone filter.
   *
   * THE SINGLE HIGHEST-LEVERAGE ENFORCEMENT POINT IN MEMORY (P13A).
   *
   * Four retrieval paths reach it and none of them can go round it:
   *
   *   `recall`          → `lexicalRecall` → filterFor
   *   `lexicalRecall`   → both the text branch (via `itemResolver`) and the
   *                       browse branch (via `pool.filter`)
   *   `recallSemantic`  → `itemResolver(filterFor(q))`, which is the `getItem`
   *                       that `hybridRecall` resolves EVERY candidate through
   *                       — lexical, semantic, and the union of the two
   *   degraded fallback → the same `getItem`, deliberately reused rather than
   *                       rebuilt, so a degradation cannot be a widening
   *
   * That last one is the reason the semantic leg needs no ownership filter of
   * its own. The vector store is already org-isolated, but the MERGE is where
   * a hit becomes a result, and the merge resolves through here. A memory the
   * viewer may not read is dropped at resolution whichever leg found it, which
   * is what closes the lexical-union hole the previous audit identified: the
   * isolated half was being defeated by a union with an unisolated half.
   *
   * The ownership check runs FIRST and reads the viewer ONCE per query rather
   * than once per item — a query is a single point in time and a boundary that
   * could move mid-scan would be a boundary that could be raced.
   */
  private filterFor(q: MemoryRecallQuery): (it: MemoryItem) => boolean {
    const viewer = this.viewerOrDeny();
    const kinds = q.kinds && q.kinds.length > 0 ? new Set(q.kinds) : null;
    const since = q.since ? Date.parse(q.since) : null;
    const until = q.until ? Date.parse(q.until) : null;

    return (it: MemoryItem): boolean => {
      // Ownership before everything. A memory this viewer may not read is not a
      // memory that failed a filter — it is a memory that does not exist for
      // them, and no later clause can reinstate it.
      if (!memoryVisibleTo(it.owner, viewer)) return false;
      if (it.sync?.deleted) return false; // tombstoned — excluded from recall
      if (kinds && !kinds.has(it.kind)) return false;
      if (q.entityRef && !it.entityRefs.includes(q.entityRef)) return false;
      if (q.tag && !it.tags.includes(q.tag)) return false;
      if (since !== null || until !== null) {
        const ts = Date.parse(it.occurredAt ?? it.createdAt);
        if (since !== null && ts < since) return false;
        if (until !== null && ts > until) return false;
      }
      return true;
    };
  }

  /**
   * The wide lexical candidate pool for a text query, in the ranker's input shape.
   *
   * FILTERED HERE, NOT ONLY AT RESOLUTION.
   *
   * The retriever is indexed over every memory in the file — `reindex()` cannot
   * know who is asking — so its raw output spans tenants. Resolution through
   * `itemResolver` already drops what the viewer may not read, so no foreign
   * ITEM ever escaped. The COUNT did: `lexicalCandidates` and the browse pool
   * size were reported from this unfiltered list, and that number is returned to
   * the renderer on `memory:semantic-recall`.
   *
   * That made it a cross-tenant content oracle. A tenant querying a guessed term
   * and seeing `hits: []` with `lexicalCandidates > 0` learns the term appears in
   * another tenant's memory on this install — one word at a time, without ever
   * receiving a memory. Found by adversarial review; the browse branch of
   * `lexicalRecall` already counted its pool AFTER filtering, and the mismatch
   * between the two branches is what showed it was an oversight rather than a
   * decision.
   *
   * Filtering at the source rather than at the reporting site also means every
   * future consumer of this pool inherits the boundary instead of having to
   * remember it.
   */
  private lexicalPool(text: string, limit: number, passes: (it: MemoryItem) => boolean): RetrievalHit[] {
    return this.retriever
      .search(text, Math.max(limit * 3, 50))
      .filter((s) => {
        const it = this.items.get(s.id);
        return it !== undefined && passes(it);
      })
      .map((s) => ({ memoryId: s.id, score: s.score }));
  }

  /** Resolve a memoryId to its item, preserving recall's filter semantics. */
  private itemResolver(
    passes: (it: MemoryItem) => boolean,
  ): (memoryId: string) => MemoryItem | undefined {
    return (memoryId: string): MemoryItem | undefined => {
      const it = this.items.get(memoryId);
      return it && passes(it) ? it : undefined;
    };
  }

  /**
   * Counts for THIS VIEWER only.
   *
   * A count is a disclosure. An install-wide total answers "does the other
   * tenant have memories, and roughly how many, and of what kinds" without
   * returning a single one of them — and this number is rendered in the UI, so
   * it would answer that question continuously. Same reasoning as
   * `AppendOnlyJsonStore.count`, applied to a richer shape: `byKind` and
   * `byOrigin` are each a histogram of another tenant's activity.
   *
   * `lastBuiltAt` is a property of the local projection run rather than of any
   * tenant's data, so it is unchanged.
   */
  counts(): MemoryCounts {
    const viewer = this.viewerOrDeny();
    const byKind: Record<string, number> = {};
    const byOrigin: Record<string, number> = {};
    let total = 0;
    for (const it of this.items.values()) {
      if (!memoryVisibleTo(it.owner, viewer)) continue;
      if (it.sync?.deleted) continue; // tombstoned — excluded from counts
      total++;
      byKind[it.kind] = (byKind[it.kind] ?? 0) + 1;
      byOrigin[it.origin] = (byOrigin[it.origin] ?? 0) + 1;
    }
    return { total, byKind, byOrigin, lastBuiltAt: this.lastBuiltAt };
  }

  /**
   * Items participating in org-scoped sync, for the ACTIVE TENANT ONLY,
   * including tombstoned ones — deletions must propagate.
   *
   * THIS METHOD WAS THE EGRESS. It returned every synced memory in the file
   * regardless of owner, and its one caller — the LiveSync bridge — then
   * enqueued each of them under whichever organization happened to be active.
   * Tenant A's memories were uploaded to tenant B's cloud namespace by a device
   * merely being signed into B at the time. Scoping the read here fixes it at
   * the source; the bridge additionally enqueues under each memory's OWN org
   * rather than the active one, so neither half relies on the other being
   * correct.
   *
   * Returns `[]` when no viewer resolves, so a device that has not finished
   * resolving its tenant uploads nothing rather than everything.
   */
  syncedItems(): MemoryItem[] {
    const viewer = this.viewerOrDeny();
    return [...this.items.values()].filter(
      (it) => it.sync && memoryVisibleTo(it.owner, viewer),
    );
  }

  /**
   * All non-tombstoned memories THIS VIEWER MAY READ — the backfill source (V8.2).
   *
   * Scoped because backfill is egress: it feeds `backendBackfill(orgId, …)`,
   * which embeds each memory into a cloud vector namespace. Unscoped, it sent
   * every tenant's memory text into the active tenant's namespace — the same
   * shape of bug as the sync bridge, on a different pipe, and it would have
   * survived the bridge being fixed.
   */
  allItems(): MemoryItem[] {
    const viewer = this.viewerOrDeny();
    return [...this.items.values()].filter(
      (it) => !it.sync?.deleted && memoryVisibleTo(it.owner, viewer),
    );
  }
}
