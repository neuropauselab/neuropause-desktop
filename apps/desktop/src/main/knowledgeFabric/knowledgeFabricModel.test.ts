/**
 * P16 — Enterprise Knowledge Fabric model tests. Pure projections over a composed platform snapshot:
 * source catalog, entity relationships, classification, lineage, the unified evidence/explanation model,
 * governance posture, and analytics — plus the load-bearing invariants (evidence resolution enriches,
 * top-entity identities are redacted to aggregate metrics, deterministic, never throws on empty).
 */
import { describe, expect, it } from 'vitest';
import type { PlatformEvent, TimelinePage } from '@neuropause/shared';
import {
  buildExplanationInputs,
  buildFabricAnalytics,
  buildFabricClassification,
  buildFabricEvidence,
  buildFabricGovernance,
  buildFabricLineage,
  buildFabricOverview,
  buildFabricRelationships,
  buildFabricSources,
  buildFabricSummary,
  buildLineage,
  confidenceBand,
  resolveEvidenceRef,
  scoreBand,
  type FabricState,
} from './knowledgeFabricModel';

function state(over: Partial<FabricState> = {}): FabricState {
  return {
    generatedAt: '2026-07-16T00:00:00.000Z',
    sources: [
      { id: 'graph', name: 'Enterprise Graph', category: 'graph', entityCount: 1200, live: true, provenance: 'P7 Intelligence', permission: 'intelligence:read', note: 'x' },
      { id: 'memory', name: 'AI Memory', category: 'corpus', entityCount: 300, live: true, provenance: 'Memory', permission: 'memory:read', note: 'x' },
      { id: 'industry', name: 'Industry Packs', category: 'catalog', entityCount: 0, live: true, provenance: 'P13', permission: 'industry:read', note: 'x' },
    ],
    corpus: {
      total: 300,
      withEntities: 250,
      byKind: [{ key: 'decision', count: 40 }, { key: 'document', count: 120 }, { key: 'note', count: 140 }],
      bySource: [{ key: 'github', count: 100 }, { key: 'manual', count: 200 }],
      topTags: [{ tag: 'q3', count: 30 }, { tag: 'risk', count: 20 }],
      tagCount: 12,
      retention: [{ key: 'fresh', count: 50 }, { key: 'stale', count: 100 }],
      sensitivity: [{ key: 'restricted', count: 40 }, { key: 'general', count: 140 }],
      topics: 18,
      coveragePercent: 72,
      orphanCount: 84,
      avgEntitiesPerMemory: 2.4,
      largestTopicSize: 22,
    },
    relationships: {
      nodes: 500,
      edges: 1400,
      relationshipHealth: 78,
      averageDegree: 3.234,
      criticalEdges: 5,
      highRiskEdges: 12,
      disconnected: 3,
      byKind: [{ key: 'customer', count: 120 }, { key: 'order', count: 200 }],
      byType: [{ key: 'places_order', count: 180 }, { key: 'order_to_invoice', count: 150 }],
      byHealth: [{ key: 'strong', count: 300 }, { key: 'weak', count: 60 }],
      topEntities: [
        { kind: 'customer', label: 'Acme Corp', degree: 42, health: 'strong' },
        { kind: 'supplier', label: 'Globex', degree: 18, health: 'weak' },
      ],
      narrative: { grounded: true },
    },
    graph: { nodes: 1200, edges: 3400, byDomain: [{ key: 'finance', count: 300 }, { key: 'operations', count: 200 }], crossDomainEdges: 220 },
    explanations: [
      { id: 'dec:d1', kind: 'decision', subject: 'Migrate DB', reasoning: 'lower cost', sources: ['Strategy Platform', 'Cloud Control Plane'], evidence: ['res:db-1', 'health:cost'], confidence: 0.82, approvalAware: true },
      { id: 'rec:r1', kind: 'recommendation', subject: 'Patch CVE', reasoning: 'security', sources: ['Enterprise Intelligence'], evidence: ['incident:i1'], confidence: 0.6, approvalAware: false },
      { id: 'twin:security', kind: 'twin', subject: 'Security', reasoning: '2 findings', sources: ['Digital Twin'], evidence: ['health:security'], confidence: 0.45, approvalAware: false },
      { id: 'kpi:enterprise.health.overall', kind: 'kpi', subject: 'Health', reasoning: '72/100', sources: ['Enterprise Intelligence'], evidence: ['enterprise.health.overall'], confidence: 0.9, approvalAware: false },
    ],
    lineage: {
      stages: [
        { stage: 'origin', label: 'Origin', count: 40, signals: ['record.created'], note: 'x' },
        { stage: 'transformation', label: 'Transformation', count: 25, signals: ['record.updated'], note: 'x' },
        { stage: 'usage', label: 'Usage', count: 60, signals: ['knowledge'], note: 'x' },
        { stage: 'consumers', label: 'Consumers', count: 15, signals: ['causationId'], note: 'x' },
      ],
      chains: [
        { correlationRef: 'abc12345…', events: 5, categories: ['enterprise', 'connector'], since: 'S', until: 'U' },
        { correlationRef: 'def67890…', events: 2, categories: ['knowledge'], since: 'S', until: 'U' },
      ],
      totalEvents: 140,
      windowDays: 90,
    },
    health: { overall: 72, band: 'watch' },
    kpis: [
      { key: 'enterprise.health.overall', label: 'Health', value: 72, display: '72/100', band: 'watch' },
      { key: 'strategy.goals.onTrack', label: 'Goals', value: 33, display: '3/9', band: 'at-risk' },
    ],
    knownDomains: ['finance', 'operations'],
    ...over,
  };
}

