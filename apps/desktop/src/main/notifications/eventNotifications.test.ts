/**
 * Phase 6 Stage 5 — pure event→notification routing: every subscribed bus type
 * maps to the right source with stable per-subject ids; unrelated types map to
 * null; the cooldown suppresses flapping; the meeting-soon producer scans the
 * calendar honestly; the inbox mapping is faithful.
 */
import { describe, expect, it } from 'vitest';
import type { PlatformEvent, UnifiedEntity } from '@neuropause/shared';
import {
  DeliveryCooldown,
  MEETING_SOON_WINDOW_MINUTES,
  NOTIFICATION_EVENT_TYPES,
  routeEvent,
  toInboxNotification,
  upcomingMeetingItems,
} from './eventNotifications';

const NOW = '2026-07-31T09:00:00.000Z';

function evt(over: Partial<PlatformEvent>): PlatformEvent {
  return {
    id: 'evt1',
    type: 'worker.job_succeeded',
    category: 'automation',
    version: 1,
    priority: 'normal',
    timestamp: NOW,
    source: 'workforce',
    actor: { kind: 'system', id: null },
    resource: null,
    correlationId: 'corr1',
    causationId: null,
    metadata: {},
    ...over,
  } as PlatformEvent;
}

describe('routeEvent', () => {
  it('routes an approval-needed event with a stable per-job id', () => {
    const r = routeEvent(
      evt({
        type: 'worker.job_awaiting_approval',
        resource: { type: 'job', id: 'job42', name: 'invoice-chase · researcher' },
        metadata: { pendingApprovals: 2, workerId: 'researcher', jobId: 'job42' },
      }),
    )!;
    expect(r.sourceKey).toBe('approval-needed');
    expect(r.item.id).toBe('approval:job42');
    expect(r.item.priority).toBe('high');
    expect(r.item.body).toContain('2 proposals');
    expect(r.item.correlationId).toBe('corr1');
    expect(r.item.deepLink).toBe('workforce');
  });

  it('routes completions and failures to work-complete / work-failed', () => {
    const ok = routeEvent(evt({ type: 'worker.job_succeeded', metadata: { jobId: 'j1', summary: '3 findings' } }))!;
    expect(ok.sourceKey).toBe('work-complete');
    expect(ok.item.priority).toBe('normal');
    expect(ok.item.body).toBe('3 findings');
    const failed = routeEvent(evt({ type: 'automation.failed', metadata: { ruleId: 'r1', error: 'boom' } }))!;
    expect(failed.sourceKey).toBe('work-failed');
    expect(failed.item.id).toBe('run-failed:r1');
    expect(failed.item.body).toBe('boom');
    expect(routeEvent(evt({ type: 'workflow.completed' }))!.sourceKey).toBe('work-complete');
  });

  it('routes connector problems with one id per connector (replace, not flood)', () => {
    const a = routeEvent(evt({ type: 'connector.sync_failed', metadata: { connectorId: 'slack' } }))!;
    const b = routeEvent(evt({ type: 'connector.offline', metadata: { connectorId: 'slack' } }))!;
    expect(a.sourceKey).toBe('connector-issue');
    expect(a.item.id).toBe('connector-issue:slack');
    expect(b.item.id).toBe('connector-issue:slack');
    expect(a.item.deepLink).toBe('connections');
  });

  it('routes risk signals with priority derived from the event', () => {
    const crit = routeEvent(evt({ type: 'runtime.supervisor.critical', priority: 'critical' }))!;
    expect(crit.sourceKey).toBe('risk-signal');
    expect(crit.item.priority).toBe('critical');
    const alert = routeEvent(evt({ type: 'infrastructure.alert_raised', priority: 'high' }))!;
    expect(alert.item.priority).toBe('high');
  });

  it('returns null for unrelated event types, and the subscription list covers every routed type', () => {
    expect(routeEvent(evt({ type: 'connector.sync_started' }))).toBeNull();
    expect(routeEvent(evt({ type: 'plugin.installed' }))).toBeNull();
    for (const type of NOTIFICATION_EVENT_TYPES) {
      expect(routeEvent(evt({ type }))).not.toBeNull();
    }
  });
});

describe('DeliveryCooldown', () => {
  it('allows once per window, then again after it elapses', () => {
    const c = new DeliveryCooldown(60_000);
    expect(c.allow('x', 0)).toBe(true);
    expect(c.allow('x', 30_000)).toBe(false);
    expect(c.allow('y', 30_000)).toBe(true); // independent ids
    expect(c.allow('x', 60_000)).toBe(true);
  });
});

describe('upcomingMeetingItems', () => {
  function cal(id: string, ts: string | null, kind: UnifiedEntity['kind'] = 'calendar_event'): UnifiedEntity {
    return {
      id,
      kind,
      connectorId: 'm365',
      accountId: 'a',
      sourceId: id,
      createdAt: NOW,
      updatedAt: NOW,
      syncState: 'active',
      syncedAt: NOW,
      metadata: {},
      title: `Meeting ${id}`,
      url: null,
      parentId: null,
      containerId: null,
      body: null,
      status: null,
      author: null,
      timestamp: ts,
      endTimestamp: null,
      labels: [],
    } as UnifiedEntity;
  }

  it('returns only meetings starting inside the window', () => {
    const items = upcomingMeetingItems(
      [
        cal('in10', '2026-07-31T09:10:00.000Z'),
        cal('in29', '2026-07-31T09:29:00.000Z'),
        cal('in45', '2026-07-31T09:45:00.000Z'), // outside 30-min window
        cal('past', '2026-07-31T08:50:00.000Z'),
        cal('none', null),
        cal('task-like', '2026-07-31T09:05:00.000Z', 'task'), // wrong kind
      ],
      NOW,
      MEETING_SOON_WINDOW_MINUTES,
    );
    expect(items.map((i) => i.id)).toEqual([
      'meeting-soon:in10:2026-07-31T09:10:00.000Z',
      'meeting-soon:in29:2026-07-31T09:29:00.000Z',
    ]);
    expect(items[0]!.body).toContain('10 minute');
    expect(items[0]!.priority).toBe('high');
  });

  it('returns [] on an empty calendar (honest no-op)', () => {
    expect(upcomingMeetingItems([], NOW)).toEqual([]);
  });
});

describe('toInboxNotification', () => {
  it('maps the delivered item faithfully, defaulting sourceKey to system', () => {
    const n = toInboxNotification(
      {
        id: 'x',
        title: 'T',
        body: 'B',
        priority: 'high',
        deepLink: 'hub',
        producedAt: NOW,
        sourceKey: 'meeting-soon',
        correlationId: 'corr9',
      },
      '2026-07-31T09:01:00.000Z',
    );
    expect(n).toMatchObject({
      id: 'x',
      sourceKey: 'meeting-soon',
      deepLink: 'hub',
      read: false,
      at: '2026-07-31T09:01:00.000Z',
      correlationId: 'corr9',
    });
    const bare = toInboxNotification(
      { id: 'y', title: 'T', body: 'B', priority: 'low', producedAt: NOW },
      NOW,
    );
    expect(bare.sourceKey).toBe('system');
    expect(bare.deepLink).toBeNull();
    expect('correlationId' in bare).toBe(false);
  });
});
