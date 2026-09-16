/**
 * ERP Session 34 — the operator-facing Platform Health panel. A read-only view of the platform's
 * liveness + readiness, fetched through the governed health IPC (`ipc.platform.health`) → the secure
 * bridge → the main health read branch → REAL runtime + persistence state. It mutates nothing; it
 * renders exactly the sanitized health the main process returns and never hardcodes GREEN.
 */
import { useCallback, useEffect, useState } from 'react';
import { ipc } from '@renderer/lib/ipc';
import { OpsPanel, StatusBadge } from '@renderer/operations/primitives';
import type { OpsTone } from '@renderer/operations/lib';
import { LoadingBlock } from '@renderer/operationsCenter/primitives';

interface Component { status: string; pendingOutbox?: number | null }
interface Health {
  status: string;
  live: boolean;
  ready: boolean;
  checkedAt: string;
  components: { runtime: Component; journal: Component; delivery: Component };
}

function overallTone(status: string): OpsTone {
  if (status === 'HEALTHY') return 'green';
  if (status === 'ALIVE_NOT_READY') return 'orange';
  return 'red'; // UNHEALTHY
}
function componentTone(status: string): OpsTone {
  if (status === 'ok' || status === 'first-run') return 'green';
  if (status === 'not_ready') return 'orange';
  return 'red'; // corrupt | down
}

export function PlatformHealthPanel(): JSX.Element {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [health, setHealth] = useState<Health | null>(null);
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    setState('loading');
    try {
      const resp = await ipc.platform.health();
      if (!resp.ok) {
        setMessage(resp.error?.message ?? 'Health is not available.');
        setState('error');
        return;
      }
      setHealth((resp.data ?? null) as unknown as Health | null);
      setState('ready');
    } catch {
      setMessage('Platform health could not be loaded.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (state === 'loading') return <LoadingBlock label="Checking platform health…" />;

  const rows: Array<{ label: string; status: string; detail?: string }> = health
    ? [
        { label: 'Runtime', status: health.components.runtime.status },
        { label: 'Journal (persistence)', status: health.components.journal.status },
        {
          label: 'Delivery (outbox)',
          status: health.components.delivery.status,
          detail: health.components.delivery.pendingOutbox != null ? `${health.components.delivery.pendingOutbox} pending` : undefined,
        },
      ]
    : [];

  return (
    <OpsPanel
      title="Platform health"
      subtitle="Liveness + readiness from real runtime & persistence state — read-only (durable journal + delivery relay)"
      actions={
        <button type="button" className="text-2xs text-muted hover:text-ink" onClick={() => void refresh()}>
          Refresh
        </button>
      }
    >
      {state === 'error' || !health ? (
        <StatusBadge tone="red" label={`Unavailable${message ? `: ${message}` : ''}`} />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            <StatusBadge tone={overallTone(health.status)} label={`Overall: ${health.status}`} />
            <StatusBadge tone={health.live ? 'green' : 'red'} label={`Live: ${health.live ? 'yes' : 'no'}`} />
            <StatusBadge tone={health.ready ? 'green' : 'orange'} label={`Ready: ${health.ready ? 'yes' : 'no'}`} />
          </div>
          <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
            {rows.map((r) => (
              <div key={r.label} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">{r.label}</div>
                  {r.detail && <div className="mt-0.5 text-2xs text-faint">{r.detail}</div>}
                </div>
                <StatusBadge tone={componentTone(r.status)} label={r.status} />
              </div>
            ))}
          </div>
          <div className="mt-2 text-2xs text-faint">Last checked {health.checkedAt}</div>
        </>
      )}
    </OpsPanel>
  );
}
