import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConnectorCategory, ConnectorDto, ConnectorLogEntry, ConnectorStats } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';
import { Stat } from '@renderer/operations/primitives';
import { CATEGORY_LABEL } from './connectorLib';
import { ConnectorCard } from './ConnectorCard';
import { ConnectorDetail, type ConnectorActions, type DetailNotice } from './ConnectorDetail';

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

export function ConnectorsPage(): JSX.Element {
  const [connectors, setConnectors] = useState<ConnectorDto[]>([]);
  const [stats, setStats] = useState<ConnectorStats | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [logs, setLogs] = useState<ConnectorLogEntry[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ConnectorCategory | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [notice, setNotice] = useState<DetailNotice | null>(null);

  const selectedIdRef = useRef<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    const [list, st] = await Promise.all([ipc.connectors.list(), ipc.connectors.stats()]);
    setConnectors(list);
    setStats(st);
  }, []);

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

  const categoriesPresent = useMemo(() => {
    const present = new Set(connectors.map((c) => c.category));
    return CATEGORY_ORDER.filter((c) => present.has(c));
  }, [connectors]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return connectors.filter((c) => {
      if (category !== 'all' && c.category !== category) return false;
      if (!q) return true;
      return c.name.toLowerCase().includes(q) || c.provider.toLowerCase().includes(q);
    });
  }, [connectors, query, category]);

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

  const issues = stats ? stats.degraded + stats.down : 0;

  return (
    <div className="flex h-full flex-col">
      {/* Header + stats */}
      <div className="px-8 pb-5 pt-7">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Connectors</h1>
            <p className="mt-1 text-md text-muted">
              Securely link your AI and SaaS accounts so NeuroPause can build your timeline and memory.
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

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat icon="connectors" label="Connectors" value={stats?.total ?? '—'} tone="accent" />
          <Stat icon="check" label="Connected" value={stats?.connected ?? '—'} tone="green" hint={`${stats?.configured ?? 0} configured`} />
          <Stat icon="user" label="Accounts" value={stats?.accounts ?? '—'} tone="blue" />
          <Stat icon="pulse" label="Need attention" value={issues} tone={issues > 0 ? 'orange' : 'gray'} />
        </div>
      </div>

      {/* Two-pane: list + detail */}
      <div className="flex min-h-0 flex-1 border-t border-[var(--hairline)]">
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
    </div>
  );
}

function CategoryPill({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-2xs font-medium outline-none transition focus-visible:shadow-focus',
        active ? 'surface-raised text-ink shadow-sm' : 'text-muted hover:text-ink',
      )}
    >
      {label}
    </button>
  );
}