function emptyState(): FabricState {
  return {
    generatedAt: '2026-07-16T00:00:00.000Z',
    sources: [],
    corpus: { total: 0, withEntities: 0, byKind: [], bySource: [], topTags: [], tagCount: 0, retention: [], sensitivity: [], topics: 0, coveragePercent: 0, orphanCount: 0, avgEntitiesPerMemory: 0, largestTopicSize: 0 },
    relationships: { nodes: 0, edges: 0, relationshipHealth: 0, averageDegree: 0, criticalEdges: 0, highRiskEdges: 0, disconnected: 0, byKind: [], byType: [], byHealth: [], topEntities: [], narrative: { grounded: false } },
    graph: { nodes: 0, edges: 0, byDomain: [], crossDomainEdges: 0 },
    explanations: [],
    lineage: { stages: [], chains: [], totalEvents: 0, windowDays: 90 },
    health: { overall: 0, band: 'critical' },
    kpis: [],
    knownDomains: [],
  };
}

describe('resolveEvidenceRef — the enrichment (raw id → semantic knowledge ref)', () => {
  it('classifies each ref by prefix into its originating system', () => {
    expect(resolveEvidenceRef('health:cost', [])).toMatchObject({ kind: 'signal', sourceSystem: 'Enterprise Intelligence', label: 'Cost' });
    expect(resolveEvidenceRef('incident:i1', [])).toMatchObject({ kind: 'incident', sourceSystem: 'Enterprise Intelligence' });
    expect(resolveEvidenceRef('industry:mfg', [])).toMatchObject({ kind: 'industry', sourceSystem: 'Industry Platform' });
    expect(resolveEvidenceRef('cloud:us-east', [])).toMatchObject({ kind: 'cloud', sourceSystem: 'Cloud Control Plane' });
    expect(resolveEvidenceRef('finance', ['finance'])).toMatchObject({ kind: 'domain', sourceSystem: 'Enterprise Graph' });
    expect(resolveEvidenceRef('decision:EXD-42', [])).toMatchObject({ kind: 'entity', sourceSystem: 'Relationship Graph' }); // decision is a relationship kind
    expect(resolveEvidenceRef('mystery:x', [])).toMatchObject({ kind: 'other', sourceSystem: 'Platform' });
  });

  it('SECURITY: redacts entity-ref identities — never the entity key/name', () => {
    const res = resolveEvidenceRef('res:db-1', ['finance']);
    expect(res).toMatchObject({ kind: 'entity', sourceSystem: 'Enterprise Graph', label: 'Resource' }); // not 'Db 1'
    const cust = resolveEvidenceRef('customer:Acme', []);
    expect(cust).toMatchObject({ kind: 'entity', sourceSystem: 'Relationship Graph', label: 'Customer' }); // not 'Acme'
    expect(cust.id).not.toContain('Acme');
    expect(cust.label).not.toContain('Acme');
  });
});

