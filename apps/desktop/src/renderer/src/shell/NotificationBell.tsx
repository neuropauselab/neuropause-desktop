/**
 * Toolbar notification bell (Phase 6 Stage 5 — D-8): now reads the REAL
 * notification inbox (`notifications:*`) instead of the dashboard placeholder
 * feed. Unread count and list refresh live on the `notifications:event`
 * broadcast; clicking an item marks it read and follows its deep link into the
 * EXISTING section it points at.
 */
import { motion } from 'framer-motion';
import { formatRelative } from '@renderer/lib/format';
import { Icon } from '@renderer/components/ui/Icon';
import { Menu, MenuItem, MenuSeparator } from '@renderer/components/ui/Menu';
import { useShell } from '@renderer/state/ShellProvider';
import { useNotificationInbox } from '@renderer/hub/useNotificationInbox';
import { sectionForDeepLink, sourceLabel } from '@renderer/hub/hubModel';

export function NotificationBell(): JSX.Element {
  const { items, unread, markRead } = useNotificationInbox(12);
  const { setSection } = useShell();

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
          {unread > 0 && (
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
        {unread > 0 && (
          <button
            type="button"
            onClick={() => markRead('all')}
            className="text-xs font-medium text-accent hover:text-accent-hover"
          >
            Mark all read
          </button>
        )}
      </div>
      <MenuSeparator />
      {items.length === 0 ? (
        <div className="px-2.5 py-6 text-center text-sm text-faint">You’re all caught up.</div>
      ) : (
        <div className="max-h-[320px] overflow-y-auto">
          {items.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => {
                markRead([n.id]);
                const section = sectionForDeepLink(n.deepLink);
                if (section) setSection(section);
              }}
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
                <span className="mt-0.5 block text-xs leading-snug text-muted">
                  {sourceLabel(n.sourceKey)} · {n.body}
                </span>
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
