import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConnectorCategory, ConnectorDto, ConnectorLogEntry, ConnectorStats } from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { ipc } from '@renderer/lib/ipc';
import { useShell } from '@renderer/state/ShellProvider';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { Chip } from '@renderer/components/ui/pillTabs';
import { Stat, StatusBadge } from '@renderer/operations/primitives';
import { ErrorBlock } from '@renderer/operationsCenter/primitives';
import { EcosystemProvider } from '@renderer/ecosystem/EcosystemProvider';
import { ConnectorMarketplacePanel } from '@renderer/ecosystem/ConnectorMarketplacePanel';
import { CATEGORY_LABEL } from './connectorLib';
import { ConnectorCard } from './ConnectorCard';
import { ConnectorDetail, type ConnectorActions, type DetailNotice } from './ConnectorDetail';
import { IntegrationHealthPanel } from './IntegrationHealthPanel';
import {
  connectorNeedsAttention,
  connectorStatusMeta,
  filterConnectors,
  overviewMetrics,
  presentCategories,
} from './connectorCenterModel';

/** A consistent display order for category pills. */
const CATEGORY_ORDER: ConnectorCategory[] = [
  'ai_assistant',
  'developer',
  'productivity',
  'project_management',
  'communication',
  'design',
  'storage',
  'calendar',
  'automation',
];

/** The three top-level surfaces of the Enterprise Connector Center. */
export type ConnectorCenterTab = 'overview' | 'connections' | 'marketplace';

interface CenterTabDef {
  id: ConnectorCenterTab;
  label: string;
  icon: IconName;
}

const CENTER_TABS: CenterTabDef[] = [
  { id: 'overview', label: 'Overview', icon: 'gauge' },
  { id: 'connections', label: 'Connections', icon: 'connectors' },
  { id: 'marketplace', label: 'Marketplace', icon: 'store' },
];

/**
 * The Enterprise Connector Center — the single management experience for every connector family.
 * One hub with three surfaces: an Overview roll-up of health across all families, the Connections
 * two-pane (browse / connect / manage / inspect, including the runtime-driven per-service view), and
 * the Connector Marketplace. It composes the EXISTING connector primitives (cards, detail, inspector,
 * health panel, marketplace) — no parallel UI, no new runtime. Future connector families appear here
 * automatically because the list, health, and per-service capabilities are all read from the runtime.
 */
