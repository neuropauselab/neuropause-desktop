import { useEffect, useMemo, useState } from 'react';
import { cn } from '@renderer/lib/cn';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { CloudProvider, useCloud } from './CloudProvider';
import { TenancyPanel } from './TenancyPanel';
import { IdentityPanel } from './IdentityPanel';
import { SyncPanel } from './SyncPanel';
import { ApiPlatformPanel } from './ApiPlatformPanel';
import { AdminPanel } from './AdminPanel';
import { loadCloudNav, type CloudTab } from './lib';

interface TabDef {
  id: CloudTab;
  label: string;
  icon: IconName;
}

const TABS: TabDef[] = [
  { id: 'tenants', label: 'Tenants', icon: 'grid' },
  { id: 'identity', label: 'Identity', icon: 'lock' },
  { id: 'sync', label: 'Sync', icon: 'refresh' },
  { id: 'apiplatform', label: 'API Platform', icon: 'server' },
  { id: 'admin', label: 'Administration', icon: 'gauge' },
];

/** The Cloud Platform, mounted with its live data provider. */
export function CloudRoot({ initialTab = 'tenants' }: { initialTab?: CloudTab }): JSX.Element {
  return (
    <CloudProvider>
      <CloudInner initialTab={initialTab} />
    </CloudProvider>
  );
}

function CloudInner({ initialTab }: { initialTab: CloudTab }): JSX.Element {
  const { ready, refreshAll, liveSync } = useCloud();
  const [tab, setTab] = useState<CloudTab>(initialTab);
  const [navVersion, setNavVersion] = useState(0);

  useEffect(() => {
    const onNav = (): void => setNavVersion((v) => v + 1);
    window.addEventListener('np:nav', onNav);
    return () => window.removeEventListener('np:nav', onNav);
  }, []);

  const enabledTabs = useMemo(() => {
    const allowed = loadCloudNav();
    void navVersion;
    return TABS.filter((t) => allowed.has(t.id));
  }, [navVersion]);

  useEffect(() => {
    if (!enabledTabs.some((t) => t.id === tab)) setTab('tenants');
  }, [enabledTabs, tab]);

  const pending = liveSync?.status.pendingCount ?? 0;
  const offline = liveSync ? !liveSync.status.online : false;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto px-8 py-7" style={{ maxWidth: 1280 }}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Cloud</h1>
            <p className="mt-1 text-md text-muted">
              The distributed control plane — multi-tenant runtime across regions, identity federation, offline-first cloud sync, the API gateway as a service, and enterprise administration.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-faint">
              <span className="relative flex h-2 w-2">
                <span className={cn('absolute inline-flex h-full w-full rounded-full', ready && !offline ? 'animate-ping bg-sysgreen opacity-60' : '')} />
                <span className={cn('relative inline-flex h-2 w-2 rounded-full', offline ? 'bg-faint' : ready ? 'bg-sysgreen' : 'bg-faint')} />
              </span>
              {offline ? 'Offline' : ready ? 'Live' : 'Connecting…'}
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
                {pending > 0 && t.id === 'sync' && (
                  <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-2xs font-semibold text-black">{pending}</span>
                )}
              </button>
            );
          })}
        </nav>

        {tab === 'tenants' && <TenancyPanel />}
        {tab === 'identity' && <IdentityPanel />}
        {tab === 'sync' && <SyncPanel />}
        {tab === 'apiplatform' && <ApiPlatformPanel />}
        {tab === 'admin' && <AdminPanel />}
      </div>
    </div>
  );
}
