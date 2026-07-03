import { useState } from 'react';
import { cn } from '@renderer/lib/cn';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { WorkforceProvider, useWorkforce } from './WorkforceProvider';
import { MissionControlPanel } from './MissionControlPanel';
import { DashboardPanel } from './DashboardPanel';
import { ApprovalCenterPanel } from './ApprovalCenterPanel';
import { AutomationStudioPanel } from './AutomationStudioPanel';
import { AnalyticsPanel } from './AnalyticsPanel';
import { ExecutiveChatPanel } from './ExecutiveChatPanel';
import { pendingApprovalCount, type WorkforceTab } from './lib';

interface TabDef {
  id: WorkforceTab;
  label: string;
  icon: IconName;
}

const TABS: TabDef[] = [
  { id: 'mission', label: 'Mission Control', icon: 'gauge' },
  { id: 'workers', label: 'Workforce', icon: 'cpu' },
  { id: 'approvals', label: 'Approvals', icon: 'shield' },
  { id: 'studio', label: 'Automation Studio', icon: 'automations' },
  { id: 'analytics', label: 'Analytics', icon: 'analytics' },
  { id: 'executive', label: 'Executive Chat', icon: 'sparkles' },
];

/** The AI Workforce experience, mounted with its live data provider. */
export function WorkforceRoot({ initialTab = 'mission' }: { initialTab?: WorkforceTab }): JSX.Element {
  return (
    <WorkforceProvider>
      <WorkforceInner initialTab={initialTab} />
    </WorkforceProvider>
  );
}

function WorkforceInner({ initialTab }: { initialTab: WorkforceTab }): JSX.Element {
  const { ready, refreshAll, jobs } = useWorkforce();
  const [tab, setTab] = useState<WorkforceTab>(initialTab);

  const pendingApprovals = jobs.reduce(
    (n, j) => n + (j.status === 'awaiting_approval' ? pendingApprovalCount(j.proposals) : 0),
    0,
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto px-8 py-7" style={{ maxWidth: 1240 }}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">AI Workforce</h1>
            <p className="mt-1 text-md text-muted">
              Nine governed AI workers that propose, await your approval, and act under policy — with full evidence and audit.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-faint">
              <span className="relative flex h-2 w-2">
                <span className={cn('absolute inline-flex h-full w-full rounded-full', ready ? 'animate-ping bg-sysgreen opacity-60' : '')} />
                <span className={cn('relative inline-flex h-2 w-2 rounded-full', ready ? 'bg-sysgreen' : 'bg-faint')} />
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
                  'relative inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium outline-none transition focus-visible:shadow-focus',
                  active ? 'surface-raised text-ink shadow-sm' : 'text-muted hover:text-ink',
                )}
              >
                <Icon name={t.icon} size={15} />
                {t.label}
                {t.id === 'approvals' && pendingApprovals > 0 && (
                  <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-sysorange px-1 text-2xs font-semibold text-white">
                    {pendingApprovals}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Active panel */}
        {tab === 'mission' && <MissionControlPanel onNavigate={setTab} />}
        {tab === 'workers' && <DashboardPanel onNavigate={setTab} />}
        {tab === 'approvals' && <ApprovalCenterPanel />}
        {tab === 'studio' && <AutomationStudioPanel onNavigate={setTab} />}
        {tab === 'analytics' && <AnalyticsPanel />}
        {tab === 'executive' && <ExecutiveChatPanel />}
      </div>
    </div>
  );
}
