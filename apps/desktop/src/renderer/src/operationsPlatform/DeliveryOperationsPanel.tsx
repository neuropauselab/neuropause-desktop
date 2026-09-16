/**
 * ERP Session 35 — the operator-facing Delivery Operations panel. A read-only drill-down into real
 * outbox/delivery FAILURES from the S31 relay, fetched through the governed delivery-operations IPC
 * (`ipc.platform.deliveryOperations`) → the secure bridge → the main read branch → the durable command
 * journal's outbox state, tenant-scoped and authorized server-side. It mutates nothing (no retry /
 * replay / force-deliver — those are undefined policy and OUT OF SCOPE); it renders exactly the
 * sanitized delivery state the main process returns and NEVER hardcodes success — a failed/pending
 * delivery visibly stays failed/pending.
 */
import { useCallback, useEffect, useState } from 'react';
import { ipc } from '@renderer/lib/ipc';
import { OpsPanel, StatusBadge } from '@renderer/operations/primitives';
import type { OpsTone } from '@renderer/operations/lib';
import { EmptyState, LoadingBlock } from '@renderer/operationsCenter/primitives';

interface DeliveryRow {
  txId: string;
  eventType: string;
  aggregateId?: string;
  deliveryState: string;
  status: string;
  attempts: number;
  queuedAt?: string;
  deliveredAt?: string;
  lastError?: string;
}
interface Counts {
  total: number;
  pending: number;
  inFlight: number;
  retryable: number;
  delivered: number;
}
interface DeliveryData {
  counts: Counts;
  deliveries: DeliveryRow[];
}

/** Delivery state → tone. RETRYING (a real failure) is red so it can never read as success. */
function stateTone(state: string): OpsTone {
  if (state === 'DELIVERED') return 'green';
  if (state === 'RETRYING') return 'red';
  if (state === 'IN_FLIGHT') return 'blue';
  return 'orange'; // PENDING (queued, not yet attempted)
}

const EMPTY_COUNTS: Counts = { total: 0, pending: 0, inFlight: 0, retryable: 0, delivered: 0 };

export function DeliveryOperationsPanel(): JSX.Element {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [data, setData] = useState<DeliveryData | null>(null);
  const [message, setMessage] = useState<string>('');

  const refresh = useCallback(async () => {
    setState('loading');
    try {
      const resp = await ipc.platform.deliveryOperations({ limit: 25 });
      if (!resp.ok) {
        setMessage(resp.error?.message ?? 'Delivery operations are not available.');
        setState('error');
        return;
      }
      setData((resp.data ?? { counts: EMPTY_COUNTS, deliveries: [] }) as unknown as DeliveryData);
      setState('ready');
    } catch {
      setMessage('Delivery operations could not be loaded.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (state === 'loading') return <LoadingBlock label="Loading delivery operations…" />;

  const counts = data?.counts ?? EMPTY_COUNTS;
  const rows = data?.deliveries ?? [];

  return (
    <OpsPanel
      title="Delivery operations"
      subtitle="Outbox delivery state per committed event — pending · retrying · delivered — tenant-scoped, read-only (durable outbox; S31 relay)"
      actions={
        <button type="button" className="text-2xs text-muted hover:text-ink" onClick={() => void refresh()}>
          Refresh
        </button>
      }
    >
      <div className="mb-3 flex flex-wrap gap-2">
        <StatusBadge tone="gray" label={`Total: ${counts.total}`} />
        <StatusBadge tone={counts.pending > 0 ? 'orange' : 'green'} label={`Pending: ${counts.pending}`} />
        <StatusBadge tone={counts.inFlight > 0 ? 'blue' : 'gray'} label={`In-flight: ${counts.inFlight}`} />
        <StatusBadge tone={counts.retryable > 0 ? 'red' : 'green'} label={`Retrying: ${counts.retryable}`} />
        <StatusBadge tone="green" label={`Delivered: ${counts.delivered}`} />
      </div>
      {state === 'error' ? (
        <EmptyState title="Unavailable" hint={message} />
      ) : rows.length === 0 ? (
        <EmptyState title="No deliveries yet" hint="Outbox deliveries from governed commands will appear here as they run." />
      ) : (
        <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
          {rows.map((r) => (
            <div key={r.txId} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-ink">
                  {r.eventType} <span className="text-2xs text-faint">· {r.aggregateId ?? '—'}</span>
                </div>
                <div className="mt-0.5 text-2xs text-faint">
                  {`attempts: ${r.attempts}`}
                  {` · queued ${r.queuedAt ?? '—'}`}
                  {r.deliveredAt ? ` · delivered ${r.deliveredAt}` : ''}
                  {r.lastError ? ` · ${r.lastError}` : ''}
                </div>
              </div>
              <StatusBadge tone={stateTone(r.deliveryState)} label={r.deliveryState} />
            </div>
          ))}
        </div>
      )}
    </OpsPanel>
  );
}
