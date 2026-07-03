import { describe, expect, it } from 'vitest';
import type { EnterpriseTimelineEntry, UnifiedEntity } from '@neuropause/shared';
import { answerFounderQuestion, type FounderNeighbor } from './founderEngine';

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

const BASE: UnifiedEntity[] = [
  ent({ id: 'proj1', kind: 'project', title: 'Apollo Platform', status: 'active' }),
  ent({ id: 'task1', kind: 'task', title: 'Build login', status: 'open', containerId: 'proj1', updatedAt: '2026-01-01T00:00:00.000Z' }),
  ent({ id: 'task2', kind: 'task', title: 'Add tests', status: 'closed', containerId: 'proj1' }),
  ent({ id: 'doc1', kind: 'document', title: 'Apollo spec', status: 'active' }),
];

describe('answerFounderQuestion', () => {
  it('answers a status question with facts and keeps suggestions separate', () => {
    const a = answerFounderQuestion('what is the status of Apollo Platform?', {
      entities: BASE,
      events: [],
      now: NOW,
    });
    expect(a.intent).toBe('status');
    expect(a.grounded).toBe(true);
    expect(a.facts.length).toBeGreaterThan(0);
    expect(a.facts.every((f) => typeof f.text === 'string')).toBe(true);
    // a stale child task should produce a suggestion, kept out of facts
    expect(a.suggestions.length).toBeGreaterThan(0);
    expect(a.references.some((r) => r.id === 'proj1')).toBe(true);
    expect(a.evidenceCount).toBeGreaterThan(0);
  });

  it('counts records of a kind with evidence', () => {
    const a = answerFounderQuestion('how many open tasks are there?', { entities: BASE, events: [], now: NOW });
    expect(a.intent).toBe('count');
    expect(a.facts[0]?.text).toContain('1 open tasks');
    expect(a.facts[0]?.evidence.map((e) => e.id)).toContain('task1');
  });

  it('reports who is linked to a subject via the graph', () => {
    const neighbors = (id: string): FounderNeighbor[] =>
      id === 'proj1'
        ? [{ id: 'person:github:dev', type: 'person', label: 'dev', rel: 'assigned_to', direction: 'in' }]
        : [];
    const a = answerFounderQuestion('who works on Apollo Platform?', { entities: BASE, events: [], now: NOW, neighbors });
    expect(a.intent).toBe('who');
    expect(a.facts[0]?.text).toContain('dev');
    expect(a.facts[0]?.evidence.some((e) => e.id === 'person:github:dev')).toBe(true);
  });

  it('surfaces blocked work as a fact (observation) plus a suggestion (action)', () => {
    const stalledProject: UnifiedEntity[] = [
      ent({ id: 'p2', kind: 'project', title: 'Zephyr', status: 'active' }),
      ent({ id: 't3', kind: 'task', title: 'Stuck task', status: 'open', containerId: 'p2', updatedAt: '2026-01-01T00:00:00.000Z' }),
    ];
    const a = answerFounderQuestion('what is blocked?', { entities: stalledProject, events: [], now: NOW });
    expect(a.intent).toBe('blocked');
    expect(a.facts.length).toBeGreaterThan(0);
    expect(a.suggestions.length).toBeGreaterThan(0);
  });

  it('is honest when there is no connected data', () => {
    const a = answerFounderQuestion('what is the status of anything?', { entities: [], events: [], now: NOW });
    expect(a.grounded).toBe(false);
    expect(a.facts).toEqual([]);
    expect(a.suggestions).toEqual([]);
    expect(a.summary.toLowerCase()).toContain('no connected data');
  });

  it('gives a grounded overview by default', () => {
    const events: EnterpriseTimelineEntry[] = [
      { id: 'e1', source: 'platform', at: NOW, kind: 'connector.synced', category: 'connector', title: 'sync', summary: null, actorId: null, actorLabel: null, connectorId: 'github', resourceId: null, entityRefs: [], url: null, metadata: {} },
    ];
    const a = answerFounderQuestion('give me an overview', { entities: BASE, events, now: NOW });
    expect(a.intent).toBe('overview');
    expect(a.facts[0]?.text).toContain('project');
    expect(a.references.length).toBeGreaterThan(0);
  });
});
