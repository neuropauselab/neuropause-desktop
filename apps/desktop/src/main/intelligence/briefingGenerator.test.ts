import { describe, expect, it } from 'vitest';
import type { EnterpriseTimelineEntry, UnifiedEntity } from '@neuropause/shared';
import { generateBriefing } from './briefingGenerator';

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
    metadata: p.metadata ?? {},
    title: p.title ?? p.id,
    url: null,
    parentId: null,
    containerId: p.containerId ?? null,
    body: p.body ?? null,
    status: p.status ?? null,
    author: p.author ?? null,
    timestamp: p.timestamp ?? null,
    endTimestamp: null,
    labels: [],
  } as UnifiedEntity;
}

function ev(id: string, category: string, at: string): EnterpriseTimelineEntry {
  return {
    id,
    source: 'platform',
    at,
    kind: 'connector.synced',
    category,
    title: id,
    summary: null,
    actorId: null,
    actorLabel: null,
    connectorId: 'github',
    resourceId: null,
    entityRefs: [],
    url: null,
    metadata: {},
  };
}

describe('generateBriefing', () => {
  it('builds cited sections from real evidence', () => {
    const entities: UnifiedEntity[] = [
      ent({ id: 'task-done', kind: 'task', title: 'Ship login', status: 'closed', updatedAt: '2026-02-10T09:00:00.000Z' }),
      ent({ id: 'task-open', kind: 'task', title: 'Write docs', status: 'open', updatedAt: '2026-02-10T08:00:00.000Z' }),
      ent({ id: 'task-stale', kind: 'task', title: 'Old cleanup', status: 'open', updatedAt: '2026-01-20T08:00:00.000Z' }),
      ent({ id: 'doc1', kind: 'document', title: 'Spec', status: 'active', updatedAt: '2026-02-10T10:00:00.000Z' }),
      ent({ id: 'mtg-past', kind: 'calendar_event', title: 'Standup', timestamp: '2026-02-10T12:00:00.000Z', metadata: { attendees: 3 } }),
      ent({ id: 'mtg-future', kind: 'calendar_event', title: 'Board review', timestamp: '2026-02-11T12:00:00.000Z' }),
      ent({ id: 'notif1', kind: 'notification', title: 'Review request', status: 'unread' }),
    ];
    const events: EnterpriseTimelineEntry[] = [
      ev('e1', 'connector', '2026-02-10T09:00:00.000Z'),
      ev('e2', 'connector', '2026-02-10T11:00:00.000Z'),
    ];

    const b = generateBriefing('evening', { entities, events, now: NOW });
    expect(b.grounded).toBe(true);

    const byId = new Map(b.sections.map((s) => [s.id, s]));
    expect(byId.get('completed')?.items.map((i) => i.evidence[0]?.id)).toContain('task-done');
    expect(byId.get('in_progress')?.items.map((i) => i.evidence[0]?.id)).toEqual(
      expect.arrayContaining(['task-open', 'task-stale']),
    );
    expect(byId.get('upcoming')?.items.map((i) => i.evidence[0]?.id)).toEqual(['mtg-future']);
    expect(byId.get('meetings')?.items.map((i) => i.evidence[0]?.id)).toEqual(['mtg-past']);
    expect(byId.get('documents')?.items.map((i) => i.evidence[0]?.id)).toEqual(['doc1']);
    expect(byId.get('activity')?.items[0]?.evidence.map((e) => e.id)).toEqual(['e1', 'e2']);

    const attention = byId.get('attention')?.items.map((i) => i.evidence[0]?.id) ?? [];
    expect(attention).toEqual(expect.arrayContaining(['task-stale', 'notif1']));

    expect(b.evidenceCount).toBeGreaterThan(0);
    expect(b.headline).toContain('Today so far');
  });

  it('reports an honest empty state with no source data', () => {
    const b = generateBriefing('weekly', { entities: [], events: [], now: NOW });
    expect(b.grounded).toBe(false);
    expect(b.evidenceCount).toBe(0);
    expect(b.sections.every((s) => s.empty)).toBe(true);
    expect(b.headline.toLowerCase()).toContain('no connected data');
  });
});