export function ConnectorCenterRoot(): JSX.Element {
  const { connectorsTab, clearConnectorsTab } = useShell();

  const [connectors, setConnectors] = useState<ConnectorDto[]>([]);
  const [stats, setStats] = useState<ConnectorStats | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [logs, setLogs] = useState<ConnectorLogEntry[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ConnectorCategory | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [notice, setNotice] = useState<DetailNotice | null>(null);
  const [tab, setTab] = useState<ConnectorCenterTab>(() =>
    CENTER_TABS.some((t) => t.id === connectorsTab) ? (connectorsTab as ConnectorCenterTab) : 'overview',
  );

  const selectedIdRef = useRef<string | null>(null);

  // Honor a one-shot deep-link target from the Command Palette, then clear it.
  useEffect(() => {
    if (connectorsTab && CENTER_TABS.some((t) => t.id === connectorsTab)) {
      setTab(connectorsTab as ConnectorCenterTab);
      clearConnectorsTab();
    }
  }, [connectorsTab, clearConnectorsTab]);

  const reload = useCallback(async (): Promise<void> => {
    // Honest failure: if the connector runtime can't be read, surface it instead of
    // letting the list fall back to an empty "No connectors registered" state that
    // is indistinguishable from a healthy, unconfigured environment.
    try {
      const [list, st] = await Promise.all([ipc.connectors.list(), ipc.connectors.stats()]);
      setConnectors(list);
      setStats(st);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load connectors');
    }
  }, []);

  const retry = useCallback((): void => {
    setLoading(true);
    void reload().finally(() => setLoading(false));
  }, [reload]);

  const reloadLogs = useCallback(async (id: string | null): Promise<void> => {
    if (!id) {
      setLogs([]);
      return;
    }
    setLogs(await ipc.connectors.logs(id));
  }, []);

  // Initial load + a single live subscription that refreshes on any event.
  useEffect(() => {
    void reload().finally(() => setLoading(false));
    const unsub = ipc.connectors.onEvent(() => {
      void reload();
      void reloadLogs(selectedIdRef.current);
    });
    return unsub;
  }, [reload, reloadLogs]);

  // Auto-select the first connector once data arrives.
  useEffect(() => {
    if (!selectedId && connectors.length > 0) setSelectedId(connectors[0].id);
  }, [connectors, selectedId]);

  // On selection change: load its logs and clear any stale notice.
  useEffect(() => {
    selectedIdRef.current = selectedId;
    setNotice(null);
    void reloadLogs(selectedId);
  }, [selectedId, reloadLogs]);

  const selected = useMemo(
    () => connectors.find((c) => c.id === selectedId) ?? null,
    [connectors, selectedId],
  );

  const categoriesPresent = useMemo(
    () => presentCategories(connectors, CATEGORY_ORDER),
    [connectors],
  );

  const filtered = useMemo(
    () => filterConnectors(connectors, { query, category }),
    [connectors, query, category],
  );

  /** Wraps an action: toggles busy state, surfaces a notice, then refreshes. */
  const runAction = useCallback(
    async (
      kind: 'connect' | 'mutate',
      fn: () => Promise<DetailNotice | null>,
    ): Promise<void> => {
      if (kind === 'connect') setConnecting(true);
      else setPending(true);
      try {
        const result = await fn();
        setNotice(result);
      } catch (err) {
        setNotice({ tone: 'red', text: err instanceof Error ? err.message : 'Action failed' });
      } finally {
        if (kind === 'connect') setConnecting(false);
        else setPending(false);
        await reload();
        await reloadLogs(selectedIdRef.current);
      }
    },
    [reload, reloadLogs],
  );

  const actions: ConnectorActions = useMemo(() => {
    const id = selected?.id;
    return {
      onConnect: () => {
        if (!id) return;
        void runAction('connect', async () => {
          const r = await ipc.connectors.connect(id);
          return r.ok
            ? { tone: 'green', text: `Connected ${r.account?.label ?? 'account'}.` }
            : { tone: 'red', text: r.message ?? 'Connection failed.' };
        });
      },
      onReconnect: (accountId) => {
        if (!id) return;
        void runAction('connect', async () => {
          const r = await ipc.connectors.reconnect(id, accountId);
          return r.ok ? { tone: 'green', text: 'Reconnected.' } : { tone: 'red', text: r.message ?? 'Reconnect failed.' };
        });
      },
      onDisconnect: (accountId) => {
        if (!id) return;
        void runAction('mutate', async () => {
          const r = await ipc.connectors.disconnect(id, accountId);
          return r.ok ? { tone: 'gray', text: 'Disconnected.' } : { tone: 'red', text: r.message ?? 'Disconnect failed.' };
        });
      },
      onRefresh: (accountId) => {
        if (!id) return;
        void runAction('mutate', async () => {
          const r = await ipc.connectors.refresh(id, accountId);
          return r.ok ? { tone: 'green', text: 'Access token refreshed.' } : { tone: 'orange', text: r.message ?? 'Refresh failed.' };
        });
      },
      onSync: (accountId) => {
        if (!id) return;
        void runAction('mutate', async () => {
          const r = await ipc.connectors.sync(id, accountId ?? null);
          return r.ok
            ? { tone: 'green', text: r.message ?? 'Connection verified.' }
            : { tone: 'orange', text: r.message ?? 'Sync could not run.' };
        });
      },
      onCheckHealth: () => {
        if (!id) return;
        void runAction('mutate', async () => {
          await ipc.connectors.checkHealth(id);
          return { tone: 'gray', text: 'Health re-checked.' };
        });
      },
    };
  }, [selected, runAction]);

  /** Open a specific connector in the Connections pane (used by the Overview grid). */
  const openConnector = useCallback((id: string) => {
    setSelectedId(id);
    setTab('connections');
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* Header + sub-navigation */}
      <div className="px-8 pb-0 pt-7">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Connector Center</h1>
            <p className="mt-1 text-md text-muted">
              The single control center for every integration — connect, manage, inspect, and discover connector families.
            </p>
          </div>
          <button
            type="button"
            aria-label="Refresh"
            title="Refresh"
            onClick={() => void reload()}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted fill-hover hover:text-ink"
          >
            <Icon name="refresh" size={16} />
          </button>
        </div>

        <nav className="flex gap-1 overflow-x-auto rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {CENTER_TABS.map((t) => {
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
              </button>
            );
          })}
        </nav>
      </div>

      {/* Active surface */}
      <div className="min-h-0 flex-1">
        {error && !loading && connectors.length === 0 ? (
          <div className="p-8">
            <ErrorBlock title="Couldn’t load connectors" message={error} onRetry={retry} />
          </div>
        ) : (
          <>
        {tab === 'overview' && (
          <ConnectorOverview connectors={connectors} stats={stats} loading={loading} onOpen={openConnector} />
        )}

        {tab === 'connections' && (
          <div className="flex h-full border-t border-[var(--hairline)]">
            <aside className="flex w-72 shrink-0 flex-col border-r border-[var(--hairline)]">
              <div className="border-b border-[var(--hairline)] p-3">
                <div className="flex items-center gap-2 rounded-lg [background:var(--fill-1)] px-2.5 py-1.5">
                  <Icon name="search" size={14} className="text-faint" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search connectors"
                    className="w-full bg-transparent text-sm outline-none placeholder:text-faint"
                  />
                </div>
                <div className="mt-2 flex gap-1 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <CategoryPill active={category === 'all'} label="All" onClick={() => setCategory('all')} />
                  {categoriesPresent.map((c) => (
                    <CategoryPill key={c} active={category === c} label={CATEGORY_LABEL[c]} onClick={() => setCategory(c)} />
                  ))}
                </div>
              </div>
              <div className="flex-1 space-y-1 overflow-y-auto p-2">
                {loading ? (
                  <div className="px-3 py-6 text-center text-2xs text-faint">Loading connectors…</div>
                ) : filtered.length === 0 ? (
                  <div className="px-3 py-6 text-center text-2xs text-faint">No connectors match.</div>
                ) : (
                  filtered.map((c) => (
                    <ConnectorCard key={c.id} dto={c} selected={c.id === selectedId} onSelect={() => setSelectedId(c.id)} />
                  ))
                )}
              </div>
            </aside>

            <main className="min-w-0 flex-1">
              {selected ? (
                <ConnectorDetail
                  dto={selected}
                  logs={logs}
                  actions={actions}
                  pending={pending}
                  connecting={connecting}
                  notice={notice}
                />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-faint">
                  {loading ? '' : 'Select a connector to view details.'}
                </div>
              )}
            </main>
          </div>
        )}

        {tab === 'marketplace' && (
          <div className="h-full overflow-y-auto border-t border-[var(--hairline)]">
            <div className="px-8 py-6">
              <EcosystemProvider>
                <ConnectorMarketplacePanel />
              </EcosystemProvider>
            </div>
          </div>
        )}
          </>
        )}
      </div>
    </div>
  );
}

