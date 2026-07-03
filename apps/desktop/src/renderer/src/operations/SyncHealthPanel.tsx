import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ConnectorDto, ConnectorSyncSnapshot } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { Icon } from '@renderer/components/ui/Icon';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { OpsPanel, Stat, StatusBadge, OpsTable, IconAction } from './primitives';
import type { OpsTone } from './lib';

function statusMeta(s: ConnectorSyncSnapshot['status']): { label: string; tone: OpsTone; pulse?: boolean } {
  switch (s) {
    case 'idle':
      return { label: 'Idle', tone: 'gray' };
    case 'syncing':
      return { label: 'Syncing', tone: 'blue', pulse: true };
    case 'success':
      return { label: 'Synced', tone: 'green' };
    case 'error':
      return { label: 'Error', tone: 'red' };
    case 'rate_limited':
      return { label: 'Rate limited', tone: 'orange' };
    case 'offline':
      return { label: 'Offline', tone: 'orange' };
  }
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - Date.parse(iso);
  if (ms < 0) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function nextIn(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return 'due';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `in ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `in ${m}m`;
  return `in ${Math.floor(m / 60)}h`;
}

function durationLabel(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const Th = ({ children, right }: { children: ReactNode; right?: boolean }): JSX.Element => (
  <th className={`px-3 py-2 font-semibold ${right ? 'text-right' : ''}`}>{children}</th>
);

export function SyncHealthPanel(): JSX.Element {
  const [snaps, setSnaps] = useState<ConnectorSyncSnapshot[]>([]);
  const [connectors, setConnectors] = useState<ConnectorDto[]>([]);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let alive = true;
    const load = () => ipc.connectors.syncState().then((s) => alive && setSnaps(s)).catch(() => {});
    void load();
    void ipc.connectors.list().then((c) => alive && setConnectors(c)).catch(() => {});
    const off = ipc.connectors.onSyncState((s) => setSnaps(s));
    const t = window.setInterval(() => void load(), 5000);
    return () => {
      alive = false;
      off();
      window.clearInterval(t);
    };
  }, []);

  const nameOf = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of connectors) m[c.id] = c.name;
    return m;
  }, [connectors]);

  const labelOf = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of connectors) for (const a of c.accounts) m[a.id] = a.label;
    return m;
  }, [connectors]);

  const totals = useMemo(() => {
    let entities = 0;
    let syncing = 0;
    let errors = 0;
    let queue = 0;
    for (const s of snaps) {
      entities += s.entityCount;
      if (s.status === 'syncing') syncing += 1;
      if (s.status === 'error' || s.status === 'offline') errors += 1;
      queue += s.queueSize;
    }
    return { accounts: snaps.length, entities, syncing, errors, queue };
  }, [snaps]);

  const syncNow = async (connectorId: string, accountId: string): Promise<void> => {
    const key = `${connectorId}:${accountId}`;
    setBusy((b) => ({ ...b, [key]: true }));
    try {
      await ipc.connectors.sync(connectorId, accountId);
      setSnaps(await ipc.connectors.syncState());
    } catch {
      /* surfaced via status */
    }
    setBusy((b) => ({ ...b, [key]: false }));
  };

  if (snaps.length === 0) {
    return (
      <EmptyState
        icon="activity"
        title="No connectors syncing yet"
        description="Connect a provider (GitHub, Notion, Google Calendar, or Slack) from the Connectors screen. Once connected, its sync health — status, cadence, entity counts, errors, and rate limits — appears here live."
      />
    );
  }

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat icon="connectors" label="Connected accounts" value={totals.accounts} tone="blue" />
        <Stat icon="database" label="Entities synced" value={totals.entities.toLocaleString()} tone="green" />
        <Stat icon="pulse" label="Syncing now" value={totals.syncing} tone={totals.syncing ? 'blue' : 'gray'} />
        <Stat
          icon="refresh"
          label="In retry queue"
          value={totals.queue}
          tone={totals.queue ? 'orange' : 'gray'}
          hint={totals.errors ? `${totals.errors} need attention` : undefined}
        />
      </div>

      <OpsPanel title="Connector sync health" subtitle="Live status from the sync engine — updates as syncs run">
        <OpsTable
          head={
            <>
              <Th>Connector</Th>
              <Th>Status</Th>
              <Th>Last sync</Th>
              <Th>Next sync</Th>
              <Th right>Duration</Th>
              <Th right>Entities</Th>
              <Th right>Queue</Th>
              <Th right>Sync</Th>
            </>
          }
        >
          {snaps.map((s) => {
            const meta = statusMeta(s.status);
            const key = `${s.connectorId}:${s.accountId}`;
            return (
              <tr key={key} className="border-t border-[var(--hairline)] align-middle">
                <td className="px-3 py-2.5">
                  <div className="font-medium text-ink">{nameOf[s.connectorId] ?? s.connectorId}</div>
                  <div className="text-2xs text-faint">{labelOf[s.accountId] ?? s.accountId}</div>
                  {s.lastError && s.status !== 'success' && (
                    <div className="mt-0.5 max-w-[260px] truncate text-2xs text-syspink" title={s.lastError}>
                      {s.lastError}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <StatusBadge tone={meta.tone} label={meta.label} pulse={meta.pulse} />
                  {s.status === 'rate_limited' && s.rateLimitedUntil && (
                    <div className="mt-0.5 text-2xs text-faint">resets {nextIn(s.rateLimitedUntil)}</div>
                  )}
                </td>
                <td className="px-3 py-2.5 text-muted">{timeAgo(s.lastSyncAt)}</td>
                <td className="px-3 py-2.5 text-muted">{nextIn(s.nextSyncAt)}</td>
                <td className="px-3 py-2.5 text-right text-muted">{durationLabel(s.lastDurationMs)}</td>
                <td className="px-3 py-2.5 text-right font-medium text-ink">{s.entityCount.toLocaleString()}</td>
                <td className="px-3 py-2.5 text-right text-muted">{s.queueSize || '—'}</td>
                <td className="px-3 py-2.5 text-right">
                  <div className="flex justify-end">
                    <IconAction
                      icon="refresh"
                      label="Sync now"
                      tone="blue"
                      disabled={busy[key] || s.status === 'syncing'}
                      onClick={() => void syncNow(s.connectorId, s.accountId)}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </OpsTable>
        <p className="mt-3 flex items-center gap-1.5 text-2xs text-faint">
          <Icon name="info" size={12} />
          Automatic sync runs on a 15-minute cadence; transient failures retry with backoff.
        </p>
      </OpsPanel>
    </>
  );
}
