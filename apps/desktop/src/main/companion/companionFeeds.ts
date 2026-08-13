/**
 * Companion feeds (Mobile M1-06a) — pure projections of the desktop's REAL
 * timeline, enterprise search, and notification inbox into the compact shapes
 * the phone renders. Each op dispatches the existing secure channel and shapes
 * its result here; no new stores, no fabricated feed. The enterprise-search
 * boundary (record bodies are not indexed) is carried honestly in the DTO.
 */
import type {
  CompanionNotificationsPage,
  CompanionSearchResult,
  CompanionTimelinePage,
  EnterpriseSearchResult,
  EnterpriseTimelinePage,
  NotificationInboxPage,
} from '@neuropause/shared';

/** Project an enterprise timeline page into the phone's compact entries. */
export function shapeTimeline(page: EnterpriseTimelinePage): CompanionTimelinePage {
  return {
    entries: page.entries.map((e) => ({
      id: e.id,
      at: e.at,
      title: e.title,
      summary: e.summary,
      category: e.category,
      kind: e.kind,
      actorLabel: e.actorLabel,
    })),
    nextCursor: page.nextCursor,
    total: page.total,
  };
}

/** Project a merged enterprise-search result into the phone's hit list. */
export function shapeSearch(result: EnterpriseSearchResult): CompanionSearchResult {
  return {
    query: result.query,
    hits: result.hits.map((h) => ({
      id: h.id,
      source: h.source,
      kind: h.kind,
      title: h.title,
      snippet: h.snippet,
      timestamp: h.timestamp,
    })),
    total: result.total,
  };
}

/** Project the notification inbox page into the phone's notification center. */
export function shapeNotifications(page: NotificationInboxPage): CompanionNotificationsPage {
  return {
    items: page.items.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      priority: n.priority,
      at: n.at,
      read: n.read,
    })),
    unread: page.unread,
    total: page.total,
  };
}
