import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExecutiveRecommendation } from '@neuropause/shared';
import {
  DecisionStore,
  canTransition,
  decisionFromRecommendation,
  summarizeDecisions,
} from './decisionStore';

function rec(over: Partial<ExecutiveRecommendation> = {}): ExecutiveRecommendation {
  return {
    id: 'rec:engineering',
    metric: 'engineering',
    icon: 'code',
    problem: 'Engineering Health is critical (35/100).',
    businessImpact: 'Delivery risk rises.',
    rootCause: 'CI failures.',
    priority: 'critical',
    confidence: 0.9,
    expectedOutcome: 'Restored delivery.',
    evidence: ['engineering=35/100'],
    sourceSystems: ['organization'],
    recommendedAction: 'Triage failing CI.',
    owner: 'Engineering Lead',
    eta: 'today',
    status: 'open',
    score: 1190,
    ...over,
  };
}

describe('decision lifecycle helpers', () => {
  it('canTransition enforces the legal lifecycle', () => {
    expect(canTransition('suggested', 'accepted')).toBe(true);
    expect(canTransition('accepted', 'in_progress')).toBe(true);
    expect(canTransition('in_progress', 'completed')).toBe(true);
    expect(canTransition('completed', 'archived')).toBe(true);
    // illegal jumps
    expect(canTransition('suggested', 'completed')).toBe(false);
    expect(canTransition('archived', 'accepted')).toBe(false);
    expect(canTransition('completed', 'in_progress')).toBe(false);
  });

  it('decisionFromRecommendation preserves traceability + maps fields', () => {
    const d = decisionFromRecommendation(rec(), '2026-01-10T00:00:00.000Z', 'engineering-1');
    expect(d.id).toBe('dec:engineering-1');
    expect(d.fromRecommendationId).toBe('rec:engineering');
    expect(d.status).toBe('suggested');
    expect(d.category).toBe('engineering');
    expect(d.title).toBe('Triage failing CI.');
    expect(d.businessImpact).toBe('Delivery risk rises.');
    expect(d.evidence).toEqual(['engineering=35/100']);
  });

  it('maps recommendation metrics to decision categories', () => {
    expect(decisionFromRecommendation(rec({ metric: 'governance' }), 'x', 'a').category).toBe(
      'governance',
    );
    expect(decisionFromRecommendation(rec({ metric: 'adoption' }), 'x', 'b').category).toBe(
      'growth',
    );
    expect(decisionFromRecommendation(rec({ metric: 'connectorHealth' }), 'x', 'c').category).toBe(
      'operations',
    );
  });

  it('summarizeDecisions counts by status + ranks top by priority', () => {
    const now = '2026-01-10T00:00:00.000Z';
    const decisions = [
      {
        ...decisionFromRecommendation(rec({ priority: 'low' }), now, 'a'),
        status: 'suggested' as const,
      },
      {
        ...decisionFromRecommendation(rec({ priority: 'critical' }), now, 'b'),
        status: 'accepted' as const,
      },
      { ...decisionFromRecommendation(rec(), now, 'c'), status: 'completed' as const },
      { ...decisionFromRecommendation(rec(), now, 'd'), status: 'archived' as const },
    ];
    const v = summarizeDecisions(decisions);
    expect(v.total).toBe(3); // archived excluded
    expect(v.pending).toBe(1);
    expect(v.accepted).toBe(1);
    expect(v.completed).toBe(1);
    expect(v.top[0].priority).toBe('critical'); // ranked first
  });
});

describe('DecisionStore', () => {
  let dir: string;
  let store: DecisionStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'np-dec-'));
    store = new DecisionStore(join(dir, 'executive-decisions.json'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('creates and reads back a decision', async () => {
    const d = decisionFromRecommendation(rec(), new Date().toISOString(), 'x1');
    await store.create(d);
    expect(store.all()).toHaveLength(1);
    expect(store.get('dec:x1')?.title).toBe('Triage failing CI.');
  });

  it('transitions status only along legal paths', async () => {
    const d = decisionFromRecommendation(rec(), new Date().toISOString(), 'x2');
    await store.create(d);
    // suggested → accepted (legal)
    const ok = await store.setStatus('dec:x2', 'accepted', new Date().toISOString());
    expect(ok?.status).toBe('accepted');
    // accepted → completed (legal)
    const done = await store.setStatus('dec:x2', 'completed', new Date().toISOString());
    expect(done?.status).toBe('completed');
    // completed → in_progress (illegal) → null, status unchanged
    const bad = await store.setStatus('dec:x2', 'in_progress', new Date().toISOString());
    expect(bad).toBeNull();
    expect(store.get('dec:x2')?.status).toBe('completed');
  });

  it('setStatus returns null for unknown id', async () => {
    expect(await store.setStatus('dec:nope', 'accepted', new Date().toISOString())).toBeNull();
  });

  it('persists across instances', async () => {
    const d = decisionFromRecommendation(rec(), new Date().toISOString(), 'x3');
    await store.create(d);
    const reopened = new DecisionStore(join(dir, 'executive-decisions.json'));
    expect(reopened.all()).toHaveLength(1);
    expect(reopened.summary().pending).toBe(1);
  });
});
