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
import type { TenantScope } from '@neuropause/shared';
import { TenantOwnership } from '../tenancy/tenantOwnedStore';
import { TenantMemo } from '../tenancy/tenantMemo';
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import {
  buildResourceGraph,
  type CloudResource,
  type InfraSearchHit,
  type InfraSearchResult,
  type ResourceGraphModel,
} from '@neuropause/shared';

/** Does `q` (already lowercased) match this resource? Returns the matched field name, or null. Scans the
 *  human-meaningful fields — name, native id, type, region, tag keys/values, and string attribute values. */
function matchResource(r: CloudResource, q: string): string | null {
  // Null-guarded: a corrupt / legacy persisted record (loaded with only an `id` check) must degrade to
  // "no match" for that one resource, never throw and fail the whole search.
  if ((r.name ?? '').toLowerCase().includes(q)) return 'name';
  if ((r.nativeId ?? '').toLowerCase().includes(q)) return 'nativeId';
  if ((r.resourceType ?? '').toLowerCase().includes(q)) return 'resourceType';
  if (r.region && r.region.toLowerCase().includes(q)) return 'region';
  for (const [k, v] of Object.entries(r.tags ?? {})) {
    if (k.toLowerCase().includes(q) || String(v).toLowerCase().includes(q)) return `tag:${k}`;
  }
  for (const [k, v] of Object.entries(r.attributes ?? {})) {
    if (v != null && String(v).toLowerCase().includes(q)) return `attr:${k}`;
  }
  return null;
}

function toSearchHit(r: CloudResource, matchedOn: string): InfraSearchHit {
  return {
    resourceId: r.id,
    platformId: r.platformId,
    provider: r.provider,
    accountId: r.accountId,
    domain: r.domain,
    resourceType: r.resourceType,
    nativeId: r.nativeId,
    name: r.name ?? '',
    region: r.region,
    status: r.status,
    health: r.health,
    matchedOn,
  };
}

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

/** Which resources moved in the write that just landed. */
export interface ResourceChangedEvent {
  ids: string[];
}

/**
 * A7 — `changed` was `any`, and the infrastructure subsystem forwards it to the
 * renderer as `{ kind: 'resources', ...e }`. Spreading an `any` collapses the whole
 * literal to `any`, so even the `kind` discriminant written down right there was
 * unchecked. Declaring the payload restores the literal's type.
 */
/** Graph rebuild is cheap but discovery can upsert in bursts; cache for a short window. */
const GRAPH_TTL_MS = 1500;

export class ResourceStore extends EventEmitter<{ changed: [ResourceChangedEvent] }> {
  /**
   * P13C ROUND 7 — THE SUBSYSTEM THAT NEVER HAD A TENANT DIMENSION.
   *
   * Fifty-four source files under `infrastructure/`, and not one reference to
   * `activeTenantScope`, `TenantOwnership`, `bindScope` or `tenantId`. It was not
   * a store with a broken boundary — it was a subsystem that had never been asked
   * the question, which is why six rounds of sweeping past it found nothing: every
   * sweep looked for a seam that was WRONG, and there was no seam at all.
   *
   * It is absent from `migrationInventory.ts` and from the tenant-store registry,
   * so `assertAllTenantStoresBound()` could not see it either. A gate that lists
   * the stores it knows about cannot report the one nobody registered.
   *
   * WHAT WAS EXPOSED: `InfraSearch`, `InfraResourceGraph` and `InfraStats` on
   * `connectors:read` returned every tenant's discovered cloud inventory —
   * resource names, tags, attribute values, account ids, regions, health. And the
   * same unscoped graph was fed into three TENANT-SCOPED read models (knowledge
   * graph, enterprise intelligence, insight), where it was stamped with the
   * reading tenant's id and became indistinguishable from their own. Those three
   * sinks passed every isolation test, because the sinks were correct.
   */
  private readonly tenancy = new TenantOwnership('infrastructure-resources');

  /** Bind the tenant boundary. UNBOUND DENIES. Chainable. */
  bindScope(source: () => TenantScope | null): this {
    this.tenancy.bindScope(source);
    return this;
  }
  hasScope(): boolean {
    return this.tenancy.hasScope();
  }
  /** Unscoped ownership counts, for the migration inventory. */
  ownershipCounts(): { total: number; assigned: number; unresolved: number } {
    return this.tenancy.countOwnership([...this.resources.values()].map((r) => ({ tenantId: r.tenantId })));
  }

  /**
   * The caller's resources. THE ONE FILTER.
   *
   * A row with no `tenantId` was discovered before this boundary existed and is
   * visible to NOBODY. That fails closed, and the cost is bounded: discovery
   * re-runs on a schedule and re-stamps every resource it finds, so an upgraded
   * install repopulates on the next pass rather than losing anything.
   */
  private mine(rows: readonly CloudResource[]): CloudResource[] {
    const scope = this.tenancy.scopeOrDeny();
    if (scope === null) return [];
    return rows.filter((r) => r.tenantId === scope.tenantId);
  }

