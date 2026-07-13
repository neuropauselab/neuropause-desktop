/**
 * The Resource Store (P6 — Cloud & Infrastructure Control Plane).
 *
 * Holds the discovered `CloudResource`s and projects them into the pure `ResourceGraphModel` on demand
 * (TTL-cached). It mirrors `unifiedStore`'s upsert/change-detection design — source-authoritative, a
 * re-discovery replaces a resource only when its content actually changed (a content signature, NOT the
 * run-clock `updatedAt`, so an unchanged re-discovery is a no-op and never churns the graph). It is the
 * infrastructure analog of the Unified Store, NOT a duplicate of it: connectors write records to the Unified
 * Store, discovery writes resources here, and both feed the ONE knowledge graph.
 *
 * Electron-free (JSON-file-backed, or fully in-memory when constructed with a null path) so the discovery
 * engine and its tests run under the node vitest gate.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import {
  buildResourceGraph,
  type CloudResource,
  type ResourceGraphModel,
} from '@neuropause/shared';

export interface ResourceUpsertResult {
  created: number;
  updated: number;
  unchanged: number;
  deleted: number;
}

/** Stable content signature — everything meaningful EXCEPT the run-clock timestamps, so an unchanged
 *  re-discovery (which always carries a fresh `updatedAt`) is correctly detected as a no-op. */
function signature(r: CloudResource): string {
  return JSON.stringify([
    r.name, r.domain, r.resourceType, r.region, r.status, r.health,
    r.tags, r.attributes, r.relationships,
  ]);
}

export class ResourceStore extends EventEmitter {
  private resources = new Map<string, CloudResource>();
  private loaded = false;
  private graphCache: { model: ResourceGraphModel; at: number } | null = null;
  /** Graph rebuild is cheap but discovery can upsert in bursts; cache for a short window. */
  private static readonly GRAPH_TTL_MS = 1500;

  constructor(private readonly filePath: string | null) {
    super();
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    if (this.filePath) {
      try {
        const raw = await fs.readFile(this.filePath, 'utf8');
        const list = JSON.parse(raw) as CloudResource[];
        if (Array.isArray(list)) for (const r of list) if (r && r.id) this.resources.set(r.id, r);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          // A corrupt store starts empty rather than crashing discovery.
        }
      }
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    if (!this.filePath) return;
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify([...this.resources.values()]), { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }

  /**
   * Merge a discovered batch (optionally with source deletions). A resource is written only when new or
   * content-changed; an unchanged re-discovery is counted `unchanged` and NOT persisted. Emits `'changed'`
   * with the affected ids when anything changed.
   */
  async upsertMany(incoming: CloudResource[], deletedIds: string[] = [], scope?: { platformId?: string; accountId?: string }): Promise<ResourceUpsertResult> {
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    let deleted = 0;
    const changed: string[] = [];

    for (const next of incoming) {
      const prev = this.resources.get(next.id);
      if (!prev) {
        this.resources.set(next.id, next);
        changed.push(next.id);
        created += 1;
      } else if (signature(next) !== signature(prev)) {
        // Preserve the original createdAt (first-seen), take the rest from the fresh discovery.
        this.resources.set(next.id, { ...next, createdAt: prev.createdAt });
        changed.push(next.id);
        updated += 1;
      } else {
        unchanged += 1;
      }
    }

    for (const id of deletedIds) {
      // Accept either a resolved id or a native id. A native id is resolved WITHIN the discovering scope
      // (platform + account) — two accounts routinely share a native id, so an unscoped `find` would delete
      // the wrong account's resource and miss the intended one. When the scope is absent (a resolved id was
      // passed), an exact-id match is used.
      const resolved = this.resources.has(id)
        ? id
        : [...this.resources.values()].find(
            (r) => r.nativeId === id && (!scope?.platformId || r.platformId === scope.platformId) && (!scope?.accountId || r.accountId === scope.accountId),
          )?.id;
      if (resolved && this.resources.delete(resolved)) {
        changed.push(resolved);
        deleted += 1;
      }
    }

    if (changed.length > 0) {
      this.graphCache = null;
      await this.persist();
      this.emit('changed', { ids: changed });
    }
    return { created, updated, unchanged, deleted };
  }

  /** All resources currently in the store. */
  all(): CloudResource[] {
    return [...this.resources.values()];
  }

  /** Resources filtered by platform and/or account. */
  query(filter?: { platformId?: string; accountId?: string }): CloudResource[] {
    let list = this.all();
    if (filter?.platformId) list = list.filter((r) => r.platformId === filter.platformId);
    if (filter?.accountId) list = list.filter((r) => r.accountId === filter.accountId);
    return list;
  }

  /** How many resources belong to a platform (for the Cloud Platform Center counts). */
  countForPlatform(platformId: string): number {
    let n = 0;
    for (const r of this.resources.values()) if (r.platformId === platformId) n += 1;
    return n;
  }

  /** Build (or return the cached) Resource Graph model for a scope. `nowMs` stamps the model. */
  graph(nowMs: number, filter?: { platformId?: string; accountId?: string }): ResourceGraphModel {
    if (!filter && this.graphCache && nowMs - this.graphCache.at < ResourceStore.GRAPH_TTL_MS) {
      return this.graphCache.model;
    }
    const model = buildResourceGraph({ resources: this.query(filter) }, nowMs);
    if (!filter) this.graphCache = { model, at: nowMs };
    return model;
  }
}
