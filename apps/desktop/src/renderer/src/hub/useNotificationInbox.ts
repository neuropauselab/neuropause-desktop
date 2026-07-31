/**
 * Phase 6 Stage 5 (D-8) — the one notification-inbox hook. NotificationBell,
 * NotificationsView, and the Work Hub's notifications tile all read the SAME
 * real feed (`notifications:list` + the `notifications:event` broadcast) —
 * replacing the DashboardProvider's honest-but-empty placeholder feed.
 */
import { useCallback, useEffect, useState } from 'react';
import type { InboxNotification } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';

export interface NotificationInboxState {
  items: InboxNotification[];
  unread: number;
  /** Null until the first load settles; then true (ready) or false (failed). */
  available: boolean | null;
  markRead: (ids: 'all' | string[]) => void;
  refresh: () => void;
}

export function useNotificationInbox(limit = 50): NotificationInboxState {
  const [items, setItems] = useState<InboxNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [available, setAvailable] = useState<boolean | null>(null);

  const refresh = useCallback((): void => {
    ipc.notifications
      .list(limit)
      .then((page) => {
        setItems(page.items);
        setUnread(page.unread);
        setAvailable(true);
      })
      .catch(() => setAvailable(false));
  }, [limit]);

  useEffect(() => {
    refresh();
    const off = ipc.notifications.onEvent(() => refresh());
    return off;
  }, [refresh]);

  const markRead = useCallback(
    (ids: 'all' | string[]): void => {
      // Optimistic local flip; the broadcast confirms with the real state.
      setItems((prev) =>
        prev.map((n) => (ids === 'all' || ids.includes(n.id) ? { ...n, read: true } : n)),
      );
      setUnread((prev) => (ids === 'all' ? 0 : Math.max(0, prev - ids.length)));
      ipc.notifications.markRead(ids).catch(() => refresh());
    },
    [refresh],
  );

  return { items, unread, available, markRead, refresh };
}
