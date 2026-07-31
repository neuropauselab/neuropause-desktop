/**
 * Phase 6 Stage 6 — Intelligence Center host. Binds the dashboard view to the
 * read-only `insight:*` cluster. One failing read renders the explicit error
 * state; the view itself is pure presentation over the composed dashboard.
 */
import { useCallback, useEffect, useState } from 'react';
import type { InsightDashboard } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { InsightCenterView } from './InsightCenterView';

type State =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; dashboard: InsightDashboard };

export function InsightCenterHost({ onNavigate }: { onNavigate?: (section: 'assistant') => void }): JSX.Element {
  const [state, setState] = useState<State>({ state: 'loading' });

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
    <InsightCenterView
      state={state}
      onRefresh={refresh}
      {...(onNavigate ? { onNavigate } : {})}
    />
  );
}
