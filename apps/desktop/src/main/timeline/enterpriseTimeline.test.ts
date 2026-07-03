import { describe, expect, it } from 'vitest';
import type { PlatformEvent, TimelineQuery, UnifiedEntity } from '@neuropause/shared';
import { EnterpriseTimeline, type EnterpriseTimelineSources } from './enterpriseTimeline';

function evt(p: {
  id: string;
  type: string;
  category: string;
  at: string;
  resource?: { type: string; id: string; name: string | null };
  actor?: { kind: 'user' | 'system' | 'plugin' | 'connector'; id: string | null };
  metadata?: Record<string, string | number | boolean | null>;
}): PlatformEvent {
  return {
    id: p.id,
    version: 1,
    type: p.type,
    category: p.category,
    timestamp: p.at,
    source: 'test',
    actor: p.actor ?? { kind: 'system', id: null },
    resource: p.resource ?? null,
    priority: 'normal',
    metadata: p.metadata ?? {},
  } as PlatformEvent;
}

function ent(p: Partial<UnifiedEntity> & { id: string; kind: string }): UnifiedEntity {
  return {
    id: p.id,
    kind: p.kind as never,
    connectorId: p.connectorId ?? 'github',
    accountId: 'acct1',
    sourceId: p.id,
    createdAt: p.createdAt ?? '2026-01-01T00:00:00.000Z',
    updatedAt: p.updatedAt ?? '2026-01-01T00:00:00.000Z',
    syncState: 'active',
    syncedAt: '2026-01-01T00:00:00.000Z',
    metadata: {},
    title: p.title ?? p.id,
    url: p.url ?? null,
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

const EVENTS: PlatformEvent[] = [
  evt({ id: 'e1', type: 'connector.synced', category: 'connector', at: '2026-02-01T09:00:00.000Z', resource: { type: 'connector', id: 'github', name: 'GitHub' } }),
  evt({ id: 'e2', type: 'app.launched', category: 'application', at: '2026-02-01T11:00:00.000Z', resource: { type: 'application', id: 'cursor', name: 'Cursor' } }),
];

const ENTITIES: UnifiedEntity[] = [
  ent({ id: 'm1', kind: 'message', title: 'Deploy is green', body: 'shipped the release', author: 'dev', containerId: 'chan1', timestamp: '2026-02-01T10:00:00.000Z' }),
  ent({ id: 'd1', kind: 'document', title: 'Roadmap', updatedAt: '2026-02-01T12:00:00.000Z' }), // no timestamp → uses updatedAt
  ent({ id: 'p1', kind: 'project', title: 'Apollo' }), // no activity time → skipped
];

function makeSources(): EnterpriseTimelineSources {
  return {
    platformQuery: (q: TimelineQuery) => {
      let evs = EVENTS.slice();
      if (q.since) evs = evs.filter((e) => e.timestamp >= q.since!);
      if (q.until) evs = evs.filter((e) => e.timestamp <= q.until!);
      evs.sort((a, b) =>
        q.order === 'asc'
          ? a.timestamp.localeCompare(b.timestamp)
          : b.timestamp.localeCompare(a.timestamp),
      );
      return { events: evs.slice(0, q.limit ?? 50), nextCursor: null, total: evs.length };
    },
    listEntities: () => ENTITIES,
  };
}

describe('EnterpriseTimeline', () => {
  it('merges platform events with UDM activity, newest first, skipping untimed entities', () => {
    const tl = new EnterpriseTimeline(makeSources());
    const page = tl.query();

    // 2 events + 2 activity (message has timestamp, document uses updatedAt); project skipped
    expect(page.total).toBe(4);
    expect(page.entries.map((e) => e.id)).toEqual([
      'activity:d1', // 12:00
      'e2', // 11:00
      'activity:m1', // 10:00
      'e1', // 09:00
    ]);
    expect(page.entries.find((e) => e.id === 'e1')?.source).toBe('platform');
    expect(page.entries.find((e) => e.id === 'activity:m1')?.source).toBe('activity');
    expect(page.entries.find((e) => e.id === 'activity:m1')?.connectorId).toBe('github');
  });

  it('filters by source, kind, time window, and entity reference', () => {
    const tl = new EnterpriseTimeline(makeSources());

    expect(tl.query({ sources: ['platform'] }).entries.every((e) => e.source === 'platform')).toBe(true);
    expect(tl.query({ kinds: ['message'] }).entries.map((e) => e.id)).toEqual(['activity:m1']);

    const windowed = tl.query({ since: '2026-02-01T10:30:00.000Z', until: '2026-02-01T11:30:00.000Z' });
    expect(windowed.entries.map((e) => e.id)).toEqual(['e2']);

    // the message references its channel container, so an entityRef on chan1 finds it
    const byEntity = tl.query({ entityRef: 'chan1' });
    expect(byEntity.entries.map((e) => e.id)).toEqual(['activity:m1']);

    // the synced connector resource id is on the platform event
    const byConnectorResource = tl.query({ entityRef: 'github' });
    expect(byConnectorResource.entries.map((e) => e.id)).toContain('e1');
  });

  it('replays a window in ascending order with bounds', () => {
    const tl = new EnterpriseTimeline(makeSources());
    const replay = tl.replay({});
    expect(replay.count).toBe(4);
    expect(replay.entries[0]?.id).toBe('e1'); // earliest first
    expect(replay.entries[replay.entries.length - 1]?.id).toBe('activity:d1');
    expect(replay.from).toBe('2026-02-01T09:00:00.000Z');
    expect(replay.to).toBe('2026-02-01T12:00:00.000Z');
  });

  it('searches entries by free text and reports source stats', () => {
    const tl = new EnterpriseTimeline(makeSources());
    const hits = tl.search('deploy', 10);
    expect(hits.map((e) => e.id)).toEqual(['activity:m1']);

    const stats = tl.stats();
    expect(stats.total).toBe(4);
    expect(stats.bySource.platform).toBe(2);
    expect(stats.bySource.activity).toBe(2);
    expect(stats.oldest).toBe('2026-02-01T09:00:00.000Z');
    expect(stats.newest).toBe('2026-02-01T12:00:00.000Z');
  });
});
