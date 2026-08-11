/**
 * The GraphStore — in-memory home of the Enterprise Knowledge Graph, persisted
 * as JSON. It accepts a freshly projected set of nodes and edges via `apply`,
 * diffs it against the current graph to maintain a **relationship history**
 * (every edge that appears or disappears is logged with a timestamp), keeps
 * adjacency indexes, and answers neighbor / subgraph / shortest-path / history /
 * counts queries.
 *
 * Electron-free by construction: the file path is injected, so it unit-tests on
 * a temp file with no Electron in scope. The `app.getPath('userData')` singleton
 * lives in graphInstance.ts, which tests never import.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import type {
  GraphCounts,
  GraphEdge,
  GraphEdgeEvent,
  GraphEdgeToNode,
  GraphHistoryQuery,
  GraphNeighbors,
  GraphNeighborsQuery,
  GraphNode,
  GraphNodesQuery,
  GraphPathQuery,
  GraphPathResult,
  GraphSubgraph,
  GraphSubgraphQuery,
} from '@neuropause/shared';
import type { GraphOwnership, TenantScope } from '@neuropause/shared';
import { ownershipOf, recordInScope } from '@neuropause/shared';
import { createLogger } from '../logger';
import { envelopeStamp, readStoreFile } from '../storage/storeEnvelope';
import { registerTenantStore } from '../tenancy/tenantOwnedStore';
import { declareStoreScope } from '../tenancy/storeScope';

/**
 * P13C ROUND 9 — F10. The structural scope declaration. See tenancy/storeScope.ts.
 *
 * The graph's nodes and edges have carried an owner since P13B. Its RELATIONSHIP
 * HISTORY did not — `GraphEdgeEvent` had no tenant field at all — so the file
 * held one undifferentiated log and the cap below sliced it install-wide.
 */
declareStoreScope({
  name: 'knowledge-graph',
  scope: 'TENANT',
  persistence: 'file',
  authority: 'SYSTEM',
  classification: 'CUSTOMER_DERIVED',
  /**
   * P13C ROUND 10 — the enum form, and this store is the reference the other
   * fixes point at. `capHistoryPerTenant()` walks newest-first, keeps N per
   * bucket and filters once; the two `apply()` sweeps that delete stale nodes
   * and edges are both inside a `recordInScope(x, scope)` guard, so a rebuild
   * removes only the rebuilding tenant's own slice.
   */
  retentionScope: 'OWNER',
  /** Automatic: the cap runs inside `apply`, on a 750 ms rebuild debounce. */
  retentionAuthority: 'SYSTEM',
  retention:
    'Relationship history is capped PER TENANT (5000 rows each) as of Round 9, and every row is ' +
    'stamped with the rebuilding tenant at write time. It was an install-wide slice over rows with ' +
    'no owner field at all, so one tenant\'s rebuild churn deleted another tenant\'s relationship ' +
    'history. Nodes and edges are replaced only within the rebuilding tenant\'s slice (P13B). ' +
    'Pre-Round-9 history rows have no owner: they are retained in their own bucket, deletable by ' +
    'nobody\'s traffic, and visible to nobody.',
  reason:
    'Nodes, edges and history rows name a tenant\'s people, projects, customers and the shape of the ' +
    'relationships between them. The projection derives them from the (scoped) unified store, so the ' +
    'rebuilding tenant is the authoritative owner.',
});

const log = createLogger('graph-store');

/**
 * Cap on the relationship-history log, PER TENANT.
 *
 * P13C ROUND 9 — F10. It was a flat install-wide 5000 with an oldest-first slice.
 * A cap is a WRITE: because the slice is deterministic and oldest-first, a noisy
 * tenant did not merely consume capacity, it CHOSE which of another tenant's
 * relationship-history rows was destroyed — and the graph rebuilds on a 750 ms
 * debounce off any unified-store change, so "noisy" is the ordinary case.
 */
const HISTORY_CAP_PER_TENANT = 5000;

/**
 * The retention bucket for history rows written before Round 9.
 *
 * They have no owner and are visible to nobody. They get their OWN bucket rather
 * than being folded into any tenant's, so no tenant's traffic can evict them and
 * they cannot evict any tenant's rows. Guessing an owner for them is the one
 * thing a migration must never do.
 */
