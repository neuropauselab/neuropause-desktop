import { useEffect, useMemo, useState } from 'react';
import { cn } from '@renderer/lib/cn';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { DeveloperProvider, useDeveloper } from './DeveloperProvider';
import { DeveloperDashboardPanel } from './DeveloperDashboardPanel';
import { ApiKeysPanel } from './ApiKeysPanel';
import { MarketplacePanel } from './MarketplacePanel';
import { GatewayPanel } from './GatewayPanel';
import { BillingPanel } from './BillingPanel';
import { SdkDocsPanel } from './SdkDocsPanel';
import { loadNavPrefs, type DeveloperTab } from './lib';

interface TabDef {
  id: DeveloperTab;
  label: string;
  icon: IconName;
}

const TABS: TabDef[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'grid' },
  { id: 'apikeys', label: 'API Keys', icon: 'lock' },
  { id: 'marketplace', label: 'Marketplace', icon: 'store' },
  { id: 'gateway', label: 'API Gateway', icon: 'server' },
  { id: 'billing', label: 'Billing', icon: 'database' },
  { id: 'sdk', label: 'SDKs & Docs', icon: 'package' },
];

/** The Developer Portal, mounted with its live data provider. */
export function DeveloperRoot({ initialTab = 'dashboard' }: { initialTab?: DeveloperTab }): JSX.Element {
  return (
    <DeveloperProvider>
      <DeveloperInner initialTab={initialTab} />
    </DeveloperProvider>
  );
}

function DeveloperInner({ initialTab }: { initialTab: DeveloperTab }): JSX.Element {
  const { ready, refreshAll, dashboard } = useDeveloper();
  const [tab, setTab] = useState<DeveloperTab>(initialTab);
  const [navVersion, setNavVersion] = useState(0);

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

  useEffect(() => {
    if (!enabledTabs.some((t) => t.id === tab)) setTab('dashboard');
  }, [enabledTabs, tab]);

  const pendingReview = dashboard?.pendingReviewCount ?? 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto px-8 py-7" style={{ maxWidth: 1280 }}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Developer Portal</h1>
            <p className="mt-1 text-md text-muted">
              Build on NeuroPause — API keys, the publishing marketplace, the API gateway, SDKs, and billing.
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
                {t.id === 'marketplace' && pendingReview > 0 && (
                  <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-2xs font-semibold text-black">{pendingReview}</span>
                )}
              </button>
            );
          })}
        </nav>

        {tab === 'dashboard' && <DeveloperDashboardPanel onNavigate={setTab} />}
        {tab === 'apikeys' && <ApiKeysPanel />}
        {tab === 'marketplace' && <MarketplacePanel />}
        {tab === 'gateway' && <GatewayPanel />}
        {tab === 'billing' && <BillingPanel />}
        {tab === 'sdk' && <SdkDocsPanel />}
      </div>
    </div>
  );
}
