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
import { declareStoreScope } from '../tenancy/storeScope';
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import {
  buildResourceGraph,
  type CloudResource,
  type InfraSearchHit,
  type InfraSearchResult,
  type ResourceGraphModel,
} from '@neuropause/shared';

/**
 * P13C ROUND 10 — the structural scope declaration. See tenancy/storeScope.ts.
 *
 * The file satisfied the scope gate through `new TenantOwnership(...)` alone,
 * which asks "is a boundary bound?" and cannot express what a REMOVAL reaches.
 * That is the hole all three of Round 9's proven HIGH findings sat in.
 */
declareStoreScope({
  name: 'infrastructure-resources',
  scope: 'TENANT',
  persistence: 'file',
  authority: 'ORG_ROLE',
  classification: 'CUSTOMER_DERIVED',
  retentionScope: 'OWNER',
  /**
   * The removal is the discovery pass's source-deletion cascade, which runs
   * under the discovering tenant's own principal. No cap, no TTL over rows —
   * `GRAPH_TTL_MS` bounds a MEMO of a projection, not the resources.
   */
  retentionAuthority: 'OWNER',
  retention:
    'No cap and no TTL on rows. The one removal is the source-deletion half of `upsertMany`: when ' +
    'a discovery pass reports that a provider object is gone, its resource is deleted. As of ' +
    'Round 10 that deletion is CONFINED TO THE DISCOVERING TENANT — the id is resolved against ' +
    "rows the writer owns, so a `deletedIds` entry naming another organization's resource is a " +
    'miss rather than a delete. It previously resolved over the whole Map on either the resolved ' +
    'id or a `nativeId` matched only on platform+account, and two organizations that discover the ' +
    'same cloud account share both. `GRAPH_TTL_MS` expires a per-tenant `TenantMemo` of the ' +
    'projected graph and removes no resource.',
  reason:
    'Discovered cloud inventory: resource names, tags, attribute values, account ids, regions and ' +
    'health. `tenantId` is stamped from `requireTenant()` at every upsert and `mine()` is the one ' +
    'read filter. Round 7 found this subsystem had never had a tenant dimension at all — 54 files ' +
    'and not one reference to a scope — so the boundary is young and the declaration says so.',
});

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

  /**
   * Bind the tenant boundary. UNBOUND DENIES. Chainable.
   *
   * P13C ROUND 17 — TWO BOUNDARIES, ONE CALL SITE.
   *
   * This class holds TWO registered tenant boundaries, not one: `tenancy` on
   * the rows, and `graphCache` — a `TenantMemo`, which constructs its own
   * `TenantOwnership` under the name `infrastructure-resource-graph`. Round 7
   * bound the first and not the second, and `initInfrastructure` calls
   * `.bindScope(deps.scope)` exactly once, on this method, so there was no
   * second call site that could have caught it.
   *
   * The startup gate DID catch it — the first time it was ever allowed to run,
   * after Round 17 moved it below the `init*()` calls it had been racing since
   * Round 3. It was the only unbound store among 27 `TenantMemo` instances, and
   * it had been masked for fourteen rounds by the thirteen ordering false
   * positives that aborted composition before the honest check.
   *
   * IMPACT, STATED HONESTLY: an unbound memo fails CLOSED — `scopeOrDeny()`
   * returns null, `state()` composes fresh and stores nothing, and the row
   * filter beneath it was correctly bound the whole time. So this was never a
   * cross-tenant read. It was a projection that silently never cached, and a
   * keying protection that was never actually exercised for this one model.
   *
   * The binding happens HERE rather than at the composition root because the
   * memo is this class's private field. A caller cannot be expected to know
   * about a boundary it cannot see.
   */
  bindScope(source: () => TenantScope | null): this {
    this.tenancy.bindScope(source);
    this.graphCache.bindScope(source);
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
      /**
       * P13C ROUND 10 — THE DELETE RESOLVES WITHIN THE DISCOVERING TENANT.
       *
       * Both arms resolved over the whole Map: the exact-id arm did no
       * ownership check at all, and the `nativeId` arm narrowed on
       * platform+account, which is a CLOUD account and not an organization —
       * the file's own comment says two accounts routinely share a native id,
       * and two ORGANIZATIONS that point at the same cloud account share both
       * of the fields that arm compares. A discovery pass for one tenant could
       * therefore delete another tenant's resource row, which is the same
       * read-scoped/write-unscoped split as the marketplace, the connectors and
       * the org directory.
       *
       * `owner` is the authoritative `requireTenant()` value resolved above, so
       * a `deletedIds` entry naming somebody else's resource is now a MISS —
       * indistinguishable from an id that does not exist, which is the answer
       * every other resolver in this program gives.
       */
      const exact = this.resources.get(id);
      const resolved =
        exact && exact.tenantId === owner
          ? id
          : [...this.resources.values()].find(
              (r) => r.tenantId === owner && r.nativeId === id && (!scope?.platformId || r.platformId === scope.platformId) && (!scope?.accountId || r.accountId === scope.accountId),
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
