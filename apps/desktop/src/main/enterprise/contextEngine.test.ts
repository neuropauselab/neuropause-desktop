/**
 * P2.5 — Context Engine (entity-360) tests.
 *
 * The engine composes four existing read-only sources into one grounded view. These
 * tests inject fakes for all four and verify: id resolution (graph id, `erp:` prefix,
 * raw-record fallback, unknown), that ERP entities get transitive impact while UDM
 * nodes never do (the relationship model is not even consulted), that the timeline +
 * memory are keyed on the UN-prefixed record id, and that `sources` truthfully
 * reports which subsystems contributed.
 */
import { describe, expect, it } from 'vitest';
import type {
  EnterpriseTimelineEntry,
  GraphEdge,
  GraphEdgeToNode,
  GraphEdgeType,
  GraphNode,
  GraphNodeType,
  MemoryItem,
  RelationshipEntityKind,
  RelationshipGraphEdge,
  RelationshipGraphModel,
  RelationshipNode,
  RelationshipType,
} from '@neuropause/shared';
import { buildEnterpriseContext, type ContextEngineDeps } from './contextEngine';

const NOW = '2026-02-01T00:00:00.000Z';

/* ── fixture builders (fully typed — the lint gate forbids `any`) ── */
function gnode(id: string, type: GraphNodeType): GraphNode {
  return {
    id,
    type,
    label: id,
    sourceKind: `erp:${type}`,
    sourceId: id,
    connectorId: null,
    createdAt: NOW,
    updatedAt: NOW,
    metadata: { seed: 1 },
  };
}
function gedge(from: string, to: string, type: GraphEdgeType): GraphEdge {
  return { id: `${from}|${type}|${to}`, type, from, to, label: type, createdAt: NOW, updatedAt: NOW, evidence: null, metadata: {} };
}
function link(nodeId: string, nodeType: GraphNodeType, edgeType: GraphEdgeType, direction: 'out' | 'in'): GraphEdgeToNode {
  const [from, to] = direction === 'out' ? ['anchor', nodeId] : [nodeId, 'anchor'];
  return { edge: gedge(from, to, edgeType), node: gnode(nodeId, nodeType), direction };
}
function tlEntry(id: string, sourceModule: string | null): EnterpriseTimelineEntry {
  return {
    id,
    source: 'platform',
    at: NOW,
    kind: 'enterprise.record.created',
    category: 'operations',
    title: `activity ${id}`,
    summary: null,
    actorId: null,
    actorLabel: null,
    connectorId: null,
    sourceModule,
    resourceId: null,
    entityRefs: [],
    url: null,
    metadata: {},
  };
}
function memItem(id: string, title: string, content: string): MemoryItem {
  return {
    id,
    kind: 'decision',
    origin: 'projected',
    title,
    content,
    connectorId: null,
    source: 'x',
    entityRefs: [],
    tags: [],
    occurredAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    evidence: null,
    metadata: {},
  };
}
function rnode(id: string, kind: RelationshipEntityKind): RelationshipNode {
  return {
    id,
    kind,
    key: id,
    label: `${kind} ${id}`,
    detail: '',
    master: false,
    resolved: true,
    inDegree: 0,
    outDegree: 0,
    degree: 1,
    value: 0,
    activity: 0,
    risk: 40,
    health: 'healthy',
    lastUpdated: NOW,
  };
}
function redge(from: string, to: string, type: RelationshipType): RelationshipGraphEdge {
  return {
    id: `${from}~${type}~${to}`,
    from,
    to,
    type,
    direction: 'out',
    confidence: 1,
    weight: 1,
    count: 1,
    strength: 5,
    activity: 0,
    risk: 0,
    health: 'healthy',
    lastUpdated: NOW,
  };
}
function relModel(nodes: RelationshipNode[], edges: RelationshipGraphEdge[]): RelationshipGraphModel {
  return {
    generatedAtMs: 0,
    nodes,
    edges,
    insights: {} as RelationshipGraphModel['insights'],
    kpis: [],
    counts: { nodes: nodes.length, edges: edges.length, byKind: {}, byHealth: {} },
    criticalEdges: [],
    highRiskEdges: [],
    disconnected: [],
    topEntities: [],
    narrative: {} as RelationshipGraphModel['narrative'],
  };
}