const UNOWNED_HISTORY_BUCKET = ' unowned';

/**
 * A persisted relationship-history row.
 *
 * `GraphEdgeEvent` (shared) is the WIRE shape and carries no owner. The stored
 * row adds `GraphOwnership`, exactly as `GraphNode` and `GraphEdge` already do —
 * because a row that must survive a retention pass needs an authoritative owner
 * on the row itself, not merely a read filter standing in front of it.
 */
export interface StoredGraphEdgeEvent extends GraphEdgeEvent, GraphOwnership {}

interface GraphFile {
  /** Phase 9: store schema stamp — absent on legacy files (= v1). */
  schemaVersion?: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  history: StoredGraphEdgeEvent[];
  lastBuiltAt: string | null;
}

export interface GraphApplyResult {
  nodesAdded: number;
  nodesRemoved: number;
  edgesAdded: number;
  edgesRemoved: number;
}

/**
 * The tenant boundary for the graph (P13B). A FUNCTION; `null` means DENY.
 */
export type GraphScopeSource = () => TenantScope | null;

/**
 * One relationship-history row, WITH ITS OWNER, built from the rebuild scope.
 *
 * The owner is a parameter of the write rather than a property of the payload:
 * `scope` comes from `requireScope()`, which is the only thing entitled to say
 * whose rebuild this is. A history row with no owner is a row a retention pass
 * cannot attribute, which is precisely how the install-wide cap came to be able
 * to delete anyone's rows.
 */
function historyRow(
  at: string,
  edgeId: string,
  edge: GraphEdge,
  change: 'added' | 'removed',
  scope: TenantScope,
): StoredGraphEdgeEvent {
  return {
    at,
    edgeId,
    type: edge.type,
    from: edge.from,
    to: edge.to,
    change,
    tenantId: scope.tenantId,
    // Tenant-level, like the nodes and edges beside it: the graph is rebuilt for
    // the whole organization, not for one workspace inside it.
    workspaceId: null,
  };
}

/**
 * The retention bucket a stored history row belongs to. Never guessed.
 *
 * Tenant buckets are namespaced with `t:` so no tenant id can ever equal the
 * unowned bucket's key — a collision there would put an unowned row and a
 * tenant's rows in one budget, which is the thing this whole change removes.
 */
function historyBucket(h: StoredGraphEdgeEvent): string {
  const owner = h.tenantId;
  return typeof owner === 'string' && owner !== '' ? `t:${owner}` : UNOWNED_HISTORY_BUCKET;
}

/** A process-wide fallback scope, for TESTS ONLY. Same seam and guard as the others. */
let ambientGraphScope: GraphScopeSource | null = null;

export function setAmbientGraphScopeForTests(source: GraphScopeSource | null): void {
  if (process.env.VITEST === undefined && process.env.NODE_ENV !== 'test') {
    throw new Error(
      'setAmbientGraphScopeForTests is a test-only seam and must not be called at runtime.',
    );
  }
  ambientGraphScope = source;
}

export class GraphStore extends EventEmitter {
  private nodes = new Map<string, GraphNode>();
  private edges = new Map<string, GraphEdge>();
  private history: StoredGraphEdgeEvent[] = [];
  private lastBuiltAt: string | null = null;
  /** P13B — per-tenant build stamp; the global one above is a cross-tenant signal. */
  private lastBuiltAtFor = new Map<string, string>();
  private scopeSource: GraphScopeSource | null = null;
  /** nodeId → edgeIds where the node is the `from`. */
  private outAdj = new Map<string, Set<string>>();
  /** nodeId → edgeIds where the node is the `to`. */
  private inAdj = new Map<string, Set<string>>();
  private loaded = false;
  /** Tracks the in-flight background writer so callers can await durability. */
  private lastPersist: Promise<void> = Promise.resolve();
  private persisting = false;
  private dirty = false;

  /** Relationship-history rows kept per tenant. Injectable so retention is testable. */
  private readonly historyCapPerTenant: number;

