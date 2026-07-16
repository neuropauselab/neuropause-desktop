/**
 * P18 — Enterprise Intelligence Network model tests. Pure projections over a composed, sanitized
 * snapshot: knowledge + recommendation exchange, benchmark exchange, insight registry, trust exchange,
 * organization + collective intelligence, and governance — plus the CARDINAL invariant (no raw enterprise
 * record ever appears: evidence is reduced to ref kinds, restricted knowledge is held back), deterministic
 * and never-throws-on-empty.
 */
import { describe, expect, it } from 'vitest';
import {
  bandFor,
  buildIntelNetworkBenchmarks,
  buildIntelNetworkCollective,
  buildIntelNetworkExchange,
  buildIntelNetworkGovernance,
  buildIntelNetworkInsights,
  buildIntelNetworkOrganizations,
  buildIntelNetworkOverview,
  buildIntelNetworkTrust,
  buildNetworkModules,
  buildIntelNetworkSummary,
  confBand,
  trustBand,
  type IntelNetworkState,
} from './networkModel';

function state(over: Partial<IntelNetworkState> = {}): IntelNetworkState {
  return {
    generatedAt: '2026-07-16T00:00:00.000Z',
    health: { overall: 72, band: 'watch' },
    recommendations: [
      { id: 'rec:1', category: 'recommendation', title: 'Patch CVE', detail: 'apply security patch', confidence: 0.85, sources: ['Enterprise Intelligence'], evidenceKinds: ['incident', 'signal'], shareable: true },
      { id: 'rec:2', category: 'reasoning', title: 'Uncertain risk', detail: 'low confidence', confidence: 0.2, sources: ['Strategy Platform'], evidenceKinds: ['signal'], shareable: false },
    ],
    patterns: [
      { key: 'kind:decision', label: 'Decision', count: 40, dimension: 'kind' },
      { key: 'domain:finance', label: 'Finance', count: 30, dimension: 'domain' },
      { key: 'tag:q3', label: 'q3', count: 20, dimension: 'tag' },
    ],
    restrictedCount: 40,
    orgMetrics: [
      { key: 'coverage', label: 'Knowledge coverage', value: 72, band: 'watch', dimension: 'coverage' },
      { key: 'readiness', label: 'Enterprise readiness', value: 80, band: 'healthy', dimension: 'readiness' },
      { key: 'explanation', label: 'Explanation coverage', value: 60, band: 'watch', dimension: 'explanation' },
    ],
    industryRef: [
      { key: 'industry.platform.coverage', label: 'Industry coverage', value: 65, band: 'watch', dimension: 'coverage' },
      { key: 'industry.platform.ready', label: 'Industry ready', value: 85, band: 'healthy', dimension: 'readiness' },
    ],
    registry: [
      { id: 'artifact:a1', kind: 'knowledge_package', name: 'Best practices', summary: 'x', scope: 'partner', source: 'exchange', verification: 'verified', local: true, installs: 12 },
      { id: 'pack:p1', kind: 'knowledge', name: 'ICP pack', summary: 'y', scope: 'pack', source: 'pack', verification: 'local', local: true, installs: 5 },
      { id: 'listing:l1', kind: 'enterprise_template', name: 'SOC2 pack', summary: 'z', scope: 'published', source: 'marketplace', verification: 'certified', local: true, installs: 30 },
    ],
    exchangeSummary: { artifacts: 3, published: 2, verified: 1, installs: 47 },
    trust: [
      { peer: 'Acme Partners', trustLevel: 'full', canShareData: true, canShareWorkers: true, delegatedApproval: true },
      { peer: 'Globex', trustLevel: 'basic', canShareData: false, canShareWorkers: false, delegatedApproval: false },
    ],
    fedSummary: { orgs: 3, peers: 2, activePeers: 1, trustedPeers: 1, sharedOut: 3, sharedIn: 2 },
    policies: [{ name: 'Default share policy', scope: 'trusted', effect: 'require_approval', action: 'share_data', enabled: true }],
    openApprovals: 1,
    redactions: ['Entity identities redacted', 'Lineage redacted', 'SPOF redacted'],
    kpis: [{ key: 'enterprise.health.overall', label: 'Health', value: 72, display: '72/100', band: 'watch' }],
    ...over,
  };
}

function emptyState(): IntelNetworkState {
  return {
    generatedAt: '2026-07-16T00:00:00.000Z',
    health: { overall: 0, band: 'critical' },
    recommendations: [],
    patterns: [],
    restrictedCount: 0,
    orgMetrics: [],
    industryRef: [],
    registry: [],
    exchangeSummary: { artifacts: 0, published: 0, verified: 0, installs: 0 },
    trust: [],
    fedSummary: { orgs: 0, peers: 0, activePeers: 0, trustedPeers: 0, sharedOut: 0, sharedIn: 0 },
    policies: [],
    openApprovals: 0,
    redactions: [],
    kpis: [],
  };
}

