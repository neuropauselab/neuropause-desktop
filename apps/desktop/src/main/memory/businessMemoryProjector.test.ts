/**
 * P2.5 — business-memory projector tests.
 *
 * Verifies the ERP relationship model is distilled into grounded, reference-only
 * memories: critical dependencies, broken links, and disconnected master assets —
 * each pointing at real relationship-graph entities (`entityRefs`) and citing the
 * source edge/node (`evidence`), with deterministic ids so re-projection replaces
 * rather than duplicates, and severity caps that keep memory high-signal.
 */
import { describe, expect, it } from 'vitest';
import type {
  RelationshipEntityKind,
  RelationshipGraphEdge,
  RelationshipGraphModel,
  RelationshipHealth,
  RelationshipNode,
  RelationshipType,
} from '@neuropause/shared';
import { projectBusinessMemory } from './businessMemoryProjector';

const NOW = '2026-03-01T00:00:00.000Z';

function rnode(id: string, kind: RelationshipEntityKind, over: Partial<RelationshipNode> = {}): RelationshipNode {
  return {
    id,
    kind,
    key: id.split(':').slice(1).join(':') || id,
    label: id.split(':').slice(1).join(':') || id,
    detail: '',
    master: false,
    resolved: true,
    inDegree: 0,
    outDegree: 0,
    degree: 1,
    value: 0,
    activity: 0,
    risk: 0,
    health: 'healthy',
    lastUpdated: NOW,
    ...over,
  };
}
function redge(
  from: string,
  to: string,
  type: RelationshipType,
  health: RelationshipHealth,
  risk: number,
): RelationshipGraphEdge {
  return {
    id: `${from}|${to}|${type}`,
    from,
    to,
    type,
    direction: 'out',
    confidence: 1,
    weight: 1,
    count: 1,
    strength: 5,
    activity: 10,
    risk,
    health,
    lastUpdated: NOW,
  };
}
function model(over: Partial<RelationshipGraphModel>): RelationshipGraphModel {
  return {
    generatedAtMs: 0,
    nodes: [],
    edges: [],
    insights: {} as RelationshipGraphModel['insights'],
    kpis: [],
    counts: { nodes: 0, edges: 0, byKind: {}, byHealth: {} },
    criticalEdges: [],
    highRiskEdges: [],
    disconnected: [],
    topEntities: [],
    narrative: {} as RelationshipGraphModel['narrative'],
    ...over,
  };
}

describe('projectBusinessMemory', () => {
  it('returns nothing for a null/undefined model', () => {
    expect(projectBusinessMemory(null, NOW)).toEqual([]);
    expect(projectBusinessMemory(undefined, NOW)).toEqual([]);
  });

  it('memorializes critical dependencies, broken links, and disconnected assets — all reference-only', () => {
    const nodes = [
      rnode('customer:Acme', 'customer', { label: 'Acme' }),
      rnode('order:SO-1', 'order', { label: 'SO-1' }),
      rnode('invoice:INV-1', 'invoice', { label: 'INV-1' }),
      rnode('customer:Ghost', 'customer', { label: 'Ghost', resolved: false, health: 'broken' }),
      rnode('machine:M1', 'machine', { label: 'M1', master: true, degree: 0, health: 'dormant' }),
    ];
    const critical = redge('customer:Acme', 'order:SO-1', 'places_order', 'critical', 82);
    const brokenEdge = redge('invoice:INV-1', 'customer:Ghost', 'billed_invoice', 'broken', 0);
    const m = model({
      nodes,
      edges: [critical, brokenEdge],
      criticalEdges: [critical],
      disconnected: [nodes[4]],
    });

    const items = projectBusinessMemory(m, NOW);
    const byId = new Map(items.map((i) => [i.id, i]));

    // One of each category.
    expect(items).toHaveLength(3);
    expect(items.every((i) => i.origin === 'projected' && i.kind === 'relationship')).toBe(true);

    const crit = byId.get(`mem:erp:rel:${critical.id}`)!;
    expect(crit.title).toBe('Critical dependency: Acme → SO-1');
    expect(crit.entityRefs).toEqual(['customer:Acme', 'order:SO-1']); // relationship node ids — findable by the Context Engine
    expect(crit.evidence).toEqual({ kind: 'enterprise-relationship', id: critical.id });
    expect(crit.tags).toContain('critical');

    const broke = byId.get(`mem:erp:rel:${brokenEdge.id}`)!;
    expect(broke.title).toBe('Broken link: INV-1 → Ghost');
    expect(broke.tags).toContain('broken');

    const disc = byId.get('mem:erp:ent:machine:M1')!;
    expect(disc.title).toBe('Disconnected machine: M1');
    expect(disc.entityRefs).toEqual(['machine:M1']);
    expect(disc.evidence).toEqual({ kind: 'erp:machine', id: 'machine:M1' });
  });

  it('caps critical dependencies to keep memory high-signal', () => {
    const nodes: RelationshipNode[] = [];
    const criticalEdges: RelationshipGraphEdge[] = [];
    for (let i = 0; i < 40; i += 1) {
      nodes.push(rnode(`customer:C${i}`, 'customer'), rnode(`order:O${i}`, 'order'));
      criticalEdges.push(redge(`customer:C${i}`, `order:O${i}`, 'places_order', 'critical', 90 - i));
    }
    const items = projectBusinessMemory(model({ nodes, edges: criticalEdges, criticalEdges }), NOW);
    // 40 critical edges → capped at 24.
    expect(items).toHaveLength(24);
  });
});
