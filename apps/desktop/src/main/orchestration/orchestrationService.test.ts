/**
 * P17 — Global AI Orchestration service tests: composition, snapshot + projection memoization,
 * invalidation, and the TTL freshness window.
 */
import { describe, expect, it } from 'vitest';
import { GlobalOrchestrationService } from './orchestrationService';
import type { OrchestrationState } from './orchestrationModel';

/**
 * P13C ROUND 3 — H-2. The memo is now keyed by tenant, so these tests must name
 * one. A fixed scope keeps every existing memoization assertion meaningful:
 * repeated reads under ONE tenant must still be O(1) cache hits, which is the
 * property this file was written to protect and the fix must not cost.
 */
const TEST_SCOPE = { tenantId: 'org-test', workspaceId: 'ws-test' };
const scope = (): typeof TEST_SCOPE => TEST_SCOPE;

function baseState(over: Partial<OrchestrationState> = {}): OrchestrationState {
  return {
    generatedAt: '2026-07-16T00:00:00.000Z',
    health: { overall: 70, band: 'watch' },
    routeSteps: [{ id: 's1', label: 'Optimize workflow', action: 'optimize_workflow', approvalGoverned: true, approvalChain: 'Ops', approvalSteps: 1, evidenceCount: 2 }],
    candidates: [{ id: 'w1', name: '', role: 'operations', trustScore: 0.8, healthState: 'healthy', lifecycle: 'idle', grantedScopes: [] }],
    workforce: { summaries: [{ role: 'operations', lifecycle: 'idle', trustScore: 0.8 }], activeWorkers: 1, inFlight: 2, overallSuccessRate: 0.9, bottlenecks: [], orgs: [{ orgId: 'o1', orgName: 'NeuroPause', units: 5, workers: 8 }] },
    cloud: { fleetStatus: 'healthy', fleetScore: 90, regions: [{ id: 'us', name: 'US', available: true, deployments: 2, healthyDeployments: 2, replication: 'in_sync', health: 'healthy' }], deployments: [{ service: 'api', region: 'us', status: 'healthy', gate: 'ok', uptimePct: 99 }], quotas: [{ resource: 'compute', utilizationPct: 40 }], monthlySpend: 100, currency: 'USD' },
    knowledge: { explanations: 10, evidenceCoverage: 80, avgConfidence: 0.7, byKind: [{ kind: 'decision', count: 10, avgConfidence: 0.7 }], lineageStages: [{ stage: 'origin', count: 5 }] },
    marketplace: { published: 3, certified: 2, total: 5, installs: 40 },
    federation: { peers: 1, activePeers: 1, trustedPeers: 1, canShareWorkers: 1, sharedOut: 1, sharedIn: 0 },
    industry: { live: true },
    developer: { live: true },
    kpis: [{ key: 'enterprise.health.overall', label: 'Health', value: 70, display: '70/100', band: 'watch' }],
    ...over,
  };
}

describe('GlobalOrchestrationService', () => {
  it('composes every projection from the injected reader', () => {
    const svc = new GlobalOrchestrationService({ scope, readState: () => baseState() });
    expect(svc.overview().summary.orchestrators).toBe(9);
    expect(svc.goals().total).toBe(1);
    expect(svc.workforce().pools).toHaveLength(1);
    expect(svc.cloud().regions).toHaveLength(1);
    expect(svc.knowledge().explanations).toBe(10);
    expect(svc.flows().flows).toHaveLength(6);
    expect(svc.coordination().systems).toHaveLength(4);
    expect(svc.governance().orchestrationScope).toBe('orchestration:read');
  });

  it('memoizes the snapshot + projections and recomposes only after invalidate()', () => {
    const box = { value: baseState() };
    let reads = 0;
    const svc = new GlobalOrchestrationService({ scope, readState: () => {
        reads += 1;
        return box.value;
      },
    });
    const g1 = svc.goals();
    expect(svc.goals()).toBe(g1); // same reference → O(1) cache hit
    expect(svc.overview()).toBe(svc.overview());
    expect(reads).toBe(1);

    box.value = baseState({ routeSteps: [] });
    expect(svc.goals()).toBe(g1); // still cached
    svc.invalidate();
    expect(svc.goals()).not.toBe(g1); // recomposed
    expect(reads).toBe(2);
  });

  it('refreshes after the TTL even without invalidate() — fixes injected strategy/cloud staleness', () => {
    let clock = 1_000;
    let reads = 0;
    const svc = new GlobalOrchestrationService({ scope, readState: () => {
        reads += 1;
        return baseState();
      },
      ttlMs: 3000,
      now: () => clock,
    });
    svc.overview();
    svc.overview();
    expect(reads).toBe(1); // within TTL → cached
    clock += 3000; // upstream strategy/cloud/knowledge may have changed with no hooked event
    svc.overview();
    expect(reads).toBe(2); // recomposed on its own
  });
});
