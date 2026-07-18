import { useCallback, useEffect, useState } from 'react';
import type { AppNotification, DashboardData } from './types';
import { SAMPLE_DASHBOARD } from './sampleData';

export interface UseDashboardData {
  data: DashboardData | null;
  loading: boolean;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  unreadCount: number;
}

/**
 * Loads the dashboard payload. Today it resolves the local sample data on a
 * short delay to mirror an async fetch; in later phases the body is swapped for
 * real IPC calls (e.g. ipc.activity.getDashboard()) with no change to callers.
 */
export function useDashboardData(): UseDashboardData {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      if (!active) return;
      // Clone so local mutations (mark-as-read) don't touch the source module.
      setData(structuredClone(SAMPLE_DASHBOARD));
      setLoading(false);
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);

  const updateNotifications = useCallback(
    (fn: (n: AppNotification[]) => AppNotification[]) => {
      setData((prev) => (prev ? { ...prev, notifications: fn(prev.notifications) } : prev));
    },
    [],
  );

  const markNotificationRead = useCallback(
    (id: string) => {
      updateNotifications((list) => list.map((n) => (n.id === id ? { ...n, read: true } : n)));
    },
    [updateNotifications],
  );

  const markAllNotificationsRead = useCallback(() => {
    updateNotifications((list) => list.map((n) => ({ ...n, read: true })));
  }, [updateNotifications]);

  const unreadCount = data ? data.notifications.filter((n) => !n.read).length : 0;

  return { data, loading, markNotificationRead, markAllNotificationsRead, unreadCount };
}
