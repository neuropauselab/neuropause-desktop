import { useEffect, useState } from 'react';
import { cn } from '@renderer/lib/cn';
import { useShell } from '@renderer/state/ShellProvider';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { OperationsProvider, useOperations } from './OperationsProvider';
import { opsStatusMeta } from './lib';
import { OverviewPanel } from './OverviewPanel';
import { InstalledPanel } from './InstalledPanel';
import { SessionsPanel } from './SessionsPanel';
import { HealthPanel } from './HealthPanel';
import { LogsPanel } from './LogsPanel';
import { PluginsPanel } from './PluginsPanel';
import { DownloadsPanel } from './DownloadsPanel';
import { UpdatesPanel } from './UpdatesPanel';
import { PermissionsPanel } from './PermissionsPanel';
import { CollectionsPanel } from './CollectionsPanel';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { KnowledgePanel } from './KnowledgePanel';
import { SyncHealthPanel } from './SyncHealthPanel';
import { EventInspectorPanel } from './EventInspectorPanel';
import { IntelligencePanel } from './IntelligencePanel';
import { FounderPanel } from './FounderPanel';
import { MemoryPanel } from './MemoryPanel';
import { EngineeringAIPanel } from './EngineeringAIPanel';
import { TracePanel } from './TracePanel';
import { ReleaseDiagnosticsPanel } from './ReleaseDiagnosticsPanel';
import { RecoveryCenterPanel } from './RecoveryCenterPanel';

export type OpsTab =
  | 'overview'
  | 'installed'
  | 'sessions'
  | 'plugins'
  | 'downloads'
  | 'updates'
  | 'permissions'
  | 'logs'
  | 'health'
  | 'collections'
  | 'knowledge'
  | 'intelligence'
  | 'founder'
  | 'memory'
  | 'engineering'
  | 'traces'
  | 'sync'
  | 'diagnostics'
  | 'release'
  | 'recovery'
  | 'inspector';

interface TabDef {
  id: OpsTab;
  label: string;
  icon: IconName;
  ready: boolean;
}

const TABS: TabDef[] = [
  { id: 'overview', label: 'Overview', icon: 'gauge', ready: true },
  { id: 'installed', label: 'Installed', icon: 'package', ready: true },
  { id: 'sessions', label: 'Sessions', icon: 'pulse', ready: true },
  { id: 'plugins', label: 'Plugins', icon: 'puzzle', ready: true },
  { id: 'downloads', label: 'Downloads', icon: 'download', ready: true },
  { id: 'updates', label: 'Updates', icon: 'refresh', ready: true },
  { id: 'permissions', label: 'Permissions', icon: 'shield', ready: true },
  { id: 'logs', label: 'Activity', icon: 'list', ready: true },
  { id: 'health', label: 'Health', icon: 'activity', ready: true },
  { id: 'collections', label: 'Collections', icon: 'grid', ready: true },
  { id: 'knowledge', label: 'Knowledge', icon: 'database', ready: true },
  { id: 'intelligence', label: 'Intelligence', icon: 'sparkles', ready: true },
  { id: 'founder', label: 'Founder AI', icon: 'bolt', ready: true },
  { id: 'memory', label: 'Memory', icon: 'memory', ready: true },
  { id: 'engineering', label: 'Engineering AI', icon: 'cpu', ready: true },
  { id: 'traces', label: 'Traces', icon: 'layers', ready: true },
  { id: 'sync', label: 'Sync Health', icon: 'pulse', ready: true },
  { id: 'diagnostics', label: 'Diagnostics', icon: 'beaker', ready: true },
  { id: 'release', label: 'Release', icon: 'verified', ready: true },
  { id: 'recovery', label: 'Recovery', icon: 'undo', ready: true },
  ...(import.meta.env.DEV
    ? ([{ id: 'inspector', label: 'Inspector', icon: 'code', ready: true }] as TabDef[])
    : []),
];

/** The Operations command center, mounted with its live data provider. */
export function OperationsRoot(): JSX.Element {
  return (
    <OperationsProvider>
      <OperationsInner />
    </OperationsProvider>
  );
}

function OperationsInner(): JSX.Element {
  const { status, refreshAll } = useOperations();
  const st = opsStatusMeta(status);
  const { opsTab, clearOpsTab } = useShell();
  const [tab, setTab] = useState<OpsTab>(() =>
    TABS.some((t) => t.id === opsTab) ? (opsTab as OpsTab) : 'overview',
  );

  // Honor a deep-link target from the Command Center, then clear it (one-shot).
  useEffect(() => {
    if (opsTab && TABS.some((t) => t.id === opsTab)) {
      setTab(opsTab as OpsTab);
      clearOpsTab();
    }
  }, [opsTab, clearOpsTab]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto px-8 py-7" style={{ maxWidth: 1240 }}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Operations</h1>
            <p className="mt-1 text-md text-muted">
              The command center for everything installed, running, and managed by NeuroPause.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-faint">
              <span className="relative flex h-2 w-2">
                {st.pulse && (
                  <span
                    className={cn(
                      'absolute inline-flex h-full w-full animate-ping rounded-full opacity-60',
                      st.dot,
                    )}
                  />
                )}
                <span className={cn('relative inline-flex h-2 w-2 rounded-full', st.dot)} />
              </span>
              {st.label}
            </span>
            <button
              type="button"
              aria-label="Refresh"
              title="Refresh"
              onClick={() => void refreshAll()}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted fill-hover hover:text-ink"
            >
              <Icon name="refresh" size={16} />
            </button>
          </div>
        </div>

        {/* Sub-navigation */}
        <nav className="mb-6 flex gap-1 overflow-x-auto rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium outline-none transition focus-visible:shadow-focus',
                  active ? 'surface-raised text-ink shadow-sm' : 'text-muted hover:text-ink',
                )}
              >
                <Icon name={t.icon} size={15} />
                {t.label}
                {!t.ready && (
                  <span
                    className="ml-0.5 h-1.5 w-1.5 rounded-full bg-accent/60"
                    title="Arrives in Part B-2"
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Active panel */}
        {tab === 'overview' && <OverviewPanel onNavigate={setTab} />}
        {tab === 'installed' && <InstalledPanel />}
        {tab === 'sessions' && <SessionsPanel onNavigate={setTab} />}
        {tab === 'logs' && <LogsPanel />}
        {tab === 'health' && <HealthPanel />}
        {tab === 'plugins' && <PluginsPanel onNavigate={setTab} />}
        {tab === 'downloads' && <DownloadsPanel />}
        {tab === 'updates' && <UpdatesPanel />}
        {tab === 'permissions' && <PermissionsPanel />}
        {tab === 'collections' && <CollectionsPanel />}
        {tab === 'knowledge' && <KnowledgePanel />}
        {tab === 'intelligence' && <IntelligencePanel />}
        {tab === 'founder' && <FounderPanel />}
        {tab === 'memory' && <MemoryPanel />}
        {tab === 'engineering' && <EngineeringAIPanel />}
        {tab === 'traces' && <TracePanel />}
        {tab === 'sync' && <SyncHealthPanel />}
        {tab === 'diagnostics' && <DiagnosticsPanel />}
        {tab === 'release' && <ReleaseDiagnosticsPanel />}
        {tab === 'recovery' && <RecoveryCenterPanel />}
        {tab === 'inspector' && <EventInspectorPanel />}
      </div>
    </div>
  );
}
