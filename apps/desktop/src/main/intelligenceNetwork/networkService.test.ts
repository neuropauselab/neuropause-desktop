/**
 * P18 — Enterprise Intelligence Network service tests: composition, snapshot + projection memoization,
 * invalidation, and the TTL freshness window.
 */
import { describe, expect, it } from 'vitest';
import { EnterpriseIntelligenceNetworkService } from './networkService';
import type { IntelNetworkState } from './networkModel';

/**
 * P13C ROUND 3 — H-2. The memo is now keyed by tenant, so these tests must name
 * one. A fixed scope keeps every existing memoization assertion meaningful:
 * repeated reads under ONE tenant must still be O(1) cache hits, which is the
 * property this file was written to protect and the fix must not cost.
 */
const TEST_SCOPE = { tenantId: 'org-test', workspaceId: 'ws-test' };
const scope = (): typeof TEST_SCOPE => TEST_SCOPE;

function baseState(over: Partial<IntelNetworkState> = {}): IntelNetworkState {
  return {
    generatedAt: '2026-07-16T00:00:00.000Z',
    health: { overall: 70, band: 'watch' },
    recommendations: [{ id: 'rec:1', category: 'recommendation', title: 'X', detail: 'y', confidence: 0.8, sources: ['Enterprise Intelligence'], evidenceKinds: ['signal'], shareable: true }],
    patterns: [{ key: 'kind:decision', label: 'Decision', count: 10, dimension: 'kind' }],
    restrictedCount: 5,
    orgMetrics: [{ key: 'coverage', label: 'Coverage', value: 70, band: 'watch', dimension: 'coverage' }],
    industryRef: [{ key: 'industry.platform.coverage', label: 'Industry coverage', value: 60, band: 'watch', dimension: 'coverage' }],
    registry: [{ id: 'artifact:a1', kind: 'knowledge_package', name: 'BP', summary: 'x', scope: 'public', source: 'exchange', verification: 'verified', local: true, installs: 3 }],
    exchangeSummary: { artifacts: 1, published: 1, verified: 1, installs: 3 },
    trust: [{ peer: 'Acme', trustLevel: 'full', canShareData: true, canShareWorkers: true, delegatedApproval: true }],
    fedSummary: { orgs: 2, peers: 1, activePeers: 1, trustedPeers: 1, sharedOut: 1, sharedIn: 0 },
    policies: [{ name: 'P', scope: 'trusted', effect: 'allow', action: 'share', enabled: true }],
    openApprovals: 0,
    redactions: ['Entity identities redacted'],
    kpis: [{ key: 'enterprise.health.overall', label: 'Health', value: 70, display: '70/100', band: 'watch' }],
    ...over,
  };
}

describe('EnterpriseIntelligenceNetworkService', () => {
  it('composes every projection from the injected reader', () => {
    const svc = new EnterpriseIntelligenceNetworkService({ scope, readState: () => baseState() });
    expect(svc.overview().summary.modules).toBe(7);
    expect(svc.exchange().recommendations).toHaveLength(1);
    expect(svc.benchmarks().rows).toHaveLength(1);
    expect(svc.insights().total).toBe(1);
    expect(svc.trust().peers).toHaveLength(1);
    expect(svc.organizations().organizations).toHaveLength(1);
    expect(svc.collective().totalInstalls).toBe(3);
    expect(svc.governance().networkScope).toBe('network:read');
  });

  it('memoizes the snapshot + projections and recomposes only after invalidate()', () => {
    const box = { value: baseState() };
    let reads = 0;
    const svc = new EnterpriseIntelligenceNetworkService({ scope, readState: () => {
        reads += 1;
        return box.value;
      },
    });
    const e1 = svc.exchange();
    expect(svc.exchange()).toBe(e1); // same reference → O(1) cache hit
    expect(svc.overview()).toBe(svc.overview());
    expect(reads).toBe(1);

    box.value = baseState({ recommendations: [] });
    expect(svc.exchange()).toBe(e1); // still cached
    svc.invalidate();
    expect(svc.exchange()).not.toBe(e1); // recomposed
    expect(reads).toBe(2);
  });

  it('refreshes after the TTL even without invalidate() — fixes injected knowledge/industry staleness', () => {
    let clock = 1_000;
    let reads = 0;
    const svc = new EnterpriseIntelligenceNetworkService({ scope, readState: () => {
        reads += 1;
        return baseState();
      },
      ttlMs: 3000,
      now: () => clock,
    });
    svc.overview();
    svc.overview();
    expect(reads).toBe(1); // within TTL → cached
    clock += 3000; // upstream knowledge/industry/twin may have changed with no hooked event
    svc.overview();
    expect(reads).toBe(2); // recomposed on its own
  });
});
