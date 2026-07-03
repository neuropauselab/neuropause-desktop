import { describe, expect, it } from 'vitest';
import type { EnterpriseTimelineEntry, UnifiedEntity } from '@neuropause/shared';
import { generateRecommendations } from './recommendationEngine';

const NOW = '2026-02-10T18:00:00.000Z';

function ent(p: Partial<UnifiedEntity> & { id: string; kind: string }): UnifiedEntity {
  return {
    id: p.id,
    kind: p.kind as never,
    connectorId: p.connectorId ?? 'github',
    accountId: 'acct1',
    sourceId: p.id,
    createdAt: p.createdAt ?? NOW,
    updatedAt: p.updatedAt ?? NOW,
    syncState: 'active',
    syncedAt: NOW,
    metadata: {},
    title: p.title ?? p.id,
    url: null,
    parentId: null,
    containerId: p.containerId ?? null,
    body: null,
    status: p.status ?? null,
    author: null,
    timestamp: p.timestamp ?? null,
    endTimestamp: null,
    labels: [],
  } as UnifiedEntity;
}

describe('generateRecommendations', () => {
  it('fires each rule with cited evidence and ranks by score', () => {
    const entities: UnifiedEntity[] = [
      ent({ id: 'task-recent', kind: 'task', title: 'Recent work', status: 'open', updatedAt: '2026-02-09T18:00:00.000Z' }),
      ent({ id: 'task-old', kind: 'task', title: 'Old work', status: 'open', updatedAt: '2026-01-10T18:00:00.000Z' }),
      ent({ id: 'proj1', kind: 'project', title: 'Apollo', status: 'active' }),
      ent({ id: 'task-in-proj', kind: 'task', title: 'Proj task', status: 'open', containerId: 'proj1', updatedAt: '2026-01-05T00:00:00.000Z' }),
      ent({ id: 'notif1', kind: 'notification', title: 'Mention', status: 'unread' }),
      ent({ id: 'evt-soon', kind: 'calendar_event', title: 'Launch', timestamp: '2026-02-12T12:00:00.000Z' }),
      ent({ id: 'evt-far', kind: 'calendar_event', title: 'Offsite', timestamp: '2026-03-20T12:00:00.000Z' }),
    ];
    // no timeline activity referencing proj1 → it should read as stalled
    const events: EnterpriseTimelineEntry[] = [];

    const recs = generateRecommendations({ entities, events, now: NOW });
    const byKind = new Map(recs.map((r) => [r.kind, r]));

    expect(byKind.has('next_task')).toBe(true);
    expect(byKind.has('stale_task')).toBe(true);
    expect(byKind.has('blocked_project')).toBe(true);
    expect(byKind.has('unanswered')).toBe(true);
    expect(byKind.has('upcoming_deadline')).toBe(true);

    // every recommendation carries evidence
    expect(recs.every((r) => r.evidence.length > 0)).toBe(true);

    // the stalled project cites both the project and a child task
    const blocked = byKind.get('blocked_project');
    expect(blocked?.evidence.map((e) => e.id)).toEqual(expect.arrayContaining(['proj1', 'task-in-proj']));

    // the far-future event did not produce an upcoming_deadline
    expect(recs.find((r) => r.id.includes('evt-far'))).toBeUndefined();

    // ranked descending
    for (let i = 1; i < recs.length; i++) {
      expect(recs[i - 1]!.score).toBeGreaterThanOrEqual(recs[i]!.score);
    }
  });

  it('classifies a task as stale OR next, never both, and honors the kinds filter', () => {
    const entities: UnifiedEntity[] = [
      ent({ id: 't1', kind: 'task', title: 'A', status: 'open', updatedAt: '2026-01-01T00:00:00.000Z' }), // stale
      ent({ id: 't2', kind: 'task', title: 'B', status: 'open', updatedAt: '2026-02-09T00:00:00.000Z' }), // next
    ];
    const all = generateRecommendations({ entities, events: [], now: NOW });
    const forT1 = all.filter((r) => r.entityRefs.includes('t1'));
    expect(forT1.map((r) => r.kind)).toEqual(['stale_task']);

    const onlyNext = generateRecommendations({ entities, events: [], now: NOW }, { kinds: ['next_task'] });
    expect(onlyNext.every((r) => r.kind === 'next_task')).toBe(true);
    expect(onlyNext.map((r) => r.entityRefs[0])).toEqual(['t2']);
  });
});