/** The Overview surface — headline metrics, the integration-health roll-up, and an all-families grid. */
function ConnectorOverview({
  connectors,
  stats,
  loading,
  onOpen,
}: {
  connectors: ConnectorDto[];
  stats: ConnectorStats | null;
  loading: boolean;
  onOpen: (id: string) => void;
}): JSX.Element {
  const m = overviewMetrics(stats);
  return (
    <div className="h-full overflow-y-auto border-t border-[var(--hairline)]">
      <div className="px-8 py-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat icon="connectors" label="Connectors" value={stats ? m.total : '—'} tone="accent" />
          <Stat icon="check" label="Connected" value={stats ? m.connected : '—'} tone="green" hint={`${m.configured} configured`} />
          <Stat icon="user" label="Accounts" value={stats ? m.accounts : '—'} tone="blue" />
          <Stat icon="pulse" label="Need attention" value={m.attention} tone={m.attention > 0 ? 'orange' : 'gray'} />
        </div>

        <IntegrationHealthPanel />

        <div className="mt-6">
          <h2 className="mb-3 text-sm font-semibold tracking-tight">All connector families</h2>
          {loading ? (
            <div className="py-8 text-center text-2xs text-faint">Loading connectors…</div>
          ) : connectors.length === 0 ? (
            <div className="py-8 text-center text-2xs text-faint">No connectors registered.</div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {connectors.map((c) => {
                const meta = connectorStatusMeta(c.status, c.health);
                const attention = connectorNeedsAttention(c);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onOpen(c.id)}
                    className={cn(
                      'surface-raised flex items-center gap-3 rounded-xl border p-3 text-left shadow-card transition hover:shadow-pop focus-visible:shadow-focus',
                      attention ? 'border-sysorange/40' : 'border-[var(--hairline)]',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-ink">{c.name}</div>
                      <div className="mt-0.5 truncate text-2xs text-faint">
                        {c.accounts.length} {c.accounts.length === 1 ? 'account' : 'accounts'}
                        {c.lastSyncAt ? ' · synced' : c.configured ? ' · idle' : ' · not configured'}
                      </div>
                    </div>
                    <StatusBadge tone={meta.tone} label={meta.label} />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CategoryPill({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }): JSX.Element {
  // CategoryPill now delegates to the shared pill Chip for one consistent look.
  return <Chip label={label} active={active} onClick={onClick} />;
}
