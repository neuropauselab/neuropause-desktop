import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Session } from '@neuropause/shared';
import { useShell } from '@renderer/state/ShellProvider';
import { Toolbar } from './Toolbar';
import { Sidebar } from './Sidebar';
import { CommandPalette } from './CommandPalette';
import { HomeView } from '@renderer/views/HomeView';
import { StoreView } from '@renderer/views/StoreView';
import { WorkspaceView } from '@renderer/views/WorkspaceView';
import { ConnectorsView } from '@renderer/views/ConnectorsView';
import { MemoryView } from '@renderer/views/MemoryView';
import { AutomationsView } from '@renderer/views/AutomationsView';
import { NotificationsView } from '@renderer/views/NotificationsView';
import { AnalyticsView } from '@renderer/views/AnalyticsView';
import { SettingsView } from '@renderer/views/SettingsView';

/**
 * The authenticated application shell: full-width toolbar, collapsible sidebar,
 * an animated content region that switches on the active section, and the
 * command palette. Owns the global ⌘K shortcut.
 */
export function AppShell({ session }: { session: Session }): JSX.Element {
  const { activeSection, commandOpen, setCommandOpen } = useShell();

  // Keep a live reference so the global key handler can toggle correctly.
  const openRef = useRef(commandOpen);
  openRef.current = commandOpen;

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandOpen(!openRef.current);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setCommandOpen]);

  const renderView = (): JSX.Element => {
    switch (activeSection) {
      case 'home':
        return <HomeView session={session} />;
      case 'store':
        return <StoreView />;
      case 'workspace':
        return <WorkspaceView />;
      case 'connectors':
        return <ConnectorsView />;
      case 'memory':
        return <MemoryView />;
      case 'automations':
        return <AutomationsView />;
      case 'notifications':
        return <NotificationsView />;
      case 'analytics':
        return <AnalyticsView />;
      case 'settings':
        return <SettingsView session={session} />;
      default:
        return <HomeView session={session} />;
    }
  };

  return (
    <div className="app-bg flex h-full w-full flex-col text-ink">
      <Toolbar session={session} />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeSection}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
              className="h-full"
            >
              {renderView()}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}
