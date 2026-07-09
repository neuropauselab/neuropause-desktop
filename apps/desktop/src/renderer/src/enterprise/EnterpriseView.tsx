import { useEffect, useMemo, useState } from 'react';
import { cn } from '@renderer/lib/cn';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { EnterpriseProvider, useEnterprise } from './EnterpriseProvider';
import { CommandCenterPanel } from './CommandCenterPanel';
import { DecisionCenterPanel } from './DecisionCenterPanel';
import { OrganizationExplorerPanel } from './OrganizationExplorerPanel';
import { BusinessOpsPanel } from './BusinessOpsPanel';
import { EnterpriseSearchPanel } from './EnterpriseSearchPanel';
import { ExecutiveWorkspacePanel } from './ExecutiveWorkspacePanel';
import { BriefingsPanel } from './BriefingsPanel';
import { ExecutiveCenterPanel } from './ExecutiveCenterPanel';
import { ProcessExplorerPanel } from './ProcessExplorerPanel';
import { CustomizePanel } from './CustomizePanel';
import { EnterpriseModulesHub } from './modules/EnterpriseModulesHub';
import { loadNavPrefs, type EnterpriseTab } from './lib';

interface TabDef {
  id: EnterpriseTab;
  label: string;
  icon: IconName;
}

const TABS: TabDef[] = [
  { id: 'command', label: 'Command Center', icon: 'grid' },
  { id: 'executive', label: 'Executive', icon: 'sparkles' },
  { id: 'decision', label: 'Decision Center', icon: 'shield' },
  { id: 'organization', label: 'Organization', icon: 'layers' },
  { id: 'operations', label: 'Operations', icon: 'gauge' },
  { id: 'process', label: 'Process Explorer', icon: 'activity' },
  { id: 'modules', label: 'Modules', icon: 'grid' },
  { id: 'search', label: 'Search', icon: 'search' },
  { id: 'workspace', label: 'Workspace', icon: 'cpu' },
  { id: 'briefings', label: 'Briefings', icon: 'sparkles' },
  { id: 'customize', label: 'Customize', icon: 'settings' },
];

/** The Enterprise experience, mounted with its live data provider. */
export function EnterpriseRoot({
  initialTab = 'command',
}: {
  initialTab?: EnterpriseTab;
}): JSX.Element {
  return (
    <EnterpriseProvider>
      <EnterpriseInner initialTab={initialTab} />
    </EnterpriseProvider>
  );
}

function EnterpriseInner({ initialTab }: { initialTab: EnterpriseTab }): JSX.Element {
  const { ready, refreshAll, jobs } = useEnterprise();
  const [tab, setTab] = useState<EnterpriseTab>(initialTab);
  const [searchQuery, setSearchQuery] = useState('');
  const [navVersion, setNavVersion] = useState(0);

  // Re-read navigation preferences when Customize changes them.
  useEffect(() => {
    const onNav = (): void => setNavVersion((v) => v + 1);
    window.addEventListener('np:nav', onNav);
    return () => window.removeEventListener('np:nav', onNav);
  }, []);

  const enabledTabs = useMemo(() => {
    const allowed = loadNavPrefs(TABS.map((t) => t.id));
    void navVersion;
    return TABS.filter((t) => allowed.has(t.id));
  }, [navVersion]);

  // If the active tab was hidden via Customize, fall back to the home surface.
  useEffect(() => {
    if (!enabledTabs.some((t) => t.id === tab)) setTab('command');
  }, [enabledTabs, tab]);

  const navigate = (next: EnterpriseTab, query?: string): void => {
    if (next === 'search' && query !== undefined) setSearchQuery(query);
    setTab(next);
  };

  const pendingApprovals = jobs.reduce(
    (n, j) =>
      n +
      (j.status === 'awaiting_approval'
        ? j.proposals.filter((p) => p.verdict.decision === 'require_approval' && !p.approval).length
        : 0),
    0,
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto px-8 py-7" style={{ maxWidth: 1280 }}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Enterprise</h1>
            <p className="mt-1 text-md text-muted">
              The operating system for your organization — command, decide, explore, and run the
              business with governed AI.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-faint">
              <span className="relative flex h-2 w-2">
                <span
                  className={cn(
                    'absolute inline-flex h-full w-full rounded-full',
                    ready ? 'animate-ping bg-sysgreen opacity-60' : '',
                  )}
                />
                <span
                  className={cn(
                    'relative inline-flex h-2 w-2 rounded-full',
                    ready ? 'bg-sysgreen' : 'bg-faint',
                  )}
                />
              </span>
              {ready ? 'Live' : 'Connecting…'}
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

        <nav className="mb-6 flex gap-1 overflow-x-auto rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {enabledTabs.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => navigate(t.id)}
                className={cn(
                  'relative inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium outline-none transition focus-visible:shadow-focus',
                  active ? 'surface-raised text-ink shadow-sm' : 'text-muted hover:text-ink',
                )}
              >
                <Icon name={t.icon} size={15} />
                {t.label}
                {t.id === 'decision' && pendingApprovals > 0 && (
                  <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-2xs font-semibold text-black">
                    {pendingApprovals}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {tab === 'command' && <CommandCenterPanel onNavigate={navigate} />}
        {tab === 'executive' && <ExecutiveCenterPanel />}
        {tab === 'decision' && <DecisionCenterPanel onNavigate={navigate} />}
        {tab === 'organization' && <OrganizationExplorerPanel />}
        {tab === 'operations' && <BusinessOpsPanel />}
        {tab === 'process' && <ProcessExplorerPanel onNavigate={navigate} />}
        {tab === 'modules' && <EnterpriseModulesHub />}
        {tab === 'search' && <EnterpriseSearchPanel key={searchQuery} initialQuery={searchQuery} />}
        {tab === 'workspace' && <ExecutiveWorkspacePanel onNavigate={navigate} />}
        {tab === 'briefings' && <BriefingsPanel />}
        {tab === 'customize' && <CustomizePanel />}
      </div>
    </div>
  );
}
