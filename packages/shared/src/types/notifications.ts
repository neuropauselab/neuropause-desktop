/**
 * Notification Inbox — shared types (Phase 6 Stage 5).
 *
 * The in-app landing place for everything the EXISTING Executive Intelligence
 * Delivery engine delivers (its `notification-center` channel was typed from the
 * start; this stage builds it). The inbox stores delivered items — it generates
 * nothing and schedules nothing: cadences, priority thresholds, DND, and
 * per-source mutes all stay in the delivery engine + its existing preference
 * store. Types only.
 */
import type { IntelligencePriority } from './delivery';

/** One delivered notification as stored in the in-app inbox. */
export interface InboxNotification {
  /** The delivered item's id (stable — re-delivery replaces, never duplicates). */
  id: string;
  title: string;
  body: string;
  priority: IntelligencePriority;
  /** The intelligence source that produced it (e.g. 'mission-brief-morning'). */
  sourceKey: string;
  /** Deep-link target (a section id or renderer route), if any. */
  deepLink: string | null;
  /** ISO timestamp the item was delivered. */
  at: string;
  read: boolean;
  /** End-to-end trace id when the item came from a correlated flow. */
  correlationId?: string;
}

export interface NotificationInboxPage {
  items: InboxNotification[];
  unread: number;
  total: number;
}

/** Broadcast payload on `notifications:event` (renderer refresh signal). */
export interface NotificationInboxEvent {
  kind: 'added' | 'read';
  unread: number;
  at: string;
}
