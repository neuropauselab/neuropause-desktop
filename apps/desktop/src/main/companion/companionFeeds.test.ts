/**
 * Mobile M1-06a — feed projections. Locks that timeline/search/notification
 * shaping carries the phone-relevant fields (and the pagination/unread counts)
 * without leaking the heavier desktop shapes.
 */
import { describe, expect, it } from 'vitest';
import type {
  EnterpriseSearchResult,
  EnterpriseTimelinePage,
  NotificationInboxPage,
} from '@neuropause/shared';
import { shapeNotifications, shapeSearch, shapeTimeline } from './companionFeeds';

describe('shapeTimeline', () => {
  it('projects entries and preserves the cursor + total', () => {
    const page = {
      entries: [
        {
          id: 'e1',
          source: 'platform',
          at: '2026-08-07T12:00:00.000Z',
          kind: 'enterprise.record.updated',
          category: 'enterprise',
          title: 'Invoice INV-1 updated',
          summary: 'status → paid',
          actorId: 'u1',
          actorLabel: 'Ada',
        },
      ],
      nextCursor: 'c2',
      total: 42,
    } as unknown as EnterpriseTimelinePage;
    expect(shapeTimeline(page)).toEqual({
      entries: [
        {
          id: 'e1',
          at: '2026-08-07T12:00:00.000Z',
          title: 'Invoice INV-1 updated',
          summary: 'status → paid',
          category: 'enterprise',
          kind: 'enterprise.record.updated',
          actorLabel: 'Ada',
        },
      ],
      nextCursor: 'c2',
      total: 42,
    });
  });
});

describe('shapeSearch', () => {
  it('projects hits with title/snippet/source', () => {
    const result = {
      query: 'invoice',
      hits: [
        {
          source: 'timeline',
          id: 'h1',
          kind: 'event',
          title: 'Invoice INV-1',
          snippet: '…paid…',
          score: 0.9,
          connectorId: null,
          timestamp: '2026-08-07T12:00:00.000Z',
          url: null,
        },
      ],
      groups: [],
      total: 1,
      backends: ['lexical'],
    } as unknown as EnterpriseSearchResult;
    expect(shapeSearch(result)).toEqual({
      query: 'invoice',
      hits: [
        {
          id: 'h1',
          source: 'timeline',
          kind: 'event',
          title: 'Invoice INV-1',
          snippet: '…paid…',
          timestamp: '2026-08-07T12:00:00.000Z',
        },
      ],
      total: 1,
    });
  });
});

describe('shapeNotifications', () => {
  it('projects items and preserves unread + total', () => {
    const page = {
      items: [
        {
          id: 'n1',
          title: 'Morning brief',
          body: '3 approvals waiting',
          priority: 'high',
          sourceKey: 'mission-brief-morning',
          deepLink: null,
          at: '2026-08-07T07:00:00.000Z',
          read: false,
        },
      ],
      unread: 1,
      total: 5,
    } as unknown as NotificationInboxPage;
    expect(shapeNotifications(page)).toEqual({
      items: [
        {
          id: 'n1',
          title: 'Morning brief',
          body: '3 approvals waiting',
          priority: 'high',
          at: '2026-08-07T07:00:00.000Z',
          read: false,
        },
      ],
      unread: 1,
      total: 5,
    });
  });
});
