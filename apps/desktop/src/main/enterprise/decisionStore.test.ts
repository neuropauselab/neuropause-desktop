import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  primaryNextStatus,
  isOverdue,
  isStale,
  type ExecutiveDecision,
  type ExecutiveRecommendation,
} from '@neuropause/shared';
import { TEST_TENANT_SCOPE } from '../tenancy/testScope';
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
    store = new DecisionStore(join(dir, 'executive-decisions.json')).bindScope(() => TEST_TENANT_SCOPE);
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
    const reopened = new DecisionStore(join(dir, 'executive-decisions.json')).bindScope(() => TEST_TENANT_SCOPE);
    expect(reopened.all()).toHaveLength(1);
    expect(reopened.summary().pending).toBe(1);
  });
});

describe('primaryNextStatus (V3.5)', () => {
  it('advances along the lifecycle', () => {
    expect(primaryNextStatus('suggested')).toEqual({ to: 'accepted', label: 'Accept' });
    expect(primaryNextStatus('accepted')).toEqual({ to: 'in_progress', label: 'Start' });
    expect(primaryNextStatus('in_progress')).toEqual({ to: 'completed', label: 'Complete' });
  });
  it('returns null for terminal states', () => {
    expect(primaryNextStatus('completed')).toBeNull();
    expect(primaryNextStatus('rejected')).toBeNull();
    expect(primaryNextStatus('archived')).toBeNull();
  });
  it('every non-null primary transition is legal per the store', () => {
    for (const st of ['draft', 'suggested', 'accepted', 'in_progress'] as const) {
      const n = primaryNextStatus(st);
      if (n) expect(canTransition(st, n.to)).toBe(true);
    }
  });
});

describe('V3.6 decision model extensions', () => {
  const DAY = 86_400_000;
  let dir: string;
  let store: DecisionStore;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'np-dec6-'));
    store = new DecisionStore(join(dir, 'executive-decisions.json')).bindScope(() => TEST_TENANT_SCOPE);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('records a created event on creation and status events on transition', async () => {
    const d = decisionFromRecommendation(rec(), new Date().toISOString(), 'h1');
    expect(d.history?.[0].kind).toBe('created');
    await store.create(d);
    await store.setStatus('dec:h1', 'accepted', new Date().toISOString(), { actor: 'CEO' });
    const after = store.get('dec:h1')!;
    expect(after.history).toHaveLength(2);
    const last = after.history![1];
    expect(last.kind).toBe('status_changed');
    expect(last.previousState).toBe('suggested');
    expect(last.newState).toBe('accepted');
    expect(last.actor).toBe('CEO');
  });

  it('supports blocked → resumed with reason + timestamps', async () => {
    const d = decisionFromRecommendation(rec(), new Date().toISOString(), 'h2');
    await store.create(d);
    await store.setStatus('dec:h2', 'accepted', new Date().toISOString());
    await store.setStatus('dec:h2', 'in_progress', new Date().toISOString());
    const blocked = await store.setStatus('dec:h2', 'blocked', new Date().toISOString(), {
      reason: 'waiting on legal',
    });
    expect(blocked?.status).toBe('blocked');
    expect(blocked?.blockedReason).toBe('waiting on legal');
    expect(blocked?.history?.at(-1)?.kind).toBe('blocked');
    const resumed = await store.setStatus('dec:h2', 'in_progress', new Date().toISOString());
    expect(resumed?.blockedReason).toBeUndefined();
    expect(resumed?.history?.at(-1)?.kind).toBe('resumed');
  });

  it('sets completedAt / archivedAt on terminal transitions', async () => {
    const d = decisionFromRecommendation(rec(), new Date().toISOString(), 'h3');
    await store.create(d);
    await store.setStatus('dec:h3', 'accepted', new Date().toISOString());
    const done = await store.setStatus('dec:h3', 'completed', new Date().toISOString());
    expect(done?.completedAt).toBeTruthy();
    const arch = await store.setStatus('dec:h3', 'archived', new Date().toISOString());
    expect(arch?.archivedAt).toBeTruthy();
  });

  it('isOverdue / isStale detect the right decisions', () => {
    const now = Date.UTC(2026, 1, 1);
    const base = decisionFromRecommendation(rec(), new Date(now).toISOString(), 'o1');
    const overdue: ExecutiveDecision = {
      ...base,
      status: 'in_progress',
      dueDate: new Date(now - DAY).toISOString(),
    };
    const future: ExecutiveDecision = {
      ...base,
      status: 'in_progress',
      dueDate: new Date(now + DAY).toISOString(),
    };
    const completed: ExecutiveDecision = { ...overdue, status: 'completed' };
    expect(isOverdue(overdue, now)).toBe(true);
    expect(isOverdue(future, now)).toBe(false);
    expect(isOverdue(completed, now)).toBe(false); // terminal → not overdue
    const stale: ExecutiveDecision = {
      ...base,
      status: 'accepted',
      updatedAt: new Date(now - 20 * DAY).toISOString(),
    };
    expect(isStale(stale, now)).toBe(true);
    expect(isStale(base, now)).toBe(false);
  });

  it('summary counts overdue and blocked', async () => {
    const now = Date.now();
    const a = decisionFromRecommendation(rec(), new Date(now).toISOString(), 's1');
    await store.create({ ...a, status: 'in_progress', dueDate: new Date(now - DAY).toISOString() });
    const b = decisionFromRecommendation(rec(), new Date(now).toISOString(), 's2');
    await store.create({ ...b, status: 'blocked' });
    const v = store.summary();
    expect(v.overdue).toBe(1);
    expect(v.blocked).toBe(1);
  });

  it('primaryNextStatus handles blocked → resume', () => {
    expect(primaryNextStatus('blocked')).toEqual({ to: 'in_progress', label: 'Resume' });
  });
});
