import type { Session } from '@neuropause/shared';
import { initials } from '@renderer/lib/format';
import { Avatar } from '@renderer/components/ui/controls';
import { Menu, MenuItem, MenuSeparator } from '@renderer/components/ui/Menu';
import { useAuth } from '@renderer/providers/AuthProvider';
import { useShell } from '@renderer/state/ShellProvider';

/** Toolbar account menu: identity, settings shortcut, and sign out. */
export function ProfileMenu({ session }: { session: Session }): JSX.Element {
  const { logout } = useAuth();
  const { setSection } = useShell();
  const { user } = session;
  const name = user.displayName ?? user.email.split('@')[0];

  return (
    <Menu
      width={248}
      trigger={({ toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-label="Account"
          title={user.email}
          className="ml-0.5 rounded-full outline-none ring-offset-2 transition focus-visible:shadow-focus active:scale-95"
        >
          <Avatar text={initials(name)} size={28} />
        </button>
      )}
    >
      <div className="flex items-center gap-2.5 px-2 py-1.5">
        <Avatar text={initials(name)} size={36} />
        <div className="min-w-0">
          <div className="truncate text-base font-semibold">{name}</div>
          <div className="truncate text-xs text-muted">{user.email}</div>
        </div>
      </div>
      <MenuSeparator />
      <MenuItem icon="settings" onClick={() => setSection('settings')}>
        Settings
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon="logout" tone="danger" onClick={() => void logout()}>
        Sign out
      </MenuItem>
    </Menu>
  );
}