describe('band helpers', () => {
  it('maps confidence (0..1) and score (0..100) to bands with empty reading watch not critical', () => {
    expect(confidenceBand(0.8)).toBe('healthy');
    expect(confidenceBand(0.6)).toBe('watch');
    expect(confidenceBand(0.3)).toBe('at-risk');
    expect(confidenceBand(0.1)).toBe('critical');
    expect(scoreBand(80)).toBe('healthy');
    expect(scoreBand(60)).toBe('watch');
    expect(scoreBand(30)).toBe('at-risk');
    expect(scoreBand(10)).toBe('critical');
  });
});

describe('buildFabricSources', () => {
  it('projects sources with contribution %, live count, and sorted by entity count', () => {
    const c = buildFabricSources(state());
    expect(c.total).toBe(3);
    expect(c.liveCount).toBe(3);
    expect(c.totalEntities).toBe(1500);
    expect(c.sources[0].id).toBe('graph'); // largest first
    expect(c.sources[0].contributionPercent).toBe(80); // 1200/1500
    const industry = c.sources.find((s) => s.id === 'industry')!;
    expect(industry.contributionPercent).toBe(0);
    expect(industry.band).toBe('watch'); // 0 entities → watch, not a false green
  });
});

describe('buildFabricRelationships', () => {
  it('projects aggregate distributions + a fabric-generated summary from the relationship graph', () => {
    const r = buildFabricRelationships(state());
    expect(r.nodes).toBe(500);
    expect(r.edges).toBe(1400);
    expect(r.averageDegree).toBe(3.23); // rounded to 2dp
    expect(r.byType[0].key).toBe('places_order'); // sorted by count desc
    expect(r.narrative.summary).toMatch(/500 entities/); // aggregate, generated — NOT the model's named prose
    expect(r.narrative.grounded).toBe(true);
  });

  it('SECURITY: top-entity names are redacted to kind + rank (no business/personal identities)', () => {
    const r = buildFabricRelationships(state());
    expect(r.topEntities).toHaveLength(2);
    expect(Object.keys(r.topEntities[0]).sort()).toEqual(['band', 'degree', 'kind', 'label']); // no value/risk/health/key/detail
    expect(r.topEntities[0]).toMatchObject({ kind: 'customer', label: 'Customer #1', degree: 42, band: 'healthy' }); // strong → healthy, name redacted
    expect(r.topEntities[1].band).toBe('watch'); // weak → watch
    for (const e of r.topEntities) expect(e.label).not.toMatch(/Acme|Globex/); // no upstream entity names
  });
});

describe('buildFabricClassification', () => {
  it('classifies the corpus by kind/domain/source/tags/retention/sensitivity', () => {
    const c = buildFabricClassification(state());
    expect(c.byKind.map((x) => x.key)).toContain('note');
    expect(c.byDomain[0].key).toBe('finance'); // graph domains, sorted
    expect(c.topTags[0].tag).toBe('q3');
    expect(c.sensitivity.map((x) => x.key)).toContain('restricted');
    expect(c.retention.map((x) => x.key)).toContain('fresh');
  });
});

describe('buildFabricLineage', () => {
  it('projects the four lineage stages and correlation chains (redacted)', () => {
    const l = buildFabricLineage(state());
    expect(l.stages.map((s) => s.stage)).toEqual(['origin', 'transformation', 'usage', 'consumers']);
    expect(l.totalEvents).toBe(140);
    expect(l.windowDays).toBe(90);
    expect(l.chains[0].events).toBe(5); // sorted by events desc
    expect(l.chains[0].correlationRef).toMatch(/…$/); // redacted to a short correlation ref
  });
});

