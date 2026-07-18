import { useCallback, useEffect, useState } from 'react';
import type { AppNotification, DashboardData } from './types';
import { useServices } from '@renderer/services/ServicesProvider';
import { createLogger } from '@renderer/lib/logger';

const log = createLogger('dashboard');

export interface UseDashboardData {
  data: DashboardData | null;
  loading: boolean;
  error: boolean;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  unreadCount: number;
}

/**
 * Loads the dashboard payload from the DashboardRepository. The source is
 * resolved through the services layer, so this hook is unaware of whether the
 * data is local or networked.
 */
export function useDashboardData(): UseDashboardData {
  const { dashboard } = useServices();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    dashboard
      .getDashboard()
      .then((payload) => {
        if (active) setData(payload);
      })
      .catch((err) => {
        log.error('Failed to load dashboard', err);
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [dashboard]);

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

  return { data, loading, error, markNotificationRead, markAllNotificationsRead, unreadCount };
}
