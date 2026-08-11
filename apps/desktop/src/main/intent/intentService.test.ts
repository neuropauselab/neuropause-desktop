/**
 * Intent Experience Program v2.0 — service tests: composition, snapshot + projection memoization,
 * invalidation, and the TTL freshness window.
 */
import { describe, expect, it } from 'vitest';
import { IntentService } from './intentService';
import type { IntentGoalInput, IntentState } from './intentModel';

/**
 * P13C ROUND 3 — H-2. The memo is now keyed by tenant, so these tests must name
 * one. A fixed scope keeps every existing memoization assertion meaningful:
 * repeated reads under ONE tenant must still be O(1) cache hits, which is the
 * property this file was written to protect and the fix must not cost.
 */
const TEST_SCOPE = { tenantId: 'org-test', workspaceId: 'ws-test' };
const scope = (): typeof TEST_SCOPE => TEST_SCOPE;

function goal(id: string, over: Partial<IntentGoalInput> = {}): IntentGoalInput {
  return {
    id, category: 'operational', name: `Goal ${id}`, description: 'd', horizon: '90d',
    successMetric: 'metric', target: 100, current: 50, unit: 'score', progress: 0.5, status: 'at_risk',
    objectives: [], dependencies: [], milestones: [], evidence: [], nextAction: null, relatedDecisions: [], ...over,
  };
}

function baseState(over: Partial<IntentState> = {}): IntentState {
  return { generatedAt: '2026-07-17T08:00:00.000Z', reasoningConfidence: 0.7, intents: [goal('goal-a')], ...over };
}

describe('IntentService', () => {
  it('composes every projection from the injected reader', () => {
    const svc = new IntentService({ scope, readState: () => baseState() });
    expect(svc.board().intents).toHaveLength(1);
    expect(svc.board().roleViews).toHaveLength(10);
    expect(svc.workspaces().workspaces).toHaveLength(1);
    expect(svc.governance().intentScope).toBe('intent:read');
  });

  it('memoizes the snapshot + projections and recomposes only after invalidate()', () => {
    const box = { value: baseState() };
    let reads = 0;
    const svc = new IntentService({ scope, readState: () => {
        reads += 1;
        return box.value;
      },
    });
    const b1 = svc.board();
    expect(svc.board()).toBe(b1); // same reference → O(1) cache hit
    expect(svc.workspaces()).toBe(svc.workspaces());
    expect(reads).toBe(1);

    box.value = baseState({ reasoningConfidence: 0.99 });
    expect(svc.board()).toBe(b1); // still cached
    svc.invalidate();
    expect(svc.board()).not.toBe(b1); // recomposed
    expect(svc.board().reasoningConfidence).toBeCloseTo(0.99);
    expect(reads).toBe(2);
  });

  it('refreshes after the TTL even without invalidate() — fixes injected platform staleness', () => {
    let clock = 1_000;
    let reads = 0;
    const svc = new IntentService({ scope, readState: () => {
        reads += 1;
        return baseState();
      },
      ttlMs: 3000,
      now: () => clock,
    });
    svc.board();
    svc.board();
    expect(reads).toBe(1); // within TTL → cached
    clock += 3000;
    svc.board();
    expect(reads).toBe(2); // recomposed on its own
  });
});