describe('buildFabricEvidence — the unified Evidence/Sources/Reasoning/Confidence model', () => {
  it('projects every subject with resolved evidence, confidence band, and coverage', () => {
    const e = buildFabricEvidence(state());
    expect(e.total).toBe(4);
    expect(e.explanations[0].id).toBe('kpi:enterprise.health.overall'); // sorted by confidence desc (0.9)
    // The decision's raw evidence ids are resolved into semantic knowledge refs (the fabric's value).
    const dec = e.explanations.find((x) => x.id === 'dec:d1')!;
    expect(dec.evidence.map((r) => r.sourceSystem)).toEqual(['Enterprise Graph', 'Enterprise Intelligence']);
    expect(dec.confidenceBand).toBe('healthy'); // 0.82
    expect(dec.approvalAware).toBe(true);
    expect(e.evidenceCoverage).toBe(100); // all 4 carry evidence
    expect(e.avgConfidence).toBeCloseTo(0.69, 2);
    expect(e.byKind.some((k) => k.key === 'decision')).toBe(true);
  });
});

describe('buildFabricGovernance', () => {
  it('projects the RBAC posture (per-source scope) and inherited redactions — no new governance', () => {
    const g = buildFabricGovernance(state());
    expect(g.fabricScope).toBe('knowledge:read');
    expect(g.scopes.find((s) => s.source === 'Enterprise Graph')!.permission).toBe('intelligence:read');
    expect(g.scopes.every((s) => s.auditable)).toBe(true);
    expect(g.redactions.length).toBeGreaterThanOrEqual(3);
  });
});

describe('buildFabricAnalytics', () => {
  it('computes coverage, explanation coverage, and confidence distribution', () => {
    const a = buildFabricAnalytics(state());
    expect(a.knowledgeCoverage).toBe(72);
    expect(a.explanationCoverage).toBe(100);
    const healthy = a.confidenceDistribution.find((b) => b.band === 'healthy')!;
    expect(healthy.count).toBe(2); // 0.9 + 0.82
    expect(a.sourceContribution[0].source).toBe('Enterprise Graph');
    expect(a.overallHealth).toBe(72);
  });
});

describe('buildFabricSummary + overview', () => {
  it('summarizes the fabric and bundles the projections', () => {
    const o = buildFabricOverview(state());
    expect(o.summary.totalEntities).toBe(1500);
    expect(o.summary.sourceCount).toBe(3);
    expect(o.summary.relationships).toBe(1400);
    expect(o.summary.explanations).toBe(4);
    expect(o.summary.evidenceCoverage).toBe(100);
    expect(o.summary.semanticTags).toBe(12);
    expect(o.sources.total).toBe(3);
    expect(o.relationships.byKind.length).toBe(2);
    expect(o.classification.byDomain.length).toBe(2);
    expect(o.analytics.knowledgeCoverage).toBe(72);
    expect(o.kpis).toHaveLength(2);
  });

  it('never throws on an empty enterprise and stays deterministic', () => {
    expect(() => buildFabricOverview(emptyState())).not.toThrow();
    expect(() => buildFabricEvidence(emptyState())).not.toThrow();
    expect(() => buildFabricLineage(emptyState())).not.toThrow();
    expect(buildFabricSummary(emptyState()).evidenceCoverage).toBe(0);
    expect(buildFabricOverview(state())).toEqual(buildFabricOverview(state()));
  });
});

