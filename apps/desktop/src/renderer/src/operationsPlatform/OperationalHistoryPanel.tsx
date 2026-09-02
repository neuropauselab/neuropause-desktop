/**
 * ERP Session 32 — the operator-facing Operational History panel. A read-only view of governed
 * platform command history + outbox/delivery status, fetched through the governed operational READ
 * IPC (`ipc.platform.operationalHistory`) → the secure bridge → the main read branch → the durable
 * command journal + the S31 delivered-event sink, tenant-scoped and authorized server-side. It
 * mutates nothing; it only renders the sanitized read model the main process returns.
 */
import { useCallback, useEffect, useState } from 'react';
import { ipc } from '@renderer/lib/ipc';
import { OpsPanel, StatusBadge } from '@renderer/operations/primitives';
import type { OpsTone } from '@renderer/operations/lib';
import { EmptyState, LoadingBlock } from '@renderer/operationsCenter/primitives';

interface CommandRow {
  txId: string;
  commandType: string;
  actor?: string;
  committedAt?: string;
  outbox?: { status: string; attempts: number; lastError?: string };
}
interface Counts {
  commands: number;
  pendingOutbox: number;
  delivered: number;
}
interface HistoryData {
  counts: Counts;
  commands: CommandRow[];
}

function outboxTone(status: string): OpsTone {
  if (status === 'DELIVERED') return 'green';
  if (status === 'RETRYABLE') return 'orange';
  if (status === 'PROCESSING') return 'blue';
  return 'gray';
}

export function OperationalHistoryPanel(): JSX.Element {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [data, setData] = useState<HistoryData | null>(null);
  const [message, setMessage] = useState<string>('');

  const refresh = useCallback(async () => {
    setState('loading');
    try {
      const resp = await ipc.platform.operationalHistory({ limit: 25 });
      if (!resp.ok) {
        setMessage(resp.error?.message ?? 'Operational history is not available.');
        setState('error');
        return;
      }
      setData((resp.data ?? { counts: { commands: 0, pendingOutbox: 0, delivered: 0 }, commands: [] }) as unknown as HistoryData);
      setState('ready');
    } catch {
      setMessage('Operational history could not be loaded.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (state === 'loading') return <LoadingBlock label="Loading operational history…" />;

  const counts = data?.counts ?? { commands: 0, pendingOutbox: 0, delivered: 0 };
  const rows = data?.commands ?? [];

  return (
    <OpsPanel
      title="Operational history"
      subtitle="Governed platform commands + outbox/delivery status — tenant-scoped, read-only (durable journal + delivered-event sink)"
      actions={
        <button type="button" className="text-2xs text-muted hover:text-ink" onClick={() => void refresh()}>
          Refresh
        </button>
      }
    >
      <div className="mb-3 flex flex-wrap gap-2">
        <StatusBadge tone="gray" label={`Commands: ${counts.commands}`} />
        <StatusBadge tone={counts.pendingOutbox > 0 ? 'orange' : 'green'} label={`Pending delivery: ${counts.pendingOutbox}`} />
        <StatusBadge tone="green" label={`Delivered: ${counts.delivered}`} />
      </div>
      {state === 'error' ? (
        <EmptyState title="Unavailable" hint={message} />
      ) : rows.length === 0 ? (
        <EmptyState title="No commands yet" hint="Governed platform commands will appear here as they run." />
      ) : (
        <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
          {rows.map((r) => (
            <div key={r.txId} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-ink">{r.commandType}</div>
                <div className="mt-0.5 text-2xs text-faint">
                  {r.actor ?? 'system'} · {r.committedAt ?? '—'}
                  {r.outbox?.lastError ? ` · ${r.outbox.lastError}` : ''}
                </div>
              </div>
              <StatusBadge tone={outboxTone(r.outbox?.status ?? '')} label={r.outbox?.status ?? 'UNKNOWN'} />
            </div>
          ))}
        </div>
      )}
    </OpsPanel>
  );
}
