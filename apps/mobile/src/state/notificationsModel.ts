/**
 * Notifications view-model (Mobile M1-12) — PURE helpers for the Notification
 * Center: priority → colour, unread counting. Split from the screen so they
 * unit-test in plain Node.
 */
import type { CompanionNotification } from '@neuropause/shared';
import { colors } from '../theme/tokens';

/** Colour for a notification priority (from the shared design tokens). */
export function priorityColor(priority: CompanionNotification['priority']): string {
  switch (priority) {
    case 'critical':
      return colors.danger;
    case 'high':
      return colors.bands.watch;
    case 'low':
      return colors.faint;
    case 'normal':
    default:
      return colors.accent;
  }
}

/** Number of unread notifications. */
export function unreadCount(items: CompanionNotification[]): number {
  return items.reduce((n, item) => (item.read ? n : n + 1), 0);
}