  constructor(
    private readonly filePath: string,
    opts: { historyCapPerTenant?: number } = {},
  ) {
    super();
    /**
     * P13C ROUND 3 — PHASE 4. Declare this store to the startup gate. The seam
     * below predates the registry, so the gate could not see it: an unbound
     * instance denied every read (correct) and shipped silently (not correct).
     */
    registerTenantStore('knowledge-graph', () => this.hasScope());
    this.historyCapPerTenant = Math.max(1, opts.historyCapPerTenant ?? HISTORY_CAP_PER_TENANT);
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    // Phase 9 (certification fix): envelope read — a corrupt graph.json is
    // QUARANTINED beside itself (bytes preserved), never silently treated as
    // first run and overwritten. Closes the audit finding that the Knowledge
    // Graph sat outside the Phase 8 quarantine protection.
    const result = await readStoreFile<Partial<GraphFile>>(this.filePath);
    if (result.state === 'loaded' && result.data) {
      const data = result.data;
      for (const n of data.nodes ?? []) if (n && n.id) this.nodes.set(n.id, n);
      for (const e of data.edges ?? []) if (e && e.id) this.edges.set(e.id, e);
      this.history = Array.isArray(data.history) ? data.history : [];
      this.lastBuiltAt = data.lastBuiltAt ?? null;
      for (const e of this.edges.values()) this.indexEdge(e);
    } else if (result.state !== 'first-run') {
      this.quarantinedTo = result.quarantinedTo;
      log.warn('Knowledge graph store quarantined at load', { quarantinedTo: result.quarantinedTo });
    }
    this.loaded = true;
    log.info('Knowledge graph ready', { nodes: this.nodes.size, edges: this.edges.size });
  }

  /** Where a corrupt/newer store file was preserved at load, if any. */
  quarantinedTo: string | null = null;

