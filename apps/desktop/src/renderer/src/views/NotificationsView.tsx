import { ViewHeader } from '@renderer/components/ui/Page';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { Button } from '@renderer/components/ui/Button';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { VirtualList } from '@renderer/components/ui/VirtualList';
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

const ROW_HEIGHT = 112;
const ROW_GAP = 8;

function NotificationRow({
  n,
  onRead,
}: {
  n: AppNotification;
  onRead: (id: string) => void;
}): JSX.Element {
  const app = n.appId ? getAppOrFallback(n.appId) : null;
  return (
    <button
      type="button"
      onClick={() => onRead(n.id)}
      className="surface-raised flex h-full w-full items-start gap-3 rounded-2xl p-4 text-left shadow-card outline-none transition hover:shadow-pop focus-visible:shadow-focus"
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
        <p className="mt-0.5 line-clamp-2 text-sm leading-snug text-muted">{n.body}</p>
        {app && <div className="mt-1.5 text-xs text-faint">{app.name}</div>}
      </div>
    </button>
  );
}

export function NotificationsView(): JSX.Element {
  const { data, unreadCount, markNotificationRead, markAllNotificationsRead } = useDashboard();
  const notifications = data?.notifications ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="mx-auto w-full max-w-[820px] shrink-0 px-8 pt-7">
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
      </div>

      {notifications.length === 0 ? (
        <div className="mx-auto w-full max-w-[820px] px-8">
          <div className="surface-raised rounded-2xl">
            <EmptyState
              icon="bell"
              title="You’re all caught up"
              description="New notifications will show up here."
            />
          </div>
        </div>
      ) : (
        <div className="mx-auto min-h-0 w-full max-w-[820px] flex-1 px-8 pb-7">
          <VirtualList
            items={notifications}
            rowHeight={ROW_HEIGHT}
            gap={ROW_GAP}
            getKey={(n) => n.id}
            className="-mx-1 px-1"
            renderRow={(n) => <NotificationRow n={n} onRead={markNotificationRead} />}
          />
        </div>
      )}
    </div>
  );
}