describe('generateBriefing — GitHub health (Increment 3)', () => {
  it('surfaces release, PR, CI and engineering-risk sections from GitHub entities', () => {
    const entities: UnifiedEntity[] = [
      // a release shipped this month
      ent({
        id: 'rel1', kind: 'activity', title: 'Spring release', timestamp: '2026-02-05T00:00:00.000Z',
        metadata: { repository: 'acme/web', activityKind: 'release', tag: 'v1.2.0', draft: false, prerelease: false },
      }),
      // an open PR awaiting review, opened 9 days ago (stale > 3d)
      ent({
        id: 'pr1', kind: 'task', title: 'Add caching', status: 'open', timestamp: '2026-02-01T00:00:00.000Z',
        metadata: { repository: 'acme/web', isPullRequest: true, reviewers: 2, draft: false },
      }),
      // CI: two failed runs + one success on main → a failing lane (2/3)
      ent({
        id: 'run-1', kind: 'activity', title: 'CI failure on main', status: 'failure', timestamp: '2026-02-09T10:00:00.000Z',
        metadata: { repository: 'acme/web', activityKind: 'ci_run', branch: 'main', conclusion: 'failure' },
      }),
      ent({
        id: 'run-2', kind: 'activity', title: 'CI failure on main', status: 'failure', timestamp: '2026-02-09T11:00:00.000Z',
        metadata: { repository: 'acme/web', activityKind: 'ci_run', branch: 'main', conclusion: 'failure' },
      }),
      ent({
        id: 'run-3', kind: 'activity', title: 'CI success on main', status: 'success', timestamp: '2026-02-09T12:00:00.000Z',
        metadata: { repository: 'acme/web', activityKind: 'ci_run', branch: 'main', conclusion: 'success' },
      }),
      // a stale open issue (21 days old)
      ent({
        id: 'iss1', kind: 'task', title: 'Old bug', status: 'open', timestamp: '2026-01-20T00:00:00.000Z',
        metadata: { repository: 'acme/web', isPullRequest: false },
      }),
    ];

    const b = generateBriefing('monthly', { entities, events: [], now: NOW });
    const byId = new Map(b.sections.map((s) => [s.id, s]));

    // Release health
    const rel = byId.get('release_health');
    expect(rel?.empty).toBe(false);
    expect(rel?.items[0]?.evidence[0]?.id).toBe('rel1');
    expect(rel?.items[0]?.text).toContain('v1.2.0');

    // PR health
    const pr = byId.get('pr_health');
    expect(pr?.items.map((i) => i.evidence[0]?.id)).toEqual(['pr1']);
    expect(pr?.items[0]?.text).toContain('awaiting review');

    // CI health — failing lane with 2/3 failed, citing the failed runs
    const ci = byId.get('ci_health');
    expect(ci?.empty).toBe(false);
    expect(ci?.items[0]?.text).toContain('acme/web@main');
    expect(ci?.items[0]?.text).toContain('2/3');
    expect(ci?.items[0]?.evidence.map((e) => e.id)).toEqual(expect.arrayContaining(['run-1', 'run-2']));

    // Engineering risk — synthesized across PR + CI + issue signals
    const risk = byId.get('engineering_risk')?.items.map((i) => i.text) ?? [];
    expect(risk.some((t) => t.includes('awaiting review for >3d'))).toBe(true);
    expect(risk.some((t) => t.includes('CI unstable on acme/web@main'))).toBe(true);
    expect(risk.some((t) => t.includes('stale for >14d'))).toBe(true);

    // Headline reflects the new signals
    expect(b.headline).toContain('1 release');
    expect(b.headline).toContain('1 PR awaiting review');
    expect(b.headline).toContain('CI failing on 1 branch');
  });

  it('always shows the latest release even when none shipped in the window', () => {
    const entities: UnifiedEntity[] = [
      ent({
        id: 'old-rel', kind: 'activity', title: 'Old release', timestamp: '2025-06-01T00:00:00.000Z',
        metadata: { repository: 'acme/web', activityKind: 'release', tag: 'v0.9.0', draft: false },
      }),
    ];
    const b = generateBriefing('morning', { entities, events: [], now: NOW });
    const rel = new Map(b.sections.map((s) => [s.id, s])).get('release_health');
    expect(rel?.empty).toBe(false);
    expect(rel?.items[0]?.evidence[0]?.id).toBe('old-rel');
    // ...but the in-range headline count must not include it
    expect(b.headline).not.toContain('release');
  });
});