describe('buildEnterpriseContext', () => {
  it('composes the full 360 for an ERP entity addressed by its graph id', () => {
    const model = relModel(
      [rnode('c1', 'customer'), rnode('o1', 'order'), rnode('inv1', 'invoice')],
      [redge('c1', 'o1', 'places_order'), redge('o1', 'inv1', 'order_to_invoice')],
    );
    let relCalls = 0;
    const timelineRefs: string[] = [];
    const deps: ContextEngineDeps = {
      getNode: (id) => (id === 'erp:c1' ? gnode('erp:c1', 'customer') : null),
      neighbors: () => ({
        node: gnode('erp:c1', 'customer'),
        neighbors: [
          link('erp:o1', 'sales_order', 'references', 'out'),
          link('erp:inv1', 'invoice', 'references', 'in'),
        ],
      }),
      relationshipModel: () => {
        relCalls += 1;
        return model;
      },
      timeline: (ref) => {
        timelineRefs.push(ref);
        return [tlEntry('e1', 'sales-orders')];
      },
      memories: () => [memItem('mem1', 'Follow up', 'Call Acme about SO-1')],
      now: () => NOW,
    };

    const ctx = buildEnterpriseContext(deps, { id: 'erp:c1' });

    expect(ctx.isErp).toBe(true);
    expect(ctx.node?.id).toBe('erp:c1');
    expect(ctx.neighbors).toHaveLength(2);
    expect(ctx.neighbors[0]).toMatchObject({ id: 'erp:o1', edgeType: 'references', direction: 'out' });
    // Transitive blast radius from the FK model: o1 + inv1 reachable (undirected).
    expect(ctx.impact).not.toBeNull();
    expect(ctx.impact?.reach).toBe(2);
    expect(ctx.impact?.topAffected.every((a) => a.id.startsWith('erp:'))).toBe(true);
    expect(ctx.activity).toHaveLength(1);
    expect(ctx.activity[0].sourceModule).toBe('sales-orders');
    expect(ctx.memories[0]).toMatchObject({ id: 'mem1', title: 'Follow up' });
    expect(ctx.sources).toEqual({ graph: true, relationship: true, timeline: true, memory: true });
    // Timeline is keyed on the UN-prefixed record id, not the graph id.
    expect(timelineRefs).toEqual(['c1']);
    expect(relCalls).toBe(1);
  });

  it('never computes impact for a UDM node and does not consult the relationship model', () => {
    let relCalls = 0;
    const deps: ContextEngineDeps = {
      getNode: (id) => (id === 'doc1' ? gnode('doc1', 'document') : null),
      neighbors: () => ({ node: gnode('doc1', 'document'), neighbors: [] }),
      relationshipModel: () => {
        relCalls += 1;
        return relModel([], []);
      },
      timeline: () => [tlEntry('e2', 'github')],
      memories: () => [],
      now: () => NOW,
    };

    const ctx = buildEnterpriseContext(deps, { id: 'doc1' });

    expect(ctx.isErp).toBe(false);
    expect(ctx.impact).toBeNull();
    expect(relCalls).toBe(0);
    expect(ctx.sources).toEqual({ graph: true, relationship: false, timeline: true, memory: false });
  });

  it('resolves a raw ERP record id via the erp: fallback and keys timeline on the record id', () => {
    const timelineRefs: string[] = [];
    const deps: ContextEngineDeps = {
      getNode: (id) => (id === 'erp:c9' ? gnode('erp:c9', 'customer') : null), // raw 'c9' → null
      neighbors: () => ({ node: gnode('erp:c9', 'customer'), neighbors: [] }),
      relationshipModel: () => relModel([rnode('c9', 'customer')], []),
      timeline: (ref) => {
        timelineRefs.push(ref);
        return [];
      },
      memories: () => [],
      now: () => NOW,
    };

    const ctx = buildEnterpriseContext(deps, { id: 'c9' });

    expect(ctx.id).toBe('erp:c9');
    expect(ctx.isErp).toBe(true);
    expect(ctx.node?.id).toBe('erp:c9');
    expect(timelineRefs).toEqual(['c9']);
  });

  it('degrades gracefully for an unknown id (no node, empty everything, all sources false)', () => {
    const deps: ContextEngineDeps = {
      getNode: () => null,
      neighbors: () => null,
      relationshipModel: () => null,
      timeline: () => [],
      memories: () => [],
      now: () => NOW,
    };

    const ctx = buildEnterpriseContext(deps, { id: 'nope' });

    expect(ctx.id).toBe('nope');
    expect(ctx.node).toBeNull();
    expect(ctx.neighbors).toEqual([]);
    expect(ctx.impact).toBeNull();
    expect(ctx.sources).toEqual({ graph: false, relationship: false, timeline: false, memory: false });
  });
});