describe('honesty + adversarial hardening', () => {
  it('excludes signal sources (timeline events) from the entity total and contribution', () => {
    const c = buildFabricSources(
      state({
        sources: [
          { id: 'graph', name: 'Enterprise Graph', category: 'graph', entityCount: 1000, live: true, provenance: 'x', permission: 'intelligence:read', note: 'x' },
          { id: 'timeline', name: 'Timeline', category: 'signal', entityCount: 5000, live: true, provenance: 'x', permission: 'intelligence:read', note: 'x' },
        ],
      }),
    );
    expect(c.totalEntities).toBe(1000); // 5000 timeline events are NOT counted as entities
    expect(c.sources.find((x) => x.id === 'timeline')!.contributionPercent).toBe(0);
    expect(c.sources.find((x) => x.id === 'graph')!.contributionPercent).toBe(100);
    expect(c.sources[0].id).toBe('graph'); // contribution-first sort: 100% before 0%
  });

  it('confidence band uses the DISPLAYED (rounded) value at boundaries', () => {
    const e = buildFabricEvidence(state({ explanations: [{ id: 'x', kind: 'goal', subject: 'G', reasoning: '', sources: [], evidence: [], confidence: 0.748, approvalAware: false }] }));
    expect(e.explanations[0].confidence).toBe(0.75);
    expect(e.explanations[0].confidenceBand).toBe('healthy'); // rounded 0.75 → healthy, not the raw-0.748 'watch'
  });
});

describe('buildLineage (pure timeline filter)', () => {
  const ev = (over: Partial<PlatformEvent>): PlatformEvent =>
    ({ id: 'e', type: 'x', category: 'enterprise', priority: 'normal', timestamp: '2026-07-15T10:00:00Z', source: 's', correlationId: '', causationId: null, ...over } as unknown as PlatformEvent);

  it('partitions events into exactly four stages and builds redacted correlation chains', () => {
    const events = [
      ev({ type: 'enterprise.record.created', correlationId: 'corr-ABCDEFGH1', causationId: null }),
      ev({ type: 'enterprise.record.updated', correlationId: 'corr-ABCDEFGH1', causationId: null, timestamp: '2026-07-15T11:00:00Z' }),
      ev({ type: 'knowledge.linked', category: 'knowledge', causationId: 'up-1' }),
      ev({ type: 'knowledge.viewed', category: 'knowledge', causationId: null }),
    ];
    const query = (): TimelinePage => ({ events, nextCursor: null, total: 42 } as TimelinePage);
    const l = buildLineage(query, 'S', 'U', 90);
    const byStage = new Map(l.stages.map((s) => [s.stage, s.count]));
    expect(byStage.get('origin')).toBe(1); // created
    expect(byStage.get('transformation')).toBe(1); // updated (matched before the causation check)
    expect(byStage.get('consumers')).toBe(1); // has causationId, no create/update in type
    expect(byStage.get('usage')).toBe(1); // plain knowledge event
    expect(l.stages.reduce((n, s) => n + s.count, 0)).toBe(4); // a true partition
    expect(l.totalEvents).toBe(42); // reflects the FULL total, not the sample
    expect(l.chains).toHaveLength(1); // one multi-event correlation
    expect(l.chains[0].events).toBe(2);
    expect(l.chains[0].correlationRef).toMatch(/…$/); // redacted correlation ref
  });

  it('degrades to empty when the timeline query throws', () => {
    const l = buildLineage(() => { throw new Error('boom'); }, 'S', 'U', 90);
    expect(l.totalEvents).toBe(0);
    expect(l.stages.reduce((n, s) => n + s.count, 0)).toBe(0);
  });
});

describe('buildExplanationInputs (pure)', () => {
  it('projects KPIs into explanations (null strategy/twin safe) with derived confidence + source', () => {
    const out = buildExplanationInputs(null, null, [
      { key: 'enterprise.health.overall', label: 'Health', value: 80, display: '80/100', band: 'healthy' },
      { key: 'strategy.savings', label: 'Savings', value: null, display: 'USD 100' },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ kind: 'kpi', id: 'kpi:enterprise.health.overall', confidence: 0.9 }); // healthy band → 0.9
    expect(out[0].sources).toEqual(['Enterprise Intelligence']);
    expect(out[1].sources).toEqual(['Strategy Platform']); // key prefix → system
  });
});
