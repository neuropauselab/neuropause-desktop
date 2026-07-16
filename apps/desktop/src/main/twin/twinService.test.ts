/**
 * P15 — Enterprise Digital Twin service tests: composition, snapshot + projection memoization,
 * invalidation, and the TTL freshness window.
 */
import { describe, expect, it } from 'vitest';
import { TwinService } from './twinService';
import type { TwinState } from './twinModel';

const PROJ = { costUsd: 0, riskScore: 0, timeDays: 0, resourceUtilizationPct: 0, complianceScore: 0, probabilityPct: 0 };

function baseState(over: Partial<TwinState> = {}): TwinState {
  return {
    generatedAt: '2026-07-16T00:00:00.000Z',
    org: { orgs: 1, units: 5, users: 10, humans: 2, workers: 8 },
    cloud: { deployments: 3, healthyDeployments: 3, regions: 2, fleetStatus: 'healthy', fleetScore: 90, monthlySpend: 100, currency: 'USD' },
    workforce: { total: 10, healthy: 9, degraded: 1, unhealthy: 0, state: 'healthy', successRate: 0.9 },
    application: { deployments: 3, healthy: 3, avgUptimePct: 99 },
    connectors: { total: 22, connected: 3, healthy: 3, degraded: 0, down: 0 },
    marketplace: { published: 5, certified: 3, total: 8 },
    federation: { peers: 1, activePeers: 1, trustedPeers: 1 },
    strategy: { goalsTotal: 9, goalsOnTrack: 5, overallProgress: 0.6, openDecisions: 2, requiresApproval: 2, healthBand: 'watch' },
    health: { overall: 78, band: 'healthy', scores: [{ key: 'security', label: 'Security', score: 60, band: 'watch', factors: [] }], byKey: { security: 60 } },
    risk: { overall: 40, band: 'watch' },
    graph: { nodes: 500, edges: 1200, byDomain: { infrastructure: 200, finance: 300 }, crossDomainEdges: 50, truncated: false },
    dependencies: { criticalCount: 1, cyclic: false, spofs: [{ domain: 'infrastructure', blastRadius: 10, dependents: 4, risk: 60 }], failureChains: [], cycles: [] },
    reportKpis: [{ key: 'enterprise.health.overall', label: 'Health', value: 78, display: '78/100', band: 'healthy' }],
    strategyKpis: [{ key: 'strategy.goals.onTrack', label: 'Goals', value: 55, display: '5/9', band: 'watch' }],
    simulation: { baseline: { id: 'baseline', name: 'Baseline', description: '', focus: 'baseline', projected: PROJ, deltaVsBaseline: PROJ, evidence: [], applied: false }, scenarios: [], comparison: [], note: '' },
    replay: [],
    ...over,
  };
}

describe('TwinService', () => {
  it('composes every projection from the injected reader', () => {
    const svc = new TwinService({ readState: () => baseState() });
    expect(svc.overview().summary.domainCount).toBe(8);
    expect(svc.domains().domains).toHaveLength(9);
    expect(svc.topology().nodes).toHaveLength(2);
    expect(svc.health().entries).toHaveLength(1);
    expect(svc.replay().windows).toHaveLength(0);
    expect(svc.scenario().simulation.baseline.applied).toBe(false);
    expect(svc.impact().nodes).toHaveLength(1);
    expect(svc.executive().twins).toHaveLength(6);
  });

  it('memoizes the snapshot + projections and recomposes only after invalidate()', () => {
    const box = { value: baseState() };
    let reads = 0;
    const svc = new TwinService({
      readState: () => {
        reads += 1;
        return box.value;
      },
    });
    const d1 = svc.domains();
    expect(svc.domains()).toBe(d1); // same reference → O(1) cache hit
    expect(svc.topology()).toBe(svc.topology());
    expect(reads).toBe(1);

    box.value = baseState({ cloud: { deployments: 9, healthyDeployments: 9, regions: 5, fleetStatus: 'healthy', fleetScore: 95, monthlySpend: 200, currency: 'USD' } });
    expect(svc.domains()).toBe(d1); // still cached
    svc.invalidate();
    expect(svc.domains()).not.toBe(d1); // recomposed
    expect(reads).toBe(2);
  });

  it('refreshes after the TTL even without invalidate() — fixes injected report/cloud/timeline staleness', () => {
    let clock = 1_000;
    let reads = 0;
    const svc = new TwinService({
      readState: () => {
        reads += 1;
        return baseState();
      },
      ttlMs: 3000,
      now: () => clock,
    });
    svc.domains();
    svc.domains();
    expect(reads).toBe(1); // within the TTL → cached
    clock += 3000; // upstream report/cloud/strategy/timeline may have changed with no hooked event
    svc.domains();
    expect(reads).toBe(2); // recomposed on its own
  });
});
