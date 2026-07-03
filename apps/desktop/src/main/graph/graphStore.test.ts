import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GraphEdge, GraphNode } from '@neuropause/shared';
import { GraphStore } from './graphStore';

const NOW = '2026-01-01T00:00:00.000Z';
const LATER = '2026-01-02T00:00:00.000Z';

function node(id: string, type: string, label = id): GraphNode {
  return {
    id,
    type: type as never,
    label,
    sourceKind: 'test',
    sourceId: id,
    connectorId: 'github',
    createdAt: NOW,
    updatedAt: NOW,
    metadata: {},
  };
}

function edge(from: string, type: string, to: string): GraphEdge {
  return {
    id: `${from}|${type}|${to}`,
    type: type as never,
    from,
    to,
    label: null,
    createdAt: NOW,
    updatedAt: NOW,
    evidence: null,
    metadata: {},
  };
}

describe('GraphStore', () => {
  let dir: string;
  let path: string;
  const opened: GraphStore[] = [];

  // Track every store so we can flush pending background persists before the
  // temp dir is removed — otherwise the async write would race teardown.
  async function open(p: string): Promise<GraphStore> {
    const store = new GraphStore(p);
    await store.load();
    opened.push(store);
    return store;
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'graph-'));
    path = join(dir, 'graph.json');
  });
  afterEach(async () => {
    await Promise.all(opened.map((s) => s.flush()));
    opened.length = 0;
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('applies nodes and edges, then answers lookup / neighbors / counts', async () => {
    const store = await open(path);
    const nodes = [
      node('proj1', 'project', 'Apollo'),
      node('task1', 'task', 'Build API'),
      node('person:github:dev', 'person', 'dev'),
    ];
    const edges = [edge('task1', 'belongs_to', 'proj1'), edge('task1', 'assigned_to', 'person:github:dev')];
    const res = store.apply(nodes, edges, NOW);
    expect(res.nodesAdded).toBe(3);
    expect(res.edgesAdded).toBe(2);

    expect(store.getNode('proj1')?.label).toBe('Apollo');

    const counts = store.counts();
    expect(counts.nodes).toBe(3);
    expect(counts.edges).toBe(2);
    expect(counts.byNodeType.project).toBe(1);
    expect(counts.byEdgeType.belongs_to).toBe(1);

    const nbrs = store.neighbors({ id: 'task1' });
    expect(nbrs?.neighbors.length).toBe(2);
    expect(nbrs?.neighbors.find((n) => n.node.id === 'proj1')?.direction).toBe('out');

    const projIn = store.neighbors({ id: 'proj1', direction: 'in' });
    expect(projIn?.neighbors[0]?.node.id).toBe('task1');

    const assigned = store.neighbors({ id: 'task1', edgeTypes: ['assigned_to'] });
    expect(assigned?.neighbors.length).toBe(1);
    expect(assigned?.neighbors[0]?.node.id).toBe('person:github:dev');

    expect(store.listNodes({ type: 'task' }).length).toBe(1);
    expect(store.listNodes({ text: 'apollo' }).map((n) => n.id)).toEqual(['proj1']);
  });

  it('finds a shortest path and a bounded subgraph', async () => {
    const store = await open(path);
    store.apply(
      [node('a', 'project'), node('b', 'task'), node('c', 'person')],
      [edge('b', 'belongs_to', 'a'), edge('b', 'assigned_to', 'c')],
      NOW,
    );

    const p = store.path({ from: 'a', to: 'c' });
    expect(p.path).toEqual(['a', 'b', 'c']);
    expect(p.edges.length).toBe(2);

    expect(store.path({ from: 'a', to: 'a' }).path).toEqual(['a']);

    const sg = store.subgraph({ id: 'a', depth: 2 });
    expect(sg?.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c']);
    expect(sg?.edges.length).toBe(2);

    expect(store.path({ from: 'a', to: 'missing' }).path).toBeNull();
  });

  it('records relationship history when edges appear and disappear', async () => {
    const store = await open(path);
    const nodes = [node('t', 'task'), node('p1', 'person'), node('p2', 'person')];
    store.apply(nodes, [edge('t', 'assigned_to', 'p1')], NOW);

    const res = store.apply(nodes, [edge('t', 'assigned_to', 'p2')], LATER);
    expect(res.edgesAdded).toBe(1);
    expect(res.edgesRemoved).toBe(1);

    const hist = store.historyFor({ id: 't' });
    expect(hist.length).toBe(3);
    const changes = hist.map((h) => `${h.change}:${h.to}`);
    expect(changes).toContain('added:p1');
    expect(changes).toContain('added:p2');
    expect(changes).toContain('removed:p1');

    expect(store.neighbors({ id: 't' })?.neighbors.map((n) => n.node.id)).toEqual(['p2']);
  });

  it('persists nodes, edges, and history across reloads', async () => {
    const store = await open(path);
    store.apply([node('x', 'project', 'Persisted'), node('y', 'person')], [edge('x', 'created_by', 'y')], NOW);
    await store.flush();

    const reopened = await open(path);
    expect(reopened.getNode('x')?.label).toBe('Persisted');
    expect(reopened.counts().nodes).toBe(2);
    expect(reopened.counts().edges).toBe(1);
    expect(reopened.neighbors({ id: 'x' })?.neighbors[0]?.node.id).toBe('y');
    expect(reopened.historyFor({ id: 'x' }).length).toBe(1);
  });
});
