/**
 * P2.5 — ERP → Knowledge Graph bridge (pure translator) tests.
 *
 * Verifies the bridge that unifies the business-entity relationship graph into the
 * ONE Enterprise Knowledge Graph: node-type mapping, `erp:` namespacing (so ids
 * can never collide with UDM nodes), edge-vocabulary mapping (with the specific ERP
 * relation preserved in metadata + evidence), and the null-model guard.
 */
import { describe, expect, it } from 'vitest';
import { ERP_NODE_PREFIX, erpGraphBridge } from '@neuropause/shared';
import type {
  RelationshipEntityKind,
  RelationshipGraphEdge,
  RelationshipGraphModel,
  RelationshipNode,
  RelationshipType,
} from '@neuropause/shared';

const NOW = '2026-02-01T00:00:00.000Z';

function rnode(
  id: string,
  kind: RelationshipEntityKind,
  over: Partial<RelationshipNode> = {},
): RelationshipNode {
  return {
    id,
    kind,
    key: id,
    label: `${kind} ${id}`,
    detail: 'detail',
    master: false,
    resolved: true,
    inDegree: 0,
    outDegree: 0,
    degree: 1,
    value: 100,
    activity: 5,
    risk: 20,
    health: 'healthy',
    lastUpdated: NOW,
    ...over,
  };
}

function redge(
  from: string,
  to: string,
  type: RelationshipType,
  over: Partial<RelationshipGraphEdge> = {},
): RelationshipGraphEdge {
  return {
    id: `${from}~${type}~${to}`,
    from,
    to,
    type,
    direction: 'out',
    confidence: 1,
    weight: 1,
    count: 2,
    strength: 7,
    activity: 3,
    risk: 15,
    health: 'healthy',
    lastUpdated: NOW,
    ...over,
  };
}

function model(nodes: RelationshipNode[], edges: RelationshipGraphEdge[]): RelationshipGraphModel {
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

describe('erpGraphBridge', () => {
  it('returns an empty projection for a null/undefined model', () => {
    expect(erpGraphBridge(null, NOW)).toEqual({ nodes: [], edges: [] });
    expect(erpGraphBridge(undefined, NOW)).toEqual({ nodes: [], edges: [] });
  });

  it('namespaces every node id and maps business kinds to graph node types', () => {
    const m = model(
      [
        rnode('c1', 'customer'),
        rnode('s1', 'supplier'),
        rnode('m1', 'machine'),
        rnode('wo1', 'workOrder'),
        rnode('inv1', 'invoice'),
      ],
      [],
    );
    const { nodes } = erpGraphBridge(m, NOW);
    const byId = new Map(nodes.map((n) => [n.id, n]));

    // Every id is prefixed so it can never collide with a UDM unified id.
    expect(nodes.every((n) => n.id.startsWith(ERP_NODE_PREFIX))).toBe(true);
    expect(byId.get('erp:c1')?.type).toBe('customer');
    expect(byId.get('erp:s1')?.type).toBe('vendor');
    expect(byId.get('erp:m1')?.type).toBe('machine');
    expect(byId.get('erp:wo1')?.type).toBe('work_order');
    expect(byId.get('erp:inv1')?.type).toBe('invoice');

    // Provenance: sourceKind records the business kind, sourceId keeps the raw record id.
    expect(byId.get('erp:c1')?.sourceKind).toBe('erp:customer');
    expect(byId.get('erp:c1')?.sourceId).toBe('c1');
    // Business facts are carried in metadata for the entity-360 view.
    expect(byId.get('erp:c1')?.metadata).toMatchObject({ kind: 'customer', risk: 20, health: 'healthy' });
  });

  it('maps ERP relations onto the knowledge-graph edge vocabulary, preserving the relation + evidence', () => {
    const m = model(
      [
        rnode('c1', 'customer'),
        rnode('o1', 'order'),
        rnode('inv1', 'invoice'),
        rnode('wo1', 'workOrder'),
        rnode('m1', 'machine'),
        rnode('p1', 'product'),
        rnode('w1', 'warehouse'),
        rnode('d1', 'decision'),
      ],
      [
        redge('c1', 'o1', 'places_order'), // → references
        redge('o1', 'inv1', 'order_to_invoice'), // → references
        redge('wo1', 'm1', 'maintained_by'), // → assigned_to
        redge('p1', 'm1', 'runs_on_machine'), // → depends_on
        redge('p1', 'w1', 'stocked_in'), // → belongs_to
        redge('d1', 'o1', 'decision_affects'), // → generated_by
      ],
    );
    const { edges } = erpGraphBridge(m, NOW);
    const byRelation = new Map(edges.map((e) => [e.metadata.relation, e]));

    expect(byRelation.get('places_order')?.type).toBe('references');
    expect(byRelation.get('order_to_invoice')?.type).toBe('references');
    expect(byRelation.get('maintained_by')?.type).toBe('assigned_to');
    expect(byRelation.get('runs_on_machine')?.type).toBe('depends_on');
    expect(byRelation.get('stocked_in')?.type).toBe('belongs_to');
    expect(byRelation.get('decision_affects')?.type).toBe('generated_by');

    // Endpoints are namespaced, and every edge cites its source relationship as evidence.
    const placesOrder = byRelation.get('places_order')!;
    expect(placesOrder.from).toBe('erp:c1');
    expect(placesOrder.to).toBe('erp:o1');
    expect(placesOrder.label).toBe('places_order');
    expect(placesOrder.evidence).toEqual({ kind: 'enterprise-relationship', id: 'c1~places_order~o1' });
  });
});
