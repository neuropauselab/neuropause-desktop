import { motion } from 'framer-motion';
import { formatRelative } from '@renderer/lib/format';
import { Icon } from '@renderer/components/ui/Icon';
import { Menu, MenuItem, MenuSeparator } from '@renderer/components/ui/Menu';
import { useDashboard } from '@renderer/state/DashboardProvider';
import { useShell } from '@renderer/state/ShellProvider';

/** Toolbar notification bell with an unread indicator and a quick list. */
export function NotificationBell(): JSX.Element {
  const { data, unreadCount, markNotificationRead, markAllNotificationsRead } = useDashboard();
  const { setSection } = useShell();
  const notifications = data?.notifications ?? [];

  return (
    <Menu
      width={332}
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-label="Notifications"
          title="Notifications"
          className={`relative flex h-8 w-8 items-center justify-center rounded-lg outline-none transition focus-visible:shadow-focus ${
            open ? 'fill-active text-ink' : 'text-muted hover:text-ink fill-hover'
          }`}
        >
          <Icon name="bell" size={18} />
          {unreadCount > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-syspink ring-2 ring-[var(--glass)]"
            />
          )}
        </button>
      )}
    >
      <div className="flex items-center justify-between px-2.5 pb-1.5 pt-1">
        <span className="text-base font-semibold">Notifications</span>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={() => markAllNotificationsRead()}
            className="text-xs font-medium text-accent hover:text-accent-hover"
          >
            Mark all read
          </button>
        )}
      </div>
      <MenuSeparator />
      {notifications.length === 0 ? (
        <div className="px-2.5 py-6 text-center text-sm text-faint">You’re all caught up.</div>
      ) : (
        <div className="max-h-[320px] overflow-y-auto">
          {notifications.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => markNotificationRead(n.id)}
              className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left fill-hover"
            >
              <span
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                  n.read ? 'bg-transparent' : 'bg-accent'
                }`}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-ink">{n.title}</span>
                  <span className="shrink-0 text-2xs text-faint">{formatRelative(n.at)}</span>
                </span>
                <span className="mt-0.5 block text-xs leading-snug text-muted">{n.body}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      <MenuSeparator />
      <MenuItem icon="bell" onClick={() => setSection('notifications')}>
        Open Notifications
      </MenuItem>
    </Menu>
  );
}
