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
import { createLogger } from '../logger';

const log = createLogger('graph-store');

/** Cap on the relationship-history log so the file can't grow without bound. */
const HISTORY_CAP = 5000;

interface GraphFile {
  nodes: GraphNode[];
  edges: GraphEdge[];
  history: GraphEdgeEvent[];
  lastBuiltAt: string | null;
}

export interface GraphApplyResult {
  nodesAdded: number;
  nodesRemoved: number;
  edgesAdded: number;
  edgesRemoved: number;
}

export class GraphStore extends EventEmitter {
  private nodes = new Map<string, GraphNode>();
  private edges = new Map<string, GraphEdge>();
  private history: GraphEdgeEvent[] = [];
  private lastBuiltAt: string | null = null;
  /** nodeId → edgeIds where the node is the `from`. */
  private outAdj = new Map<string, Set<string>>();
  /** nodeId → edgeIds where the node is the `to`. */
  private inAdj = new Map<string, Set<string>>();
  private loaded = false;
  /** Tracks the in-flight background writer so callers can await durability. */
  private lastPersist: Promise<void> = Promise.resolve();
  private persisting = false;
  private dirty = false;

  constructor(private readonly filePath: string) {
    super();
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const data = JSON.parse(raw) as Partial<GraphFile>;
      for (const n of data.nodes ?? []) if (n && n.id) this.nodes.set(n.id, n);
      for (const e of data.edges ?? []) if (e && e.id) this.edges.set(e.id, e);
      this.history = Array.isArray(data.history) ? data.history : [];
      this.lastBuiltAt = data.lastBuiltAt ?? null;
      for (const e of this.edges.values()) this.indexEdge(e);
    } catch {
      // First run — empty graph.
    }
    this.loaded = true;
    log.info('Knowledge graph ready', { nodes: this.nodes.size, edges: this.edges.size });
  }

  private async persist(): Promise<void> {
    const file: GraphFile = {
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
   * Replace the graph with a freshly projected set, recording every edge that
   * appeared or disappeared into the relationship history.
   */
  apply(nodes: GraphNode[], edges: GraphEdge[], at: string): GraphApplyResult {
    let nodesAdded = 0;
    let nodesRemoved = 0;
    let edgesAdded = 0;
    let edgesRemoved = 0;

    // Nodes: upsert (preserving original createdAt), then drop missing.
    const newNodeIds = new Set(nodes.map((n) => n.id));
    for (const n of nodes) {
      const prev = this.nodes.get(n.id);
      if (!prev) {
        this.nodes.set(n.id, n);
        nodesAdded++;
      } else {
        this.nodes.set(n.id, { ...n, createdAt: prev.createdAt });
      }
    }
    for (const id of [...this.nodes.keys()]) {
      if (!newNodeIds.has(id)) {
        this.nodes.delete(id);
        nodesRemoved++;
      }
    }

    // Edges: add new (history 'added'), refresh existing, drop missing (history 'removed').
    const newEdges = new Map(edges.map((e) => [e.id, e]));
    for (const [id, e] of newEdges) {
      const prev = this.edges.get(id);
      if (!prev) {
        this.edges.set(id, e);
        this.indexEdge(e);
        this.history.push({ at, edgeId: id, type: e.type, from: e.from, to: e.to, change: 'added' });
        edgesAdded++;
      } else {
        this.edges.set(id, { ...e, createdAt: prev.createdAt, updatedAt: at });
      }
    }
    for (const id of [...this.edges.keys()]) {
      if (!newEdges.has(id)) {
        const e = this.edges.get(id) as GraphEdge;
        this.edges.delete(id);
        this.deindexEdge(e);
        this.history.push({ at, edgeId: id, type: e.type, from: e.from, to: e.to, change: 'removed' });
        edgesRemoved++;
      }
    }

    if (this.history.length > HISTORY_CAP) {
      this.history = this.history.slice(this.history.length - HISTORY_CAP);
    }
    this.lastBuiltAt = at;
    this.schedulePersist();
    this.emit('changed');
    return { nodesAdded, nodesRemoved, edgesAdded, edgesRemoved };
  }

  getNode(id: string): GraphNode | null {
    return this.nodes.get(id) ?? null;
  }

  listNodes(q: GraphNodesQuery): GraphNode[] {
    const text = q.text?.trim().toLowerCase();
    const out: GraphNode[] = [];
    for (const n of this.nodes.values()) {
      if (q.type && n.type !== q.type) continue;
      if (q.connectorId && n.connectorId !== q.connectorId) continue;
      if (text && !n.label.toLowerCase().includes(text)) continue;
      out.push(n);
    }
    out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
    return out.slice(0, q.limit ?? 200);
  }

  neighbors(q: GraphNeighborsQuery): GraphNeighbors | null {
    const node = this.nodes.get(q.id);
    if (!node) return null;
    const dir = q.direction ?? 'both';
    const types = q.edgeTypes && q.edgeTypes.length > 0 ? new Set(q.edgeTypes) : null;
    const neighbors: GraphEdgeToNode[] = [];

    const collect = (edgeIds: Set<string> | undefined, direction: 'out' | 'in'): void => {
      if (!edgeIds) return;
      for (const eid of edgeIds) {
        const edge = this.edges.get(eid);
        if (!edge) continue;
        if (types && !types.has(edge.type)) continue;
        const otherId = direction === 'out' ? edge.to : edge.from;
        const other = this.nodes.get(otherId);
        if (!other) continue;
        neighbors.push({ edge, node: other, direction });
      }
    };

    if (dir === 'out' || dir === 'both') collect(this.outAdj.get(q.id), 'out');
    if (dir === 'in' || dir === 'both') collect(this.inAdj.get(q.id), 'in');
    return { node, neighbors: neighbors.slice(0, q.limit ?? 100) };
  }

  subgraph(q: GraphSubgraphQuery): GraphSubgraph | null {
    const root = this.nodes.get(q.id);
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
            const edge = this.edges.get(eid);
            if (!edge) continue;
            collectedEdges.set(edge.id, edge);
            const other = isOut ? edge.to : edge.from;
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
      const n = this.nodes.get(id);
      if (n) nodes.push(n);
    }
    return { nodes, edges: [...collectedEdges.values()], rootId: q.id };
  }

  path(q: GraphPathQuery): GraphPathResult {
    const empty: GraphPathResult = { path: null, nodes: [], edges: [] };
    if (!this.nodes.has(q.from) || !this.nodes.has(q.to)) return empty;
    if (q.from === q.to) {
      const only = this.nodes.get(q.from) as GraphNode;
      return { path: [q.from], nodes: [only], edges: [] };
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
          const edge = this.edges.get(eid);
          if (!edge) continue;
          const other = edge.from === id ? edge.to : edge.from;
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
      const n = this.nodes.get(id);
      if (n) nodes.push(n);
    }
    return { path: pathIds, nodes, edges: edgeList };
  }

  historyFor(q: GraphHistoryQuery): GraphEdgeEvent[] {
    const out = this.history.filter((h) => h.from === q.id || h.to === q.id);
    return out.slice(-(q.limit ?? 100)).reverse();
  }

  counts(): GraphCounts {
    const byNodeType: Record<string, number> = {};
    const byEdgeType: Record<string, number> = {};
    for (const n of this.nodes.values()) byNodeType[n.type] = (byNodeType[n.type] ?? 0) + 1;
    for (const e of this.edges.values()) byEdgeType[e.type] = (byEdgeType[e.type] ?? 0) + 1;
    return { nodes: this.nodes.size, edges: this.edges.size, byNodeType, byEdgeType, lastBuiltAt: this.lastBuiltAt };
  }
}
