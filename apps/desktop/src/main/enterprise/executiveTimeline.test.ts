import { describe, expect, it } from 'vitest';
import {
  buildDecisionTimeline,
  filterTimeline,
  timelineEventLabel,
  type ExecutiveDecision,
} from '@neuropause/shared';

function decision(over: Partial<ExecutiveDecision> = {}): ExecutiveDecision {
  return {
    id: 'dec:1',
    title: 'Triage failing CI',
    category: 'engineering',
    description: 'x',
    reasoning: 'y',
    evidence: ['ci=fail'],
    sourceSystems: ['organization'],
    confidence: 0.9,
    businessImpact: 'Delivery risk',
    expectedOutcome: 'green CI',
    owner: 'Engineering Lead',
    priority: 'critical',
    status: 'in_progress',
    createdAt: '2026-01-10T00:00:00.000Z',
    updatedAt: '2026-01-12T00:00:00.000Z',
    history: [
      { at: '2026-01-10T00:00:00.000Z', actor: 'system', kind: 'created', newState: 'suggested' },
      {
        at: '2026-01-11T00:00:00.000Z',
        actor: 'CEO',
        kind: 'status_changed',
        previousState: 'suggested',
        newState: 'accepted',
      },
      {
        at: '2026-01-12T00:00:00.000Z',
        actor: 'CEO',
        kind: 'status_changed',
        previousState: 'accepted',
        newState: 'in_progress',
      },
    ],
    ...over,
  };
}

describe('buildDecisionTimeline (V3.7)', () => {
  it('flattens history into entries, newest first', () => {
    const t = buildDecisionTimeline([decision()]);
    expect(t).toHaveLength(3);
    expect(t[0].newState).toBe('in_progress'); // newest
    expect(t[2].kind).toBe('created'); // oldest
    expect(t[0].title).toBe('Triage failing CI');
    expect(t[0].evidenceCount).toBe(1);
  });

  it('merges + sorts across multiple decisions', () => {
    const a = decision({ id: 'dec:a' });
    const b = decision({
      id: 'dec:b',
      title: 'Renew license',
      owner: 'Operations',
      priority: 'high',
      history: [
        { at: '2026-01-13T00:00:00.000Z', actor: 'system', kind: 'created', newState: 'suggested' },
      ],
    });
    const t = buildDecisionTimeline([a, b]);
    expect(t[0].decisionId).toBe('dec:b'); // 01-13 newest
    expect(t).toHaveLength(4);
  });

  it('handles decisions with no history', () => {
    expect(buildDecisionTimeline([decision({ history: undefined })])).toHaveLength(0);
  });
});

describe('filterTimeline (V3.7)', () => {
  const entries = buildDecisionTimeline([
    decision({ id: 'dec:a', owner: 'Engineering Lead', priority: 'critical' }),
    decision({
      id: 'dec:b',
      owner: 'Operations',
      priority: 'high',
      status: 'blocked',
      title: 'Renew license',
      history: [
        { at: '2026-01-14T00:00:00.000Z', actor: 'system', kind: 'created', newState: 'suggested' },
        { at: '2026-01-15T00:00:00.000Z', actor: 'ops', kind: 'blocked', newState: 'blocked' },
      ],
    }),
  ]);

  it('filters by owner', () => {
    const r = filterTimeline(entries, { owner: 'Operations' });
    expect(r.every((e) => e.owner === 'Operations')).toBe(true);
    expect(r.length).toBeGreaterThan(0);
  });

  it('filters by priority', () => {
    const r = filterTimeline(entries, { priority: 'critical' });
    expect(r.every((e) => e.priority === 'critical')).toBe(true);
  });

  it('filters by free-text query over title/owner/label', () => {
    expect(filterTimeline(entries, { query: 'license' }).length).toBeGreaterThan(0);
    expect(filterTimeline(entries, { query: 'blocked' }).length).toBeGreaterThan(0);
    expect(filterTimeline(entries, { query: 'zzzznope' })).toHaveLength(0);
  });

  it('filters by since date', () => {
    const r = filterTimeline(entries, { since: '2026-01-15T00:00:00.000Z' });
    expect(r.every((e) => Date.parse(e.at) >= Date.parse('2026-01-15T00:00:00.000Z'))).toBe(true);
  });
});

describe('timelineEventLabel (V3.7)', () => {
  it('labels lifecycle transitions', () => {
    expect(timelineEventLabel({ kind: 'created' })).toBe('Decision created');
    expect(timelineEventLabel({ kind: 'status_changed', newState: 'completed' })).toBe('Completed');
    expect(timelineEventLabel({ kind: 'status_changed', newState: 'in_progress' })).toBe('Started');
    expect(timelineEventLabel({ kind: 'blocked' })).toBe('Blocked');
    expect(timelineEventLabel({ kind: 'resumed' })).toBe('Resumed');
  });
});
