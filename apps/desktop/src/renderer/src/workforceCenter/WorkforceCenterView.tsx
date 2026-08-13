/**
 * P8.6 — Enterprise Workforce Center. A dedicated management console (the house "Center"
 * pattern — cf. OpsCenterView) that reuses the existing WorkforceProvider, primitives, and
 * every workforce IPC. Sub-tabs: Overview, Workers (details), Install Manager, Execution,
 * Health, Delegation. No new runtime, registry, governance, or state framework.
 */
import { useState } from 'react';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { cn } from '@renderer/lib/cn';
import { WorkforceProvider, useWorkforce } from '@renderer/workforce/WorkforceProvider';
import { ExecutionPanel, HealthPanel, OverviewPanel } from './panels';
import { WorkersPanel } from './WorkersPanel';
import { InstallManagerPanel } from './InstallManagerPanel';
import { DelegationPanel } from './DelegationPanel';
import { approvalQueue, type CenterTab } from './workforceCenterModel';

const TABS: { id: CenterTab; label: string; icon: IconName }[] = [
  { id: 'overview', label: 'Overview', icon: 'gauge' },
  { id: 'workers', label: 'Workers', icon: 'cpu' },
  { id: 'installs', label: 'Install Manager', icon: 'package' },
  { id: 'execution', label: 'Execution', icon: 'clock' },
  { id: 'health', label: 'Health', icon: 'heart' },
  { id: 'delegation', label: 'Delegation', icon: 'grid' },
];

export function WorkforceCenterView(): JSX.Element {
  return (
    <WorkforceProvider>
      <CenterInner />
    </WorkforceProvider>
  );
}

function CenterInner(): JSX.Element {
  const { ready, installs, jobs, refreshAll } = useWorkforce();
  const [tab, setTab] = useState<CenterTab>('overview');
  const pending = approvalQueue(jobs).length;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto px-8 py-7" style={{ maxWidth: 1320 }}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Workforce Admin</h1>
            <p className="mt-1 text-md text-muted">
              Manage the enterprise AI workforce — workers, installs, execution, health, and delegation.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-faint">
              <span className="relative flex h-2 w-2">
                {ready && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/60 opacity-60" />}
                <span className={cn('relative inline-flex h-2 w-2 rounded-full', ready ? 'bg-white/70' : 'bg-white/30')} />
              </span>
              {ready ? 'Live' : 'Connecting…'}
            </span>
            <button
              type="button"
              onClick={() => void refreshAll()}
              aria-label="Refresh"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted fill-hover hover:text-ink"
            >
              <Icon name="refresh" size={16} />
            </button>
          </div>
        </div>

        <nav className="mb-6 flex flex-wrap gap-1.5">
          {TABS.map((t) => {
            const count = t.id === 'installs' ? installs.length : t.id === 'execution' ? pending : 0;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition',
                  tab === t.id ? 'bg-white/10 text-ink' : 'text-muted hover:bg-white/5 hover:text-ink',
                )}
              >
                <Icon name={t.icon} size={15} />
                {t.label}
                {count > 0 && (
                  <span className="rounded-full bg-white/15 px-1.5 py-0.5 text-2xs tabular text-ink">{count}</span>
                )}
              </button>
            );
          })}
        </nav>

        {tab === 'overview' && <OverviewPanel onOpen={setTab} />}
        {tab === 'workers' && <WorkersPanel />}
        {tab === 'installs' && <InstallManagerPanel />}
        {tab === 'execution' && <ExecutionPanel />}
        {tab === 'health' && <HealthPanel />}
        {tab === 'delegation' && <DelegationPanel />}
      </div>
    </div>
  );
}
