/**
 * S124 — the cross-surface OPERATIONAL OVERVIEW panel. A READ-ONLY, tenant-scoped, at-a-glance operator
 * posture that COMPOSES existing authoritative governed reads — it is a composition layer, not a new
 * source of truth:
 *   - `ipc.platform.operationalOverview()` → `platform:command.dispatch` (`QueryOperationalOverview`),
 *     which server-side folds health + delivery + reliability + reliability-trend + connector-inbound
 *     (+ inbound-trend) over the SAME durable journal + event ring, tenant resolved SERVER-SIDE; and
 *   - `ipc.security.auditIntegrity()` → the existing S115 governed audit-integrity channel (its own
 *     authoritative store), read directly for the Audit tile so no cross-subsystem coupling is added.
 *
 * It mutates nothing, dispatches no command, and shows only descriptive states already established by
 * those capabilities (HEALTHY / ALIVE_NOT_READY / UNHEALTHY, IMPROVING / DEGRADING / STABLE, SIGNED /
 * UNSIGNED / VERIFICATION_FAILED, INCREASE / DECREASE). No invented severity, SLO, or incident
 * semantics. Credential-free: it renders only counts / statuses / directions.
 */
import { useCallback, useEffect, useState } from 'react';
import { ipc } from '@renderer/lib/ipc';
import { OpsPanel, StatusBadge } from '@renderer/operations/primitives';
import { EmptyState, LoadingBlock } from '@renderer/operationsCenter/primitives';

type Health = { status?: string; ready?: boolean; components?: { delivery?: { pendingOutbox?: number | null } } };
interface OverviewData {
  health?: Health | { available: false };
  reliability?: { available: boolean; value?: { totals: { commands: number; delivered: number; retryable: number }; successRatio: number; trend: { comparable: boolean; posture: string; deliveryFailureRateDirection: string; retryPressureDirection: string; newSignatures: number } } };
  delivery?: { available: boolean; value?: { pending: number; inFlight: number; retryable: number; delivered: number } };
  connectorInbound?: { available: boolean; counts?: { lineage: number; connectors: number }; trend?: { comparable: boolean; volumeDirection: string; newConnectors: number; quietConnectors: number } };
}
type Audit = { state: 'SIGNED' | 'UNSIGNED' | 'VERIFICATION_FAILED' } | null;

const pct = (r: number): string => `${(Math.max(0, Math.min(1, Number(r) || 0)) * 100).toFixed(1)}%`;
const dirArrow = (d?: string): string => (d === 'INCREASE' ? '▲' : d === 'DECREASE' ? '▼' : '→');
const healthTone = (s?: string): 'green' | 'orange' | 'red' | 'gray' =>
  s === 'HEALTHY' ? 'green' : s === 'ALIVE_NOT_READY' ? 'orange' : s === 'UNHEALTHY' ? 'red' : 'gray';
const postureTone = (p?: string): 'green' | 'red' | 'gray' => (p === 'IMPROVING' ? 'green' : p === 'DEGRADING' ? 'red' : 'gray');
const auditTone = (s?: string): 'green' | 'orange' | 'red' | 'gray' =>
  s === 'SIGNED' ? 'green' : s === 'UNSIGNED' ? 'orange' : s === 'VERIFICATION_FAILED' ? 'red' : 'gray';