  private resources = new Map<string, CloudResource>();
  private loaded = false;
  /**
   * P13C Round 7 — the graph cache is now a `TenantMemo`. It was a bare
   * `{model, at}` cell behind a 1.5s TTL, so once the store became scoped this
   * would have handed tenant A's freshly-built graph to tenant B inside the
   * window — the exact class Round 3 built `TenantMemo` for, arriving in the
   * same commit that fixed the store beneath it.
   */
  private readonly graphCache = new TenantMemo<ResourceGraphModel>('infrastructure-resource-graph', {
    ttlMs: GRAPH_TTL_MS,
  });

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

    /**
     * Discovery writes as the tenant that ran it. `requireTenant()` THROWS when
     * unresolved rather than stamping a default — a resource filed under the
     * wrong organization is worse than a discovery pass that refuses to run, and
     * the refusal is visible where a mis-filing is not.
     */
    const owner = this.tenancy.requireTenant();

    for (const next of incoming) {
      const prev = this.resources.get(next.id);
      if (!prev) {
        this.resources.set(next.id, { ...next, tenantId: owner });
        changed.push(next.id);
        created += 1;
      } else if (signature(next) !== signature(prev)) {
        // Preserve the original createdAt (first-seen), take the rest from the fresh discovery.
        this.resources.set(next.id, { ...next, createdAt: prev.createdAt, tenantId: owner });
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
      // Discovery changed the inventory: drop the memo so the next read rebuilds.
      this.graphCache.invalidate();
      await this.persist();
      this.emit('changed', { ids: changed });
    }
    return { created, updated, unchanged, deleted };
  }

  /** All resources currently in the store. */
  /** The CALLER'S resources. Was every organization's cloud inventory. */
  all(): CloudResource[] {
    return this.mine([...this.resources.values()]);
  }

  /** Resources filtered by platform and/or account. */
  query(filter?: { platformId?: string; accountId?: string }): CloudResource[] {
    let list = this.all();
    if (filter?.platformId) list = list.filter((r) => r.platformId === filter.platformId);
    if (filter?.accountId) list = list.filter((r) => r.accountId === filter.accountId);
    return list;
  }

  /**
   * Global infrastructure search across EVERY discovered resource (all platforms/accounts/domains) — the one
   * search box in the Cloud Platform Center. Matches name / native id / type / region / tags / attributes,
   * ranked name-matches first, capped at `limit` (with the true `total` reported for "N of M").
   */
  search(text: string, filter?: { platformId?: string; domain?: string }, limit = 50): InfraSearchResult {
    const q = text.trim().toLowerCase();
    if (!q) return { query: text, total: 0, hits: [] };
    const matches: Array<{ hit: InfraSearchHit; nameHit: boolean }> = [];
    // `all()`, not `this.resources.values()` — the search box was the widest read
    // on this surface: it matches names, tags AND attribute values.
    for (const r of this.all()) {
      if (filter?.platformId && r.platformId !== filter.platformId) continue;
      if (filter?.domain && r.domain !== filter.domain) continue;
      const matchedOn = matchResource(r, q);
      if (!matchedOn) continue;
      matches.push({ hit: toSearchHit(r, matchedOn), nameHit: matchedOn === 'name' });
    }
    // Name matches are the most relevant; keep a stable order within each tier by name.
    matches.sort((a, b) => (a.nameHit === b.nameHit ? a.hit.name.localeCompare(b.hit.name) : a.nameHit ? -1 : 1));
    return { query: text, total: matches.length, hits: matches.slice(0, Math.max(0, limit)).map((m) => m.hit) };
  }

  /** How many resources belong to a platform (for the Cloud Platform Center counts). */
  /** How many of the CALLER'S resources belong to a platform. */
  countForPlatform(platformId: string): number {
    // Scoped in the same commit as the listing. A count over a scoped collection
    // that is not itself scoped is the same query with the rows dropped — four
    // separate findings in this program, so it is no longer a separate step.
    let n = 0;
    for (const r of this.all()) if (r.platformId === platformId) n += 1;
    return n;
  }

  /** Build (or return the cached) Resource Graph model for a scope. `nowMs` stamps the model. */
  graph(nowMs: number, filter?: { platformId?: string; accountId?: string }): ResourceGraphModel {
    if (!filter) return this.graphCache.state(() => buildResourceGraph({ resources: this.query() }, nowMs));
    return buildResourceGraph({ resources: this.query(filter) }, nowMs);
  }

  /**
   * Whether the caller may act on this account.
   *
   * P13C Round 7. `accountId` arrives from the renderer payload and reached
   * `executor.execute` with no ownership resolution at all — so a
   * `connectors:manage` holder in one tenant could run MUTATING provider actions
   * against another tenant's cloud account. Resolved through the same filter the
   * listings use, so there is one answer to "whose account is this".
   */
  ownsAccount(platformId: string, accountId: string): boolean {
    return this.all().some((r) => r.platformId === platformId && r.accountId === accountId);
  }
}
