import { useState } from 'react';
import { useShell } from '@renderer/state/ShellProvider';
import { WorkspaceTabBar } from './workspace/WorkspaceTabBar';
import { AppLauncher } from './workspace/AppLauncher';
import { AppTabContent } from './workspace/AppTabContent';

/** The multi-tab Workspace: an IDE-like surface for AI apps. */
export function WorkspaceView(): JSX.Element {
  const { tabs, activeTabId, openApp, closeTab, setActiveTab } = useShell();
  const [launcher, setLauncher] = useState(false);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const showLauncher = launcher || !activeTab;

  const handleOpen = (id: string, title: string): void => {
    openApp(id, title);
    setLauncher(false);
  };
  const handleSelect = (id: string): void => {
    setActiveTab(id);
    setLauncher(false);
  };

  return (
    <div className="flex h-full flex-col">
      {tabs.length > 0 && (
        <WorkspaceTabBar
          tabs={tabs}
          activeTabId={showLauncher ? null : activeTabId}
          onSelect={handleSelect}
          onClose={closeTab}
          onNew={() => setLauncher(true)}
        />
      )}
      <div className="min-h-0 flex-1">
        {showLauncher ? (
          <AppLauncher onOpenApp={handleOpen} />
        ) : (
          <AppTabContent tab={activeTab as NonNullable<typeof activeTab>} />
        )}
      </div>
    </div>
  );
}
