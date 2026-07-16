/**
 * P19 — Autonomous Enterprise Operations service tests: composition, snapshot + projection memoization,
 * invalidation, and the TTL freshness window.
 */
import { describe, expect, it } from 'vitest';
import { AutonomousOperationsService } from './autoOpsService';
import type { AutoOpsState } from './autoOpsModel';

function baseState(over: Partial<AutoOpsState> = {}): AutoOpsState {
  return {
    generatedAt: '2026-07-16T00:00:00.000Z',
    health: { overall: 70, band: 'watch' },
    planSeeds: [{ id: 'p:1', category: 'operational', title: 'X', reason: 'y', risk: 'low', confidence: 0.8, evidenceKinds: ['risk'], evidenceCount: 1, expectedOutcome: 'z', sources: ['Enterprise Intelligence'], approvalTrigger: 'workforce_side_effect' }],
    execution: { active: [], awaiting: [], history: [], total: 3, completed: 2, failed: 1 },
    supervisorRecoveries: [],
    escalations: [],
    recoveryCount: 0,
    recentFailures: 0,
    recoverySeeds: [{ id: 'r:1', kind: 'retry', target: 't', reason: 'r', risk: 'medium', confidence: 0.6, sources: ['Workforce Runtime'], approvalTrigger: 'workforce_side_effect' }],
    optSeeds: [{ id: 'o:1', area: 'cloud', title: 'T', detail: 'd', potentialSavingUsd: 100, confidence: 0.7, risk: 'low', evidenceKinds: ['optimization'], recommendedAction: 'a', approvalTrigger: 'spend' }],
    incidents: [{ id: 'i:1', title: 'I', severity: 'warning', blastRadius: 3, confidence: 0.6, rootCause: null, recommendedActions: ['fix'], open: true }],
    pendingApprovals: [{ id: 'a:1', source: 'workforce', title: 'A', risk: 'medium', requestedBy: 'u', status: 'awaiting_approval', approvalTrigger: 'workforce_side_effect' }],
    chains: [{ name: 'C', appliesTo: 'spend', steps: 1, enabled: true }],
    monitorSignals: [{ dimension: 'health', label: 'Health', value: 70, display: '70/100', detail: 'ok', source: 'P7' }],
    autoAllowedTriggers: [],
    auditSources: ['Workforce audit (0)'],
    redactions: ['redacted'],
    kpis: [{ key: 'ops.health', label: 'Health', value: 70, display: '70/100', band: 'watch' }],
    ...over,
  };
}

describe('AutonomousOperationsService', () => {
  it('composes every projection from the injected reader', () => {
    const svc = new AutonomousOperationsService({ readState: () => baseState() });
    expect(svc.overview().summary.modules).toBe(7);
    expect(svc.plans().plans).toHaveLength(1);
    expect(svc.execution().throughput).toBe(3);
    expect(svc.recovery().recommendations).toHaveLength(1);
    expect(svc.optimization().count).toBe(1);
    expect(svc.incidents().total).toBe(1);
    expect(svc.approvals().pendingCount).toBe(1);
    expect(svc.monitoring().signals).toHaveLength(1);
    expect(svc.analytics().planCount).toBe(1);
    expect(svc.governance().opsScope).toBe('autonomousops:read');
  });

  it('memoizes the snapshot + projections and recomposes only after invalidate()', () => {
    const box = { value: baseState() };
    let reads = 0;
    const svc = new AutonomousOperationsService({
      readState: () => {
        reads += 1;
        return box.value;
      },
    });
    const p1 = svc.plans();
    expect(svc.plans()).toBe(p1); // same reference → O(1) cache hit
    expect(svc.overview()).toBe(svc.overview());
    expect(reads).toBe(1);

    box.value = baseState({ planSeeds: [] });
    expect(svc.plans()).toBe(p1); // still cached
    svc.invalidate();
    expect(svc.plans()).not.toBe(p1); // recomposed
    expect(reads).toBe(2);
  });

  it('refreshes after the TTL even without invalidate() — fixes injected execution/supervisor staleness', () => {
    let clock = 1_000;
    let reads = 0;
    const svc = new AutonomousOperationsService({
      readState: () => {
        reads += 1;
        return baseState();
      },
      ttlMs: 3000,
      now: () => clock,
    });
    svc.overview();
    svc.overview();
    expect(reads).toBe(1); // within TTL → cached
    clock += 3000; // upstream execution/supervisor/intelligence may have changed with no hooked event
    svc.overview();
    expect(reads).toBe(2); // recomposed on its own
  });
});
