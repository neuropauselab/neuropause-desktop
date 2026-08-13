/**
 * P14 — Autonomous Enterprise Intelligence service tests: composition, snapshot + projection
 * memoization, and invalidation.
 */
import { describe, expect, it } from 'vitest';
import { StrategyService } from './strategyService';
import type { StrategyState } from './strategyModel';

/**
 * P13C ROUND 3 — H-2. The memo is now keyed by tenant, so these tests must name
 * one. A fixed scope keeps every existing memoization assertion meaningful:
 * repeated reads under ONE tenant must still be O(1) cache hits, which is the
 * property this file was written to protect and the fix must not cost.
 */
const TEST_SCOPE = { tenantId: 'org-test', workspaceId: 'ws-test' };
const scope = (): typeof TEST_SCOPE => TEST_SCOPE;

function baseState(over: Partial<StrategyState> = {}): StrategyState {
  return {
    generatedAt: '2026-07-16T00:00:00.000Z',
    health: { overall: 70, band: 'watch', scores: [{ key: 'security', label: 'Security', score: 50, band: 'at-risk' }] },
    risk: { overall: 50, band: 'at-risk', byCategory: { security: 60 }, topRisks: [{ id: 'res:x', label: 'X', risk: 70, reason: 'r' }], confidence: 0.7 },
    dependencies: { spofs: 1, cycles: 0, bottlenecks: 1, criticalCount: 1, topSpofs: [{ id: 'res:x', label: 'X', blastRadius: 10 }] },
    capacity: { utilizationAvg: 50, costTotal: 500, pressureScore: 30, costOutliers: [] },
    incidents: { open: 1, total: 3 },
    recommendations: [],
    cloud: { monthlySpend: 100, currency: 'USD', quotas: [{ resource: 'Workers', used: 2, limit: 25, utilizationPct: 8 }], fleetStatus: 'healthy', deployments: 2, healthyDeployments: 2, regions: 1 },
    workforce: { totalWorkers: 10, overallSuccessRate: 0.85, bottlenecks: [], healthy: 9, degraded: 1, unhealthy: 0 },
    connectors: { total: 22, connected: 3, healthy: 3, degraded: 0, down: 0 },
    industry: { ready: 1, partial: 2, planned: 9, averageActivation: 0.2, entries: [] },
    marketplace: { published: 5, certified: 3, byKind: {} },
    compliance: { score: 80, band: 'healthy', frameworks: 10, failing: 1, passing: 9 },
    approvalChains: [{ id: 'chain-side-effect', appliesTo: 'workforce_side_effect', name: 'Side-effect approval', enabled: true, steps: [{ roleId: 'role-manager', order: 1 }] }],
    collaboration: [],
    ...over,
  };
}

describe('StrategyService', () => {
  it('composes every projection from the injected reader', () => {
    const svc = new StrategyService({ scope, readState: () => baseState() });
    expect(svc.overview().summary.goalsTotal).toBe(9);
    expect(svc.goals().goals).toHaveLength(9);
    expect(svc.planning().horizons).toHaveLength(5);
    expect(svc.reasoning().findings.length).toBeGreaterThan(0);
    expect(svc.optimization().count).toBeGreaterThan(0);
    expect(svc.simulation().scenarios).toHaveLength(3);
    expect(svc.decisions().count).toBeGreaterThan(0);
  });

  it('memoizes the snapshot + projections and recomposes only after invalidate()', () => {
    const box = { value: baseState() };
    let reads = 0;
    const svc = new StrategyService({ scope, readState: () => {
        reads += 1;
        return box.value;
      },
    });
    const g1 = svc.goals();
    expect(svc.goals()).toBe(g1); // same reference → O(1) cache hit
    expect(svc.optimization()).toBe(svc.optimization());
    expect(reads).toBe(1); // one composition across all reads

    box.value = baseState({ risk: { overall: 20, band: 'healthy', byCategory: {}, topRisks: [], confidence: 0.9 } });
    expect(svc.goals()).toBe(g1); // still cached
    svc.invalidate();
    expect(svc.goals()).not.toBe(g1); // recomposed
    expect(reads).toBe(2);
  });

  it('refreshes after the TTL even without invalidate() — fixes injected report/cloud staleness', () => {
    let clock = 1_000;
    let reads = 0;
    const svc = new StrategyService({ scope, readState: () => {
        reads += 1;
        return baseState();
      },
      ttlMs: 3000,
      now: () => clock,
    });
    svc.goals();
    svc.goals();
    expect(reads).toBe(1); // within the TTL window → cached
    clock += 3000; // the injected report/cloud may have changed without emitting a hooked event
    svc.goals();
    expect(reads).toBe(2); // snapshot recomposed on its own → Refresh reflects fresh upstream data
  });
});