describe('band helpers', () => {
  it('maps scores/confidence/trust to bands with the universal cutoff', () => {
    expect(bandFor(80)).toBe('healthy');
    expect(bandFor(60)).toBe('watch');
    expect(bandFor(30)).toBe('at-risk');
    expect(bandFor(10)).toBe('critical');
    expect(confBand(0.85)).toBe('healthy');
    expect(confBand(0.2)).toBe('critical');
    expect(trustBand('full')).toBe('healthy');
    expect(trustBand('basic')).toBe('at-risk');
    expect(trustBand('none')).toBe('critical');
  });
});

describe('buildIntelNetworkExchange — governed, sanitized intelligence', () => {
  it('projects sanitized recommendations + patterns, holding back restricted knowledge', () => {
    const e = buildIntelNetworkExchange(state());
    expect(e.recommendations).toHaveLength(2);
    expect(e.recommendations[0].confidence).toBe(0.85); // sorted by confidence desc
    expect(e.recommendations[0].id).toMatch(/^rec:[a-z0-9]+$/); // synthetic id — the raw id is never projected
    expect(e.recommendations[0].id).not.toBe('rec:1'); // raw id replaced, not passed through
    expect(e.recommendations[0].band).toBe('healthy'); // 0.85
    expect(e.shareableCount).toBe(1); // rec:2 (low confidence) not shareable
    expect(e.restrictedCount).toBe(40); // restricted-sensitivity knowledge surfaced but never exchanged
    expect(e.patterns).toHaveLength(3);
  });

  it('CARDINAL: no raw enterprise record — evidence is reduced to ref KINDS only, never ids/keys', () => {
    const e = buildIntelNetworkExchange(state());
    for (const r of e.recommendations) {
      // evidenceKinds are lowercase kind tokens (signal/incident/domain/…) — never entity ids/keys/labels.
      for (const k of r.evidenceKinds) expect(k).toMatch(/^[a-z]+$/);
      expect(Object.keys(r)).not.toContain('evidence'); // the raw FabricEvidenceRef[] is NOT re-exported
      expect(Object.keys(r)).not.toContain('entityId');
      expect(Object.keys(r)).not.toContain('records');
    }
    // Patterns are aggregate counts only.
    for (const p of e.patterns) expect(typeof p.count).toBe('number');
    // The whole serialized payload carries no obvious raw-record marker.
    expect(JSON.stringify(e)).not.toMatch(/customer:|erp:|order:|res:[a-z0-9-]+\b/i);
  });

  it('CARDINAL: raw entity NAMES/IDS in the upstream recommendation text NEVER reach the exchange projection', () => {
    // Upstream P7 recommendations compose free-text from raw graph labels ("Add redundancy for <SPOF label>")
    // and ids that embed raw entity/resource ids ("reco:spof:erp:customer:<id>"). The exchange must sanitize.
    const leaky = state({
      recommendations: [
        {
          id: 'reco:spof:erp:customer:00150ABC',
          category: 'recommendation',
          title: 'Add redundancy for Acme Corporation Production Database',
          detail: 'Top contributor: Globex Industries Invoice INV-88213 — critical health.',
          confidence: 0.85,
          sources: ['Enterprise Intelligence'],
          evidenceKinds: ['signal'],
          shareable: true,
        },
      ],
    });
    const e = buildIntelNetworkExchange(leaky);
    const json = JSON.stringify(e);
    // No raw entity name, invoice id, resource/entity id, or raw id prefix survives into the projection.
    for (const marker of ['Acme Corporation', 'Globex Industries', 'INV-88213', 'erp:customer', '00150ABC', 'reco:spof']) {
      expect(json).not.toContain(marker);
    }
    // …yet the recommendation is still surfaced — in governed, entity-free form.
    expect(e.recommendations).toHaveLength(1);
    expect(e.recommendations[0].shareable).toBe(true);
    expect(e.recommendations[0].id).toMatch(/^rec:[a-z0-9]+$/);
    expect(e.recommendations[0].title).toBe('Recommendation · high confidence');
  });
});

describe('buildIntelNetworkBenchmarks — org vs industry', () => {
  it('pairs org metrics to the industry reference and computes position', () => {
    const b = buildIntelNetworkBenchmarks(state());
    const coverage = b.rows.find((r) => r.metric === 'coverage')!;
    expect(coverage.orgValue).toBe(72);
    expect(coverage.industryValue).toBe(65);
    expect(coverage.delta).toBe(7);
    expect(coverage.position).toBe('above');
    const readiness = b.rows.find((r) => r.metric === 'readiness')!;
    expect(readiness.position).toBe('below'); // 80 vs 85
    const explanation = b.rows.find((r) => r.metric === 'explanation')!;
    expect(explanation.industryValue).toBe(75); // no dim match → industry baseline (65+85)/2
    expect(b.aboveCount).toBe(1);
    expect(b.belowCount).toBe(2);
    expect(b.overallPosition).toBe('below');
  });
});

