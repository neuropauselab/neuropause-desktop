/**
 * P16 — Enterprise Knowledge Fabric service tests: composition, snapshot + projection memoization,
 * invalidation, and the TTL freshness window.
 */
import { describe, expect, it } from 'vitest';
import { KnowledgeFabricService } from './knowledgeFabricService';
import type { FabricState } from './knowledgeFabricModel';

/**
 * P13C ROUND 4 — F4. The composed cache is tenant-keyed, so this fixture names a
 * tenant. Every memoization and TTL assertion below keeps its meaning: repeated
 * reads under ONE tenant must still be a single composition.
 */
const TEST_SCOPE = { tenantId: 'org-test', workspaceId: 'ws-test' };
const scope = (): typeof TEST_SCOPE => TEST_SCOPE;

function baseState(over: Partial<FabricState> = {}): FabricState {
  return {
    generatedAt: '2026-07-16T00:00:00.000Z',
    sources: [
      { id: 'graph', name: 'Enterprise Graph', category: 'graph', entityCount: 100, live: true, provenance: 'P7', permission: 'intelligence:read', note: 'x' },
      { id: 'memory', name: 'AI Memory', category: 'corpus', entityCount: 40, live: true, provenance: 'Memory', permission: 'memory:read', note: 'x' },
    ],
    corpus: { total: 40, withEntities: 30, byKind: [{ key: 'note', count: 40 }], bySource: [{ key: 'manual', count: 40 }], topTags: [{ tag: 'q3', count: 5 }], tagCount: 3, retention: [{ key: 'fresh', count: 40 }], sensitivity: [{ key: 'general', count: 40 }], topics: 4, coveragePercent: 60, orphanCount: 16, avgEntitiesPerMemory: 1.5, largestTopicSize: 8 },
    relationships: { nodes: 50, edges: 120, relationshipHealth: 70, averageDegree: 2.4, criticalEdges: 1, highRiskEdges: 2, disconnected: 0, byKind: [{ key: 'customer', count: 20 }], byType: [{ key: 'places_order', count: 30 }], byHealth: [{ key: 'strong', count: 40 }], topEntities: [{ kind: 'customer', label: 'Acme', degree: 10, health: 'strong' }], narrative: { grounded: true } },
    graph: { nodes: 100, edges: 240, byDomain: [{ key: 'finance', count: 60 }], crossDomainEdges: 12 },
    explanations: [{ id: 'dec:d1', kind: 'decision', subject: 'X', reasoning: 'y', sources: ['Strategy Platform'], evidence: ['res:a'], confidence: 0.8, approvalAware: false }],
    lineage: { stages: [{ stage: 'origin', label: 'Origin', count: 5, signals: ['record.created'], note: 'x' }], chains: [], totalEvents: 5, windowDays: 90 },
    health: { overall: 70, band: 'watch' },
    kpis: [{ key: 'enterprise.health.overall', label: 'Health', value: 70, display: '70/100', band: 'watch' }],
    knownDomains: ['finance'],
    ...over,
  };
}

describe('KnowledgeFabricService', () => {
  it('composes every projection from the injected reader', () => {
    const svc = new KnowledgeFabricService({ scope, readState: () => baseState() });
    expect(svc.overview().summary.sourceCount).toBe(2);
    expect(svc.sources().total).toBe(2);
    expect(svc.relationships().nodes).toBe(50);
    expect(svc.classification().byDomain).toHaveLength(1);
    expect(svc.lineage().stages).toHaveLength(1);
    expect(svc.evidence().total).toBe(1);
    expect(svc.governance().fabricScope).toBe('knowledge:read');
    expect(svc.analytics().knowledgeCoverage).toBe(60);
  });

  it('memoizes the snapshot + projections and recomposes only after invalidate()', () => {
    const box = { value: baseState() };
    let reads = 0;
    const svc = new KnowledgeFabricService({ scope, readState: () => {
        reads += 1;
        return box.value;
      },
    });
    const s1 = svc.sources();
    expect(svc.sources()).toBe(s1); // same reference → O(1) cache hit
    expect(svc.evidence()).toBe(svc.evidence());
    expect(reads).toBe(1);

    box.value = baseState({ sources: [] });
    expect(svc.sources()).toBe(s1); // still cached
    svc.invalidate();
    expect(svc.sources()).not.toBe(s1); // recomposed
    expect(reads).toBe(2);
  });

  it('refreshes after the TTL even without invalidate() — fixes injected report/relationship staleness', () => {
    let clock = 1_000;
    let reads = 0;
    const svc = new KnowledgeFabricService({ scope, readState: () => {
        reads += 1;
        return baseState();
      },
      ttlMs: 3000,
      now: () => clock,
    });
    svc.overview();
    svc.overview();
    expect(reads).toBe(1); // within TTL → cached
    clock += 3000; // upstream report/relationship/strategy/twin may have changed with no hooked event
    svc.overview();
    expect(reads).toBe(2); // recomposed on its own
  });
});
