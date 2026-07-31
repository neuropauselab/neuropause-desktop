/**
 * Phase 6 Stage 7 — Knowledge Platform host. Binds the tab to the read-only
 * `kb:*` cluster (dashboard read). One failing read renders the explicit error
 * state; the view itself is pure presentation over the composed dashboard.
 */
import { useCallback, useEffect, useState } from 'react';
import type { KnowledgeAssetDashboard } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { KnowledgeAssetsView } from './KnowledgeAssetsView';

type State =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; dashboard: KnowledgeAssetDashboard };

export function KnowledgeAssetsHost(): JSX.Element {
  const [state, setState] = useState<State>({ state: 'loading' });

  const refresh = useCallback((): void => {
    setState({ state: 'loading' });
    ipc.kb
      .dashboard()
      .then((dashboard) => setState({ state: 'ready', dashboard }))
      .catch((err: unknown) =>
        setState({ state: 'error', message: err instanceof Error ? err.message : String(err) }),
      );
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return <KnowledgeAssetsView state={state} onRefresh={refresh} />;
}