  private async persist(): Promise<void> {
    const file: GraphFile = {
      ...envelopeStamp(),
      nodes: [...this.nodes.values()],
      edges: [...this.edges.values()],
      history: this.history,
      lastBuiltAt: this.lastBuiltAt,
    };
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(file), { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }

  /**
   * Persist in the background, coalescing concurrent requests. Writes are
   * serialized — never overlapping on the shared temp file — and a failed write
   * is logged, never fatal.
   */
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
      log.error('Graph persist failed', { error: String(err) });
    } finally {
      this.persisting = false;
    }
  }

  /** Resolves once all pending writes have been flushed to disk. */
  async flush(): Promise<void> {
    while (this.persisting) {
      await this.lastPersist;
    }
  }

  /**
   * Bind the tenant boundary. Chainable. UNBOUND DENIES.
   */
  bindScope(source: GraphScopeSource): this {
    this.scopeSource = source;
    return this;
  }

  /**
   * The scope a REBUILD needs. Throws rather than denying quietly — a
   * projection with no owner would be invisible to everyone and rebuilt on
   * every change, which presents as an empty graph rather than as a boundary.
   */
  private requireScope(): TenantScope {
    const scope = this.scopeOrDeny();
    if (scope === null) {
      throw new Error(
        'Cannot rebuild the graph: no organization and workspace are active, so its nodes would have no owner.',
      );
    }
    return scope;
  }

  /** Whether a boundary has been bound. For the migration inventory. */
  hasScope(): boolean {
    return this.scopeSource !== null;
  }

  /** The active scope, or `null` meaning DENY. */
  private scopeOrDeny(): TenantScope | null {
    const source = this.scopeSource ?? ambientGraphScope;
    return source === null ? null : source();
  }

  /**
   * The node behind an id IF this caller may see it.
   *
   * THE LOAD-BEARING FUNCTION FOR TRAVERSAL. Every hop in `neighbors`,
   * `subgraph` and `path` resolves the far side through this, so an edge that
   * crosses the tenant boundary — whether from a projection bug, a corrupt
   * file, or a deliberately planted row — leads nowhere. The traversal does not
   * need the data to be clean; it needs every step to be checked, which is a
   * property of the algorithm rather than of the data.
   */
  private visibleNode(id: string, scope: TenantScope): GraphNode | null {
    const n = this.nodes.get(id);
    return n && recordInScope(n, scope) ? n : null;
  }

  /** The edge behind an id if this caller may see it. */
  private visibleEdge(id: string, scope: TenantScope): GraphEdge | null {
    const e = this.edges.get(id);
    return e && recordInScope(e, scope) ? e : null;
  }

  /** Ownership counts across every node. Three integers, no labels. */
  ownershipCounts(): { total: number; assigned: number; unresolved: number } {
    let assigned = 0;
    let unresolved = 0;
    for (const n of this.nodes.values()) {
      if (ownershipOf(n) === 'assigned') assigned += 1;
      else unresolved += 1;
    }
    return { total: this.nodes.size, assigned, unresolved };
  }

  private indexEdge(e: GraphEdge): void {
    let outSet = this.outAdj.get(e.from);
    if (!outSet) this.outAdj.set(e.from, (outSet = new Set()));
    outSet.add(e.id);
    let inSet = this.inAdj.get(e.to);
    if (!inSet) this.inAdj.set(e.to, (inSet = new Set()));
    inSet.add(e.id);
  }

  private deindexEdge(e: GraphEdge): void {
    this.outAdj.get(e.from)?.delete(e.id);
    this.inAdj.get(e.to)?.delete(e.id);
  }

  /**
   * Keep the newest N history rows PER TENANT. P13C ROUND 9 — F10.
   *
   * Same shape as `marketplaceStore.event()`'s per-listing cap: walk newest-first,
   * keep while that owner is under its own budget, then filter. A tenant over its
   * cap loses only its own oldest rows, and a tenant under its cap loses nothing
   * no matter how loud its neighbours are. Rows with no owner (pre-Round-9 files)
   * are capped against each other in their own bucket, so they neither evict nor
   * are evicted by anyone's traffic.
   *
   * The array is only rewritten when something actually overflows, so the common
   * case costs one pass and no allocation of a new history array.
   */
  private capHistoryPerTenant(): void {
    const perTenant = new Map<string, number>();
    const kept = new Set<StoredGraphEdgeEvent>();
    let overflowed = false;
    for (let i = this.history.length - 1; i >= 0; i -= 1) {
      const row = this.history[i] as StoredGraphEdgeEvent;
      const bucket = historyBucket(row);
      const n = perTenant.get(bucket) ?? 0;
      if (n < this.historyCapPerTenant) {
        kept.add(row);
        perTenant.set(bucket, n + 1);
      } else {
        overflowed = true;
      }
    }
    if (overflowed) this.history = this.history.filter((h) => kept.has(h));
  }

  /**
   * Replace the graph with a freshly projected set, recording every edge that
   * appeared or disappeared into the relationship history.
   */
  apply(nodes: GraphNode[], edges: GraphEdge[], at: string): GraphApplyResult {
    /**
     * P13B — a rebuild replaces THIS TENANT'S SLICE of the graph.
     *
     * `apply` is a whole-graph replace, and the sweeps below delete everything
     * absent from the incoming projection. Unscoped, tenant A's rebuild deleted
     * every one of tenant B's nodes and edges, because B's are absent from A's
     * projection by construction — cross-tenant destruction on a 750 ms
     * debounce, triggered by anything that touched the unified store.
     *
     * Elements are stamped from the active scope for the same reason projected
     * memory is: the projector derives them and has no owner of its own to
     * inherit. Now that the unified store IS scoped, that stamp is trustworthy
     * rather than merely present — the projection can only have read this
     * tenant's entities in the first place.
     */
    const scope = this.requireScope();
    let nodesAdded = 0;
    let nodesRemoved = 0;
    let edgesAdded = 0;
    let edgesRemoved = 0;
    const own = <T extends { tenantId?: string | null; workspaceId?: string | null }>(x: T): T => ({
      ...x,
      tenantId: scope.tenantId,
      workspaceId: null,
    });

    // Nodes: upsert (preserving original createdAt), then drop missing.
    const newNodeIds = new Set(nodes.map((n) => n.id));
    for (const raw of nodes) {
      const n = own(raw);
      const prev = this.nodes.get(n.id);
      /**
       * A node id already owned by ANOTHER tenant is not this rebuild's to take.
       *
       * Found by adversarial review: the sweep below was scoped but this upsert
       * was not, and several projected node ids are not tenant-qualified
       * (`person:${connectorId}:${handle}`, `connector:${id}`, `app:${slug}`,
       * plus plugin- and ERP-contributed ids). Two tenants with the same person
       * on the same connector therefore shared one node id, and whichever
       * rebuilt last silently re-stamped it — the other tenant's node vanished
       * from every read and its edges became dead ends, on a 750 ms debounce.
       * It also inherited `prev.createdAt`, which is when the OTHER tenant first
       * saw that person.
       *
       * Skipped rather than overwritten: first owner keeps it, and the loser
       * simply has one fewer node rather than a corrupted one. The projector
       * now tenant-qualifies these ids so this should be unreachable — which is
       * exactly why it is checked.
       */
      if (prev && ownershipOf(prev) === 'assigned' && prev.tenantId !== scope.tenantId) continue;
      if (!prev) {
        this.nodes.set(n.id, n);
        nodesAdded++;
      } else {
        this.nodes.set(n.id, { ...n, createdAt: prev.createdAt });
      }
    }
    for (const [id, n] of [...this.nodes.entries()]) {
      // Only this tenant's stale nodes. Another tenant's are not this rebuild's
      // to remove, and an unowned pre-P13B node is inert rather than deleted.
      if (!recordInScope(n, scope)) continue;
      if (!newNodeIds.has(id)) {
        this.nodes.delete(id);
        nodesRemoved++;
      }
    }

    // Edges: add new (history 'added'), refresh existing, drop missing (history 'removed').
    const newEdges = new Map(edges.map((e) => [e.id, own(e)]));
    for (const [id, e] of newEdges) {
      const prev = this.edges.get(id);
      // Same guard as the nodes above: an edge owned elsewhere is left alone.
      if (prev && ownershipOf(prev) === 'assigned' && prev.tenantId !== scope.tenantId) continue;
      if (!prev) {
        this.edges.set(id, e);
        this.indexEdge(e);
        this.history.push(historyRow(at, id, e, 'added', scope));
        edgesAdded++;
      } else {
        this.edges.set(id, { ...e, createdAt: prev.createdAt, updatedAt: at });
      }
    }
    for (const [id, e] of [...this.edges.entries()]) {
      if (!recordInScope(e, scope)) continue;
      if (!newEdges.has(id)) {
        this.edges.delete(id);
        this.deindexEdge(e);
        this.history.push(historyRow(at, id, e, 'removed', scope));
        edgesRemoved++;
      }
    }

    /**
     * P13C ROUND 9 — F10. THE CAP IS PER TENANT, AND EVERY ROW ABOVE WAS STAMPED.
     *
     * The two pushes go through the same `own()` that stamps nodes and edges, so
     * the owner comes from `requireScope()` — the authoritative rebuild scope —
     * and never from a payload. Both branches are already inside a
     * `recordInScope(e, scope)` / cross-tenant-skip guard, so a history row can
     * only ever be written about an edge this tenant owns.
     */
    this.capHistoryPerTenant();
    this.lastBuiltAt = at;
    this.lastBuiltAtFor.set(scope.tenantId, at);
    this.schedulePersist();
    this.emit('changed');
    return { nodesAdded, nodesRemoved, edgesAdded, edgesRemoved };
  }

  getNode(id: string): GraphNode | null {
    const scope = this.scopeOrDeny();
    if (scope === null) return null;
    return this.visibleNode(id, scope);
  }

  /**
   * The graph's search. Scoped, because it is a leg of Enterprise Search and
   * therefore a leg of the AI context builder — a node label reaching a model
   * is a node label leaving the tenant.
   */
  listNodes(q: GraphNodesQuery): GraphNode[] {
    const scope = this.scopeOrDeny();
    if (scope === null) return [];
    const text = q.text?.trim().toLowerCase();
    const out: GraphNode[] = [];
    for (const n of this.nodes.values()) {
      if (!recordInScope(n, scope)) continue;
      if (q.type && n.type !== q.type) continue;
      if (q.connectorId && n.connectorId !== q.connectorId) continue;
      if (text && !n.label.toLowerCase().includes(text)) continue;
      out.push(n);
    }
    out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
    return out.slice(0, q.limit ?? 200);
  }

  /**
   * One hop out from a node.
   *
   * THREE checks, not one: the anchor must be visible, the EDGE must be
   * visible, and the far NODE must be visible. Checking only the anchor would
   * make a single cross-tenant edge a complete disclosure of the node on its
   * far side — which is exactly the adversarial fixture Phase 17 requires, and
   * the reason the malicious edge is deliberately left in the store rather than
   * cleaned up before the test.
   */
  neighbors(q: GraphNeighborsQuery): GraphNeighbors | null {
    const scope = this.scopeOrDeny();
    if (scope === null) return null;
    const node = this.visibleNode(q.id, scope);
    if (!node) return null;
    const dir = q.direction ?? 'both';
    const types = q.edgeTypes && q.edgeTypes.length > 0 ? new Set(q.edgeTypes) : null;
    const neighbors: GraphEdgeToNode[] = [];

    const collect = (edgeIds: Set<string> | undefined, direction: 'out' | 'in'): void => {
      if (!edgeIds) return;
      for (const eid of edgeIds) {
        const edge = this.visibleEdge(eid, scope);
        if (!edge) continue;
        if (types && !types.has(edge.type)) continue;
        const otherId = direction === 'out' ? edge.to : edge.from;
        const other = this.visibleNode(otherId, scope);
        if (!other) continue;
        neighbors.push({ edge, node: other, direction });
      }
    };

    if (dir === 'out' || dir === 'both') collect(this.outAdj.get(q.id), 'out');
    if (dir === 'in' || dir === 'both') collect(this.inAdj.get(q.id), 'in');
    return { node, neighbors: neighbors.slice(0, q.limit ?? 100) };
  }

  subgraph(q: GraphSubgraphQuery): GraphSubgraph | null {
    const scope = this.scopeOrDeny();
    if (scope === null) return null;
    const root = this.visibleNode(q.id, scope);
    if (!root) return null;
    const depth = q.depth ?? 1;
    const limit = q.limit ?? 200;
    const seen = new Set<string>([q.id]);
    let frontier: string[] = [q.id];
    const collectedEdges = new Map<string, GraphEdge>();

    for (let d = 0; d < depth && frontier.length > 0; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        const around: Array<[Set<string> | undefined, boolean]> = [
          [this.outAdj.get(id), true],
          [this.inAdj.get(id), false],
        ];
        for (const [edgeIds, isOut] of around) {
          if (!edgeIds) continue;
          for (const eid of edgeIds) {
            const edge = this.visibleEdge(eid, scope);
            if (!edge) continue;
            const other = isOut ? edge.to : edge.from;
            /**
             * The far node is checked BEFORE the edge is collected.
             *
             * Collecting the edge first — as this loop used to — put the far
             * node's id into the returned edge list even when the node itself
             * was filtered out of `nodes`. A caller reading `edges` would still
             * learn that some node with that id exists and is connected here,
             * which is the relationship-existence side channel Phase 19 names.
             */
            if (!this.visibleNode(other, scope)) continue;
            collectedEdges.set(edge.id, edge);
            if (!seen.has(other) && seen.size < limit) {
              seen.add(other);
              next.push(other);
            }
          }
        }
      }
      frontier = next;
    }

    const nodes: GraphNode[] = [];
    for (const id of seen) {
      const n = this.visibleNode(id, scope);
      if (n) nodes.push(n);
    }
    return { nodes, edges: [...collectedEdges.values()], rootId: q.id };
  }

  /**
   * Shortest path between two nodes.
   *
   * A PATH IS AN ANSWER TO A YES/NO QUESTION, so both endpoints are checked
   * before the search runs. Returning "no path" for an invisible endpoint is
   * the same answer as for a genuinely unreachable one — a caller cannot
   * distinguish "that node is not yours" from "those two are not connected",
   * which is the point.
   */
  path(q: GraphPathQuery): GraphPathResult {
    const empty: GraphPathResult = { path: null, nodes: [], edges: [] };
    const scope = this.scopeOrDeny();
    if (scope === null) return empty;
    const fromNode = this.visibleNode(q.from, scope);
    const toNode = this.visibleNode(q.to, scope);
    if (!fromNode || !toNode) return empty;
    if (q.from === q.to) {
      return { path: [q.from], nodes: [fromNode], edges: [] };
    }
    const maxDepth = q.maxDepth ?? 5;
    const prev = new Map<string, { node: string; edge: string }>();
    const visited = new Set<string>([q.from]);
    let frontier: string[] = [q.from];
    let found = false;

    for (let d = 0; d < maxDepth && frontier.length > 0 && !found; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        const adj = [...(this.outAdj.get(id) ?? []), ...(this.inAdj.get(id) ?? [])];
        for (const eid of adj) {
          const edge = this.visibleEdge(eid, scope);
          if (!edge) continue;
          const other = edge.from === id ? edge.to : edge.from;
          // Every hop is re-checked. A cross-tenant edge is a dead end rather
          // than a bridge, so BFS cannot route through another tenant's node
          // even to reach a node of the caller's own on the far side.
          if (!this.visibleNode(other, scope)) continue;
          if (visited.has(other)) continue;
          visited.add(other);
          prev.set(other, { node: id, edge: eid });
          next.push(other);
          if (other === q.to) {
            found = true;
            break;
          }
        }
        if (found) break;
      }
      frontier = next;
    }

    if (!found) return empty;

    const pathIds: string[] = [];
    const edgeList: GraphEdge[] = [];
    let cur = q.to;
    while (cur !== q.from) {
      pathIds.unshift(cur);
      const step = prev.get(cur);
      if (!step) break;
      const edge = this.edges.get(step.edge);
      if (edge) edgeList.unshift(edge);
      cur = step.node;
    }
    pathIds.unshift(q.from);

    const nodes: GraphNode[] = [];
    for (const id of pathIds) {
      const n = this.visibleNode(id, scope);
      if (n) nodes.push(n);
    }
    return { path: pathIds, nodes, edges: edgeList };
  }

  /**
   * Relationship history for one node.
   *
   * Scoped on the ROW'S OWN OWNER first, then on the anchor being visible, then
   * on the far end. History entries record `from`/`to` node ids and edge types,
   * so an unscoped read would let a caller watch another tenant's relationships
   * appear and disappear over time — a change feed is a disclosure with a
   * timestamp.
   *
   * P13C ROUND 9 — F10. The row check is FIRST and is new. Before it, the read
   * was scoped entirely on the endpoint NODES, which is a filter standing in
   * front of rows that had no owner at all. A pre-Round-9 row is therefore
   * unresolved and visible to nobody — the same answer `recordInScope` gives for
   * every other unowned record in the app, and the only honest one: guessing an
   * owner for a historical row is indistinguishable from a correct answer
   * afterwards.
   */
  historyFor(q: GraphHistoryQuery): GraphEdgeEvent[] {
    const scope = this.scopeOrDeny();
    if (scope === null) return [];
    if (!this.visibleNode(q.id, scope)) return [];
    const out = this.history.filter((h) => {
      if (!recordInScope(h, scope)) return false;
      if (h.from !== q.id && h.to !== q.id) return false;
      // The far end must also be the caller's. A removed edge's node may no
      // longer exist, in which case the event names an id and nothing more —
      // but if it DOES exist and belongs elsewhere, it is withheld.
      const far = h.from === q.id ? h.to : h.from;
      const farNode = this.nodes.get(far);
      return farNode === undefined || recordInScope(farNode, scope);
    });
    return out.slice(-(q.limit ?? 100)).reverse();
  }

  /** Counts for THIS CALLER only — a global node count is a disclosure. */
  counts(): GraphCounts {
    const scope = this.scopeOrDeny();
    const byNodeType: Record<string, number> = {};
    const byEdgeType: Record<string, number> = {};
    if (scope === null) {
      return { nodes: 0, edges: 0, byNodeType, byEdgeType, lastBuiltAt: null };
    }
    let nodes = 0;
    let edges = 0;
    for (const n of this.nodes.values()) {
      if (!recordInScope(n, scope)) continue;
      nodes += 1;
      byNodeType[n.type] = (byNodeType[n.type] ?? 0) + 1;
    }
    for (const e of this.edges.values()) {
      if (!recordInScope(e, scope)) continue;
      edges += 1;
      byEdgeType[e.type] = (byEdgeType[e.type] ?? 0) + 1;
    }
    /**
     * `lastBuiltAt` is scoped too. It is set by whichever tenant last rebuilt,
     * so returning the global value is a live readout of another tenant's
     * activity — the same signal `unifiedStore.counts()` deliberately scopes
     * through `lastUpdatedAt`, and the one the graph originally missed.
     */
    return { nodes, edges, byNodeType, byEdgeType, lastBuiltAt: this.lastBuiltAtFor.get(scope.tenantId) ?? null };
  }
}
