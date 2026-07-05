import { useEffect, useMemo, useState } from 'react';
import { cn } from '@renderer/lib/cn';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { FederationProvider, useFederation } from './FederationProvider';
import { RuntimePanel } from './RuntimePanel';
import { ExchangePanel } from './ExchangePanel';
import { MarketplacePanel } from './MarketplacePanel';
import { GovernancePanel } from './GovernancePanel';
import { ObservabilityPanel } from './ObservabilityPanel';
import { RecoveryPanel } from './RecoveryPanel';
import { AdminPanel } from './AdminPanel';
import { loadFederationNav, type FederationTab } from './lib';

interface TabDef {
  id: FederationTab;
  label: string;
  icon: IconName;
}

const TABS: TabDef[] = [
  { id: 'runtime', label: 'Runtime', icon: 'layers' },
  { id: 'exchange', label: 'Exchange', icon: 'package' },
  { id: 'marketplace', label: 'Marketplace', icon: 'store' },
  { id: 'governance', label: 'Governance', icon: 'shield' },
  { id: 'observability', label: 'Observability', icon: 'gauge' },
  { id: 'recovery', label: 'Recovery', icon: 'refresh' },
  { id: 'admin', label: 'Administration', icon: 'settings' },
];

/** The Federation Platform, mounted with its live data provider. */
export function FederationRoot({ initialTab = 'runtime' }: { initialTab?: FederationTab }): JSX.Element {
  return (
    <FederationProvider>
      <FederationInner initialTab={initialTab} />
    </FederationProvider>
  );
}

function FederationInner({ initialTab }: { initialTab: FederationTab }): JSX.Element {
  const { ready, refreshAll, summary } = useFederation();
  const [tab, setTab] = useState<FederationTab>(initialTab);
  const [navVersion, setNavVersion] = useState(0);

  useEffect(() => {
    const onNav = (): void => setNavVersion((v) => v + 1);
    window.addEventListener('np:nav', onNav);
    return () => window.removeEventListener('np:nav', onNav);
  }, []);

  const enabledTabs = useMemo(() => {
    const allowed = loadFederationNav();
    void navVersion;
    return TABS.filter((t) => allowed.has(t.id));
  }, [navVersion]);

  useEffect(() => {
    if (!enabledTabs.some((t) => t.id === tab)) setTab('runtime');
  }, [enabledTabs, tab]);

  const pendingInvites = summary?.pendingInvites ?? 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto px-8 py-7" style={{ maxWidth: 1280 }}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Federation</h1>
            <p className="mt-1 text-md text-muted">
              Secure collaboration across organizations — federated runtime, a signed organization exchange, marketplace scopes, global governance, observability, disaster recovery, and administration, with strict tenant isolation throughout.
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
            <button type="button" aria-label="Refresh" title="Refresh" onClick={() => void refreshAll()} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted fill-hover hover:text-ink">
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
                onClick={() => setTab(t.id)}
                className={cn('relative inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium outline-none transition focus-visible:shadow-focus', active ? 'surface-raised text-ink shadow-sm' : 'text-muted hover:text-ink')}
              >
                <Icon name={t.icon} size={15} />
                {t.label}
                {pendingInvites > 0 && t.id === 'runtime' && (
                  <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-2xs font-semibold text-black">{pendingInvites}</span>
                )}
              </button>
            );
          })}
        </nav>

        {tab === 'runtime' && <RuntimePanel />}
        {tab === 'exchange' && <ExchangePanel />}
        {tab === 'marketplace' && <MarketplacePanel />}
        {tab === 'governance' && <GovernancePanel />}
        {tab === 'observability' && <ObservabilityPanel />}
        {tab === 'recovery' && <RecoveryPanel />}
        {tab === 'admin' && <AdminPanel />}
      </div>
    </div>
  );
}
