import { useEffect, useMemo, useState } from 'react';
import { cn } from '@renderer/lib/cn';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { EcosystemProvider, useEcosystem } from './EcosystemProvider';
import { WorkerMarketplacePanel } from './WorkerMarketplacePanel';
import { ConnectorMarketplacePanel } from './ConnectorMarketplacePanel';
import { TemplateMarketplacePanel } from './TemplateMarketplacePanel';
import { OrgExchangePanel } from './OrgExchangePanel';
import { PartnersPanel } from './PartnersPanel';
import { EcosystemAnalyticsPanel } from './EcosystemAnalyticsPanel';
import { loadNavPrefs, type EcosystemTab } from './lib';

interface TabDef {
  id: EcosystemTab;
  label: string;
  icon: IconName;
}

const TABS: TabDef[] = [
  { id: 'workers', label: 'Workers', icon: 'cpu' },
  { id: 'connectors', label: 'Connectors', icon: 'connectors' },
  { id: 'templates', label: 'Templates', icon: 'grid' },
  { id: 'exchange', label: 'Exchange', icon: 'package' },
  { id: 'partners', label: 'Partners', icon: 'verified' },
  { id: 'analytics', label: 'Analytics', icon: 'analytics' },
];

/** The Enterprise Ecosystem, mounted with its live data provider. */
export function EcosystemRoot({ initialTab = 'workers' }: { initialTab?: EcosystemTab }): JSX.Element {
  return (
    <EcosystemProvider>
      <EcosystemInner initialTab={initialTab} />
    </EcosystemProvider>
  );
}

function EcosystemInner({ initialTab }: { initialTab: EcosystemTab }): JSX.Element {
  const { ready, refreshAll, installSummary } = useEcosystem();
  const [tab, setTab] = useState<EcosystemTab>(initialTab);
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
    if (!enabledTabs.some((t) => t.id === tab)) setTab('workers');
  }, [enabledTabs, tab]);

  const updates = installSummary?.updatesAvailable ?? 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto px-8 py-7" style={{ maxWidth: 1280 }}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Ecosystem</h1>
            <p className="mt-1 text-md text-muted">
              The enterprise network — install AI workers, connectors, and templates, exchange packs across organizations, find partners, and track ecosystem health.
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
                {updates > 0 && (t.id === 'workers' || t.id === 'connectors' || t.id === 'templates') && (
                  <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-sysorange px-1 text-2xs font-semibold text-white">{updates}</span>
                )}
              </button>
            );
          })}
        </nav>

        {tab === 'workers' && <WorkerMarketplacePanel />}
        {tab === 'connectors' && <ConnectorMarketplacePanel />}
        {tab === 'templates' && <TemplateMarketplacePanel />}
        {tab === 'exchange' && <OrgExchangePanel />}
        {tab === 'partners' && <PartnersPanel />}
        {tab === 'analytics' && <EcosystemAnalyticsPanel />}
      </div>
    </div>
  );
}
