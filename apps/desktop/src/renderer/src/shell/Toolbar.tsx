import type { Session } from '@neuropause/shared';
import { Icon } from '@renderer/components/ui/Icon';
import { Kbd } from '@renderer/components/ui/controls';
import { useShell } from '@renderer/state/ShellProvider';
import { ThemeMenu } from './ThemeMenu';
import { NotificationBell } from './NotificationBell';
import { ConnectionIndicator } from './ConnectionIndicator';
import { ProfileMenu } from './ProfileMenu';

/**
 * The full-width macOS toolbar. The left padding clears the inset traffic
 * lights; the bar is a drag region except for the explicit controls. The
 * centre search field is the entry point to the command palette (⌘K).
 */
export function Toolbar({ session }: { session: Session }): JSX.Element {
  const { toggleSidebar, sidebarCollapsed, openCommand } = useShell();

  return (
    <header className="app-drag hairline-b relative z-30 flex h-12 shrink-0 items-center gap-2 pl-20 pr-3">
      <div className="app-no-drag flex items-center gap-1.5">
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title="Toggle sidebar"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted outline-none transition hover:text-ink fill-hover focus-visible:shadow-focus active:scale-95"
        >
          <Icon name="sidebar" size={18} />
        </button>
        <div className="flex items-center gap-2 pl-1">
          <span className="h-2.5 w-2.5 rounded-full bg-accent" />
          <span className="text-base font-semibold tracking-tight">NeuroPause</span>
        </div>
      </div>

      <div className="flex flex-1 justify-center px-2">
        <button
          type="button"
          onClick={openCommand}
          className="app-no-drag group flex h-8 w-full max-w-[460px] items-center gap-2 rounded-lg border border-[var(--hairline)] [background:var(--fill-1)] px-2.5 text-muted outline-none transition hover:[background:var(--fill-2)] focus-visible:shadow-focus"
        >
          <Icon name="search" size={15} />
          <span className="flex-1 truncate text-left text-sm">
            Search apps, actions, and your work
          </span>
          <span className="flex items-center gap-0.5">
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
      </div>

      <div className="app-no-drag flex items-center gap-0.5">
        <ConnectionIndicator />
        <NotificationBell />
        <ThemeMenu />
        <ProfileMenu session={session} />
      </div>
    </header>
  );
}