describe('buildIntelNetworkInsights — catalog registry', () => {
  it('projects the exchange artifacts / packs / templates as catalog entries', () => {
    const i = buildIntelNetworkInsights(state());
    expect(i.total).toBe(3);
    expect(i.entries[0].id).toBe('listing:l1'); // sorted by installs desc (30)
    expect(i.published).toBe(3); // all local
    expect(i.byKind.length).toBeGreaterThan(0);
    // Catalog only — no payload/items fields leak into a registry entry.
    for (const e of i.entries) expect(Object.keys(e)).not.toContain('items');
  });
});

describe('buildIntelNetworkTrust + organizations', () => {
  it('projects the federation consent model', () => {
    const t = buildIntelNetworkTrust(state());
    expect(t.peers).toHaveLength(2);
    expect(t.peers.find((p) => p.peer === 'Acme Partners')!.band).toBe('healthy'); // full
    expect(t.peers.find((p) => p.peer === 'Globex')!.band).toBe('at-risk'); // basic
    expect(t.dataSharingPeers).toBe(1); // only Acme can share data
    expect(t.openApprovals).toBe(1);
    expect(t.policies).toHaveLength(1);
    const o = buildIntelNetworkOrganizations(state());
    expect(o.organizations.find((x) => x.peer === 'Acme Partners')!.canExchange).toBe(true);
    expect(o.organizations.find((x) => x.peer === 'Globex')!.canExchange).toBe(false);
  });
});

describe('buildIntelNetworkCollective + governance + modules', () => {
  it('aggregates network-wide intelligence', () => {
    const c = buildIntelNetworkCollective(state());
    expect(c.totalArtifacts).toBe(3); // registry (1 exchange + 1 pack + 1 template), counted once — not double-counted
    expect(c.totalInstalls).toBe(47);
    expect(c.benchmarkPosition).toBe('below');
    expect(c.networkHealth).toBe(72);
    // Shareable-intelligence trend: value + band derive from the SAME 0..100 ratio (1 of 2 recs shareable → 50).
    const shareable = c.trends.find((t) => t.key === 'shareable')!;
    expect(shareable.value).toBe(50);
    expect(shareable.band).toBe('watch');
  });

  it('benchmark module is not falsely healthy when nothing is benchmarked', () => {
    const s = state({ industryRef: [] }); // org metrics present but no industry reference → all unbenchmarked
    expect(buildIntelNetworkBenchmarks(s).overallPosition).toBe('unbenchmarked');
    const bm = buildNetworkModules(s).find((x) => x.id === 'benchmark-exchange')!;
    expect(bm.band).toBe('watch'); // not a false 'healthy'
  });

  it('governance asserts never-share-raw and reuses the fabric redaction proof', () => {
    const g = buildIntelNetworkGovernance(state());
    expect(g.networkScope).toBe('network:read');
    expect(g.neverShareRaw).toMatch(/no raw enterprise/i);
    expect(g.redactions).toHaveLength(3); // reused from the Knowledge Fabric
    expect(g.scopes.length).toBe(5);
    expect(g.policies).toHaveLength(1);
  });

  it('projects the seven exchange modules', () => {
    const m = buildNetworkModules(state());
    expect(m).toHaveLength(7);
    expect(m.map((x) => x.id).sort()).toEqual(['benchmark-exchange', 'collective-intelligence', 'insight-registry', 'knowledge-exchange', 'org-intelligence', 'recommendation-exchange', 'trust-exchange']);
    for (const x of m) expect(x.source.length).toBeGreaterThan(0); // every module is traceable
  });
});

describe('buildIntelNetworkSummary + overview', () => {
  it('summarizes the network and bundles the projections', () => {
    const o = buildIntelNetworkOverview(state());
    expect(o.summary.modules).toBe(7);
    expect(o.summary.shareableIntelligence).toBe(4); // 1 shareable rec + 3 patterns
    expect(o.summary.publishedInsights).toBe(3);
    expect(o.summary.trustedPeers).toBe(1);
    expect(o.summary.dataSharingPeers).toBe(1);
    expect(o.summary.benchmarkPosition).toBe('below');
    expect(o.modules).toHaveLength(7);
    expect(o.kpis).toHaveLength(1);
  });

  it('never throws on an empty network and stays deterministic', () => {
    expect(() => buildIntelNetworkOverview(emptyState())).not.toThrow();
    expect(() => buildIntelNetworkBenchmarks(emptyState())).not.toThrow();
    expect(() => buildIntelNetworkCollective(emptyState())).not.toThrow();
    expect(buildIntelNetworkSummary(emptyState()).shareableIntelligence).toBe(0);
    expect(buildIntelNetworkBenchmarks(emptyState()).overallPosition).toBe('unbenchmarked');
    expect(buildIntelNetworkOverview(state())).toEqual(buildIntelNetworkOverview(state()));
  });
});
