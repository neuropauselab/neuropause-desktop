/**
 * Integration Health dashboard (Phase P2.1, Part 6) — extends the existing Connectors page with a live
 * per-account health surface. It reads the REAL, already-wired NCF feed `ipc.connectors.syncState()` +
 * `onSyncState()` (which had no UI reader) and scores each `ConnectorSyncSnapshot` through the shared
 * `computeIntegrationHealth` engine. Every value shown is real runtime state — status, health score,
 * connection, last/next sync, objects synced, latency, errors, consecutive failures, rate limiting. When
 * there are no integration syncs yet it shows an honest empty state (nothing fabricated). No new
 * navigation, no new IPC — it consumes what the connector framework already broadcasts.
 */
import { useEffect, useState } from 'react';
import type { ConnectorSyncSnapshot } from '@neuropause/shared';
import {
  computeIntegrationHealth,
  aggregateIntegrationHealth,
  formatDurationMs,
} from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';
import { StatusDot } from '@renderer/operations/primitives';
import { formatRelative } from '@renderer/lib/format';

type Tone = 'green' | 'orange' | 'red' | 'gray';
const STATE_TONE: Record<string, Tone> = {
  healthy: 'green',
  degraded: 'orange',
  unhealthy: 'red',
  idle: 'gray',
};

function fmtNext(iso: string | null, nowMs: number): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const delta = t - nowMs;
  if (delta <= 0) return 'due';
  const min = Math.round(delta / 60_000);
  return min < 60 ? `in ${min}m` : `in ${Math.round(min / 60)}h`;
}

export function IntegrationHealthPanel(): JSX.Element | null {
  const [snapshots, setSnapshots] = useState<ConnectorSyncSnapshot[]>([]);
  const [loaded, setLoaded] = useState(false);
  /**
   * GATE 15 (round 47) — a FAILED sync-state read is named, never rendered as
   * the honest-looking "No active integration syncs yet". The empty state
   * promises "connect a connector to see live sync health" — over a failed
   * read that promise is a lie: the syncs may exist and be invisible.
   */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    void ipc.connectors
      .syncState()
      .then((s) => {
        if (alive) {
          setSnapshots(s);
          setLoadError(null);
          setLoaded(true);
        }
      })
      .catch((err: unknown) => {
        if (alive) {
          setLoadError(err instanceof Error ? err.message : String(err));
          setLoaded(true);
        }
      });
    const off = ipc.connectors.onSyncState((s) => {
      if (alive) {
        setSnapshots(s);
        // A live broadcast IS a successful read — the failure state is stale.
        setLoadError(null);
      }
    });
    return () => {
      alive = false;
      off();
    };
  }, [retryNonce]);

  if (!loaded) return null;

  const now = Date.now();
  const healths = snapshots.map((s) => computeIntegrationHealth(s, now));
  const agg = aggregateIntegrationHealth(healths);
  const aggTone =
    agg.overall === 'healthy'
      ? 'text-sysgreen'
      : agg.overall === 'unhealthy'
        ? 'text-syspink'
        : agg.overall === 'degraded'
          ? 'text-sysorange'
          : 'text-ink';

  return (
    <div className="mt-4 rounded-2xl border border-[var(--hairline)] [background:var(--fill-1)] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon name="pulse" size={15} className="text-muted" />
          <h2 className="text-sm font-semibold">Integration Health</h2>
        </div>
        {snapshots.length > 0 && (
          <div className="text-2xs text-faint">
            <span className={cn('font-semibold', aggTone)}>{agg.score}</span> avg · {agg.healthy}{' '}
            healthy · {agg.degraded} degraded · {agg.unhealthy} down
          </div>
        )}
      </div>

      {loadError !== null && snapshots.length === 0 ? (
        <div role="alert" className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
          <div className="font-semibold">Sync health could not be read.</div>
          <p className="mt-1 leading-relaxed">{loadError} — active syncs may exist and be invisible here.</p>
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="mt-2 rounded-lg border border-danger/40 px-2.5 py-1 text-2xs font-semibold hover:bg-danger/10"
          >
            Retry
          </button>
        </div>
      ) : snapshots.length === 0 ? (
        <p className="text-xs text-white/45">
          No active integration syncs yet. Connect a connector to see live sync health, latency, objects
          synced, and errors here.
        </p>
      ) : (
        <div className="space-y-1.5">
          {healths.map((h) => (
            <div
              key={`${h.connectorId}:${h.accountId}`}
              className="flex items-center gap-3 rounded-xl [background:var(--fill-2)] px-3 py-2"
            >
              <StatusDot tone={STATE_TONE[h.state] ?? 'gray'} pulse={h.state === 'unhealthy'} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-ink">{h.connectorId}</span>
                  <span className="truncate text-2xs text-faint">{h.accountId}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-2xs text-white/50">
                  <span>Score {h.score}</span>
                  <span className="capitalize">{h.connection}</span>
                  <span className="capitalize">{h.auth.replace('_', ' ')}</span>
                  <span>Last {h.lastSyncAt ? formatRelative(h.lastSyncAt) : 'never'}</span>
                  <span>Next {fmtNext(h.nextSyncAt, now)}</span>
                  <span>{h.entityCount} objects</span>
                  {h.latencyMs !== null && <span>{formatDurationMs(h.latencyMs)}</span>}
                  {h.consecutiveFailures > 0 && (
                    <span className="text-sysorange">{h.consecutiveFailures} fails</span>
                  )}
                  {h.rateLimited && <span className="text-sysorange">rate-limited</span>}
                </div>
              </div>
              <span className="shrink-0 text-2xs font-medium capitalize text-faint">{h.state}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
