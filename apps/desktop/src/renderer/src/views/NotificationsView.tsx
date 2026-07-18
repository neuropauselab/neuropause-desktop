import { motion } from 'framer-motion';
import { ViewHeader, ViewScroll } from '@renderer/components/ui/Page';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { Button } from '@renderer/components/ui/Button';
import { getAppOrFallback } from '@renderer/data/catalog';
import { formatRelative } from '@renderer/lib/format';
import type { AppNotification } from '@renderer/data/types';
import { useDashboard } from '@renderer/state/DashboardProvider';

const KIND_ICON: Record<AppNotification['kind'], IconName> = {
  reminder: 'clock',
  summary: 'sparkles',
  workflow: 'automations',
  system: 'info',
};

export function NotificationsView(): JSX.Element {
  const { data, unreadCount, markNotificationRead, markAllNotificationsRead } = useDashboard();
  const notifications = data?.notifications ?? [];

  return (
    <ViewScroll max={820}>
      <ViewHeader
        title="Notifications"
        subtitle="Reminders, summaries, and workflow alerts from across your AI workspace."
        right={
          unreadCount > 0 ? (
            <Button size="sm" variant="secondary" icon="check" onClick={() => markAllNotificationsRead()}>
              Mark all read
            </Button>
          ) : undefined
        }
      />

      {notifications.length === 0 ? (
        <div className="surface-raised flex flex-col items-center rounded-2xl px-6 py-16 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl [background:var(--fill-2)] text-faint">
            <Icon name="bell" size={24} />
          </span>
          <h3 className="mt-4 text-base font-semibold">You’re all caught up</h3>
          <p className="mt-1 text-sm text-faint">New notifications will show up here.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {notifications.map((n, i) => {
            const app = n.appId ? getAppOrFallback(n.appId) : null;
            return (
              <motion.button
                key={n.id}
                type="button"
                onClick={() => markNotificationRead(n.id)}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: i * 0.03 }}
                className="surface-raised flex items-start gap-3 rounded-2xl p-4 text-left shadow-card transition hover:shadow-pop"
              >
                <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/12 text-accent">
                  <Icon name={KIND_ICON[n.kind]} size={18} />
                  {!n.read && (
                    <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-syspink ring-2 ring-[var(--surface-2)]" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-base font-semibold">{n.title}</span>
                    <span className="shrink-0 text-xs text-faint">{formatRelative(n.at)}</span>
                  </div>
                  <p className="mt-0.5 text-sm leading-snug text-muted">{n.body}</p>
                  {app && <div className="mt-1.5 text-xs text-faint">{app.name}</div>}
                </div>
              </motion.button>
            );
          })}
        </div>
      )}
    </ViewScroll>
  );
}
