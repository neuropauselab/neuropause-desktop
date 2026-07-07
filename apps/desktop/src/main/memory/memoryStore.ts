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
  MemoryCounts,
  MemoryItem,
  MemoryMeta,
  MemoryRecallQuery,
  MemoryRecallResult,
  MemoryState,
  MemorySyncResult,
  MemoryWriteInput,
} from '@neuropause/shared';
import { hashMemoryContent, nextMemoryVersion, resolveMemorySync } from '@neuropause/shared';
import { memoryFieldsFromVersion, memoryVersionPayload, toSyncState } from './memorySyncAdapter';
import { createLogger } from '../logger';
import { LexicalMemoryRetriever, type MemoryRetriever } from './memoryRetriever';
import { rankRecallHits } from './memoryRecallRanking';

const log = createLogger('memory-store');

interface MemoryFile {
  items: MemoryItem[];
  lastBuiltAt: string | null;
}

export interface MemoryApplyResult {
  added: number;
  updated: number;
  removed: number;
}

export class MemoryStore extends EventEmitter {
  private items = new Map<string, MemoryItem>();
  private readonly retriever: MemoryRetriever;
  private lastBuiltAt: string | null = null;
  private loaded = false;
  private lastPersist: Promise<void> = Promise.resolve();
  private persisting = false;
  private dirty = false;

  constructor(
    private readonly filePath: string,
    retriever?: MemoryRetriever,
  ) {
    super();
    this.retriever = retriever ?? new LexicalMemoryRetriever();
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const data = JSON.parse(raw) as Partial<MemoryFile>;
      for (const it of data.items ?? []) if (it && it.id) this.items.set(it.id, it);
      this.lastBuiltAt = data.lastBuiltAt ?? null;
    } catch {
      // First run — empty memory.
    }
    this.reindex();
    this.loaded = true;
    log.info('AI memory ready', { items: this.items.size });
  }

  private reindex(): void {
    this.retriever.index([...this.items.values()]);
  }

  private async persist(): Promise<void> {
    const file: MemoryFile = { items: [...this.items.values()], lastBuiltAt: this.lastBuiltAt };
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
   * Explicitly remember something (a decision, note, captured context). When a
   * `scope` is given, the memory is created org-scoped: it gets an initial synced
   * version (seeded via nextMemoryVersion) so it participates in append-only cloud
   * sync. Without a scope it stays local-only (personal), exactly as before.
   */
  remember(
    input: MemoryWriteInput,
    now = new Date().toISOString(),
    scope?: { orgId: string; deviceId: string; userId: string },
  ): MemoryItem {
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
    };
    if (scope) {
      const payload = memoryVersionPayload(item);
      const version = nextMemoryVersion(null, {
        versionId: randomUUID(),
        memoryId: id,
        orgId: scope.orgId,
        timestamp: now,
        deviceId: scope.deviceId,
        userId: scope.userId,
        text: payload.text,
        metadata: payload.metadata,
        deleted: false,
      });
      item.sync = {
        orgId: scope.orgId,
        versionId: version.versionId,
        parentVersion: null,
        history: [version],
        deleted: false,
      };
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
      const item = this.items.get(id);
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
    const local = this.items.get(remote.memoryId);
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

  get(id: string): MemoryItem | null {
    return this.items.get(id) ?? null;
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
    const item = this.items.get(id);
    if (!item) return null;
    const next: MemoryItem = {
      ...item,
      title: patch.title ?? item.title,
      content: patch.content ?? item.content,
      metadata: patch.metadata ? { ...item.metadata, ...patch.metadata } : item.metadata,
      updatedAt: now,
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

  /** Replace the projected set; explicit memories are left untouched. */
  applyProjected(projected: MemoryItem[], at: string): MemoryApplyResult {
    let added = 0;
    let updated = 0;
    let removed = 0;
    const newIds = new Set(projected.map((p) => p.id));
    for (const p of projected) {
      const prev = this.items.get(p.id);
      if (!prev) {
        this.items.set(p.id, p);
        added++;
      } else {
        this.items.set(p.id, { ...p, createdAt: prev.createdAt });
        updated++;
      }
    }
    for (const [id, it] of this.items) {
      if (it.origin === 'projected' && !newIds.has(id)) {
        this.items.delete(id);
        removed++;
      }
    }
    this.mutated(at);
    return { added, updated, removed };
  }

  recall(q: MemoryRecallQuery): MemoryRecallResult {
    const kinds = q.kinds && q.kinds.length > 0 ? new Set(q.kinds) : null;
    const since = q.since ? Date.parse(q.since) : null;
    const until = q.until ? Date.parse(q.until) : null;

    const passes = (it: MemoryItem): boolean => {
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

    const limit = q.limit ?? 25;
    const text = q.text?.trim();
    const hits: MemoryRecallResult['hits'] = [];

    if (text) {
      // Retrieve a wide lexical pool, then re-rank via the hybrid ranking engine
      // (V6.7.0) so recency / importance / pinned influence order — not raw TF-IDF
      // alone. Filters live in the getItem closure, preserving recall's existing
      // kind / entity / tag / time / tombstone semantics. Semantic (vector) hits are
      // omitted until Qdrant is wired (V6.9); the ranker treats them as absent.
      const scored = this.retriever.search(text, Math.max(limit * 3, 50));
      const ranked = rankRecallHits({
        query: { limit },
        lexicalHits: scored.map((s) => ({ memoryId: s.id, score: s.score })),
        getItem: (id) => {
          const it = this.items.get(id);
          return it && passes(it) ? it : undefined;
        },
      });
      for (const hit of ranked) hits.push(hit);
    } else {
      const pool = [...this.items.values()].filter(passes);
      pool.sort((a, b) => {
        const ta = a.occurredAt ?? a.createdAt;
        const tb = b.occurredAt ?? b.createdAt;
        return ta < tb ? 1 : ta > tb ? -1 : 0;
      });
      for (const item of pool.slice(0, limit)) hits.push({ item, score: 1 });
    }

    return { hits, total: hits.length, retriever: this.retriever.name };
  }

  counts(): MemoryCounts {
    const byKind: Record<string, number> = {};
    const byOrigin: Record<string, number> = {};
    let total = 0;
    for (const it of this.items.values()) {
      if (it.sync?.deleted) continue; // tombstoned — excluded from counts
      total++;
      byKind[it.kind] = (byKind[it.kind] ?? 0) + 1;
      byOrigin[it.origin] = (byOrigin[it.origin] ?? 0) + 1;
    }
    return { total, byKind, byOrigin, lastBuiltAt: this.lastBuiltAt };
  }

  /**
   * All items participating in org-scoped sync (those carrying `sync` fields),
   * including tombstoned ones — deletions must propagate. The LiveSync bridge reads
   * this on 'changed' to know what to enqueue, since 'changed' carries no payload.
   */
  syncedItems(): MemoryItem[] {
    return [...this.items.values()].filter((it) => it.sync);
  }
}
