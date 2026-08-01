/**
 * Phase 6 Stage 6 — Intelligence Center host. Binds the dashboard view to the
 * read-only `insight:*` cluster. One failing read renders the explicit error
 * state; the view itself is pure presentation over the composed dashboard.
 *
 * Phase 6 Stage 12 — the host additionally carries the Center's tab strip:
 * the EXISTING Overview dashboard (unchanged) beside the new Analytics tab
 * (the Enterprise Analytics Platform's read-only `eana:*` composition). No
 * new Center, no navigation changes — one tab inside the existing workspace.
 */
import { useCallback, useEffect, useState } from 'react';
import type { InsightDashboard } from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { ipc } from '@renderer/lib/ipc';
import { EanaPlatformTab } from '@renderer/enterpriseAnalytics/EanaPlatformTab';
import { InsightCenterView } from './InsightCenterView';

type State =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; dashboard: InsightDashboard };

type Tab = 'overview' | 'analytics';

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'overview', label: 'Overview', icon: 'pulse' },
  { id: 'analytics', label: 'Analytics', icon: 'sparkles' },
];

export function InsightCenterHost({ onNavigate }: { onNavigate?: (section: 'assistant') => void }): JSX.Element {
  const [state, setState] = useState<State>({ state: 'loading' });
  const [tab, setTab] = useState<Tab>('overview');

  const refresh = useCallback((): void => {
    setState({ state: 'loading' });
    ipc.insight
      .dashboard()
      .then((dashboard) => setState({ state: 'ready', dashboard }))
      .catch((err: unknown) =>
        setState({ state: 'error', message: err instanceof Error ? err.message : String(err) }),
      );
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div>
      <nav className="mb-6 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
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
          </button>
        ))}
      </nav>
      {tab === 'overview' ? (
        <InsightCenterView
          state={state}
          onRefresh={refresh}
          {...(onNavigate ? { onNavigate } : {})}
        />
      ) : (
        <EanaPlatformTab />
      )}
    </div>
  );
}