export function OperationalOverviewPanel(): JSX.Element {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [data, setData] = useState<OverviewData | null>(null);
  const [audit, setAudit] = useState<Audit>(null);
  // S140 — honest "needs attention" count reused from the SAME governed QueryOperationalExceptions read
  // (S139). `null` = the count could not be read (shown as "unavailable", never a fabricated 0).
  const [exceptions, setExceptions] = useState<number | null>(null);
  const [message, setMessage] = useState<string>('');

  const refresh = useCallback(async () => {
    setState('loading');
    try {
      const [ovw, aud, exc] = await Promise.allSettled([
        ipc.platform.operationalOverview({ limit: 25 }),
        ipc.security.auditIntegrity(),
        ipc.platform.operationalExceptions({ limit: 1 }), // reuse S139 — we need only counts.total here
      ]);
      if (ovw.status !== 'fulfilled' || !ovw.value.ok) {
        setMessage((ovw.status === 'fulfilled' && ovw.value.error?.message) || 'Operational overview is not available.');
        setState('error');
        return;
      }
      setData((ovw.value.data ?? null) as unknown as OverviewData | null);
      setAudit(aud.status === 'fulfilled' ? ({ state: aud.value.state } as Audit) : null);
      const excTotal = exc.status === 'fulfilled' && exc.value.ok
        ? Number((((exc.value.data ?? {}) as { counts?: { total?: number } }).counts?.total) ?? 0)
        : null;
      setExceptions(excTotal);
      setState('ready');
    } catch {
      setMessage('Operational overview could not be loaded.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (state === 'loading') return <LoadingBlock label="Loading operational overview…" />;

  const health = (data?.health ?? {}) as Health;
  const rel = data?.reliability?.value;
  const relTrend = rel?.trend;
  const del = data?.delivery?.value;
  const inbound = data?.connectorInbound;

  return (
    <OpsPanel
      title="Operational posture"
      subtitle="At-a-glance operator overview — composed from live governed reads, read-only, tenant-scoped"
      actions={
        <button type="button" className="text-2xs text-muted hover:text-ink" onClick={() => void refresh()}>
          Refresh
        </button>
      }
    >
      {state === 'error' ? (
        <EmptyState title="Unavailable" hint={message} />
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {/* S140 — Needs attention (unified operational exceptions count, reused from QueryOperationalExceptions) */}
          <div className="surface-raised rounded-2xl px-3 py-2 shadow-card">
            <div className="text-2xs font-semibold uppercase tracking-wide text-faint">Needs attention</div>
            <div className="mt-1">
              {exceptions === null ? (
                <StatusBadge tone="gray" label="unavailable" />
              ) : (
                <StatusBadge tone={exceptions > 0 ? 'red' : 'green'} label={`${exceptions} exception${exceptions === 1 ? '' : 's'}`} />
              )}
            </div>
          </div>
          {/* Application / Health */}
          <div className="surface-raised rounded-2xl px-3 py-2 shadow-card">
            <div className="text-2xs font-semibold uppercase tracking-wide text-faint">Health</div>
            <div className="mt-1"><StatusBadge tone={healthTone(health.status)} label={health.status ?? 'unavailable'} /></div>
          </div>
          {/* Delivery / outbox */}
          <div className="surface-raised rounded-2xl px-3 py-2 shadow-card">
            <div className="text-2xs font-semibold uppercase tracking-wide text-faint">Delivery</div>
            <div className="mt-1 text-2xs text-faint">
              {del ? `${del.delivered} delivered · ${del.retryable} retrying · ${del.pending + del.inFlight} in flight` : 'unavailable'}
            </div>
          </div>
          {/* Reliability posture */}
          <div className="surface-raised rounded-2xl px-3 py-2 shadow-card">
            <div className="text-2xs font-semibold uppercase tracking-wide text-faint">Reliability</div>
            <div className="mt-1 text-2xs text-faint">{rel ? `${pct(rel.successRatio)} success · ${rel.totals.retryable} retrying` : 'unavailable'}</div>
          </div>
          {/* Reliability trend */}
          <div className="surface-raised rounded-2xl px-3 py-2 shadow-card">
            <div className="text-2xs font-semibold uppercase tracking-wide text-faint">Reliability trend</div>
            <div className="mt-1">
              {relTrend?.comparable ? (
                <StatusBadge tone={postureTone(relTrend.posture)} label={`${relTrend.posture.toLowerCase()} · failures ${dirArrow(relTrend.deliveryFailureRateDirection)}${relTrend.newSignatures > 0 ? ` · ${relTrend.newSignatures} new err` : ''}`} />
              ) : (
                <span className="text-2xs text-faint">not enough data</span>
              )}
            </div>
          </div>
          {/* Connector inbound */}
          <div className="surface-raised rounded-2xl px-3 py-2 shadow-card">
            <div className="text-2xs font-semibold uppercase tracking-wide text-faint">Connector inbound</div>
            <div className="mt-1 text-2xs text-faint">
              {inbound?.available ? `${inbound.counts?.lineage ?? 0} events · ${inbound.counts?.connectors ?? 0} connectors` : 'unavailable'}
            </div>
          </div>
          {/* Connector inbound trend */}
          <div className="surface-raised rounded-2xl px-3 py-2 shadow-card">
            <div className="text-2xs font-semibold uppercase tracking-wide text-faint">Connector trend</div>
            <div className="mt-1">
              {inbound?.trend?.comparable ? (
                <StatusBadge tone="gray" label={`volume ${dirArrow(inbound.trend.volumeDirection)}${inbound.trend.newConnectors > 0 ? ` · ${inbound.trend.newConnectors} new` : ''}${inbound.trend.quietConnectors > 0 ? ` · ${inbound.trend.quietConnectors} quiet` : ''}`} />
              ) : (
                <span className="text-2xs text-faint">not enough data</span>
              )}
            </div>
          </div>
          {/* Audit integrity (existing S115 governed read) */}
          <div className="surface-raised rounded-2xl px-3 py-2 shadow-card">
            <div className="text-2xs font-semibold uppercase tracking-wide text-faint">Audit integrity</div>
            <div className="mt-1"><StatusBadge tone={auditTone(audit?.state)} label={audit?.state ?? 'unavailable'} /></div>
          </div>
        </div>
      )}
    </OpsPanel>
  );
}
