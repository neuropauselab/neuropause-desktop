/**
 * S121 — the operator-facing Connector Lineage panel. A READ-ONLY, tenant-scoped view of VERIFIED
 * inbound-webhook events (S114→S119→S120), fetched through the governed read IPC
 * (`ipc.platform.inboundLineage` → `platform:command.dispatch`, `QueryInboundLineage` read branch →
 * the S119 projection over the ONE EventBus ring, tenant resolved SERVER-SIDE).
 *
 * It mutates nothing, creates no ERP transaction, and renders exactly the sanitized lineage the main
 * process returns — connector / provider / verified source / received time / event id / authoritative
 * tenant / dedupe status. It NEVER shows secrets, tokens, webhook signatures, credentials, or raw
 * payloads (the projection carries none). `dedupeRef` is honestly shown as "none" (the S114 event
 * carries no dedupe reference — S119/S120).
 */
import { useCallback, useEffect, useState } from 'react';
import { ipc } from '@renderer/lib/ipc';
import { OpsPanel, StatusBadge } from '@renderer/operations/primitives';
import { EmptyState, LoadingBlock } from '@renderer/operationsCenter/primitives';

interface LineageRow {
  eventId: string;
  connectorId: string;
  provider: string;
  verifiedSource: string;
  receivedAt: number;
  tenantId: string;
  dedupeRef: string | null;
  credentialsPresent: boolean;
}
interface ConnectorSummary { connectorId: string; provider: string; events: number; lastReceivedAt: number }
type InboundDir = 'INCREASE' | 'DECREASE' | 'STABLE';
interface InboundTrend {
  comparable: boolean;
  window: { previous: number; recent: number };
  totalVolume: { previous: number; recent: number; delta: number; direction: InboundDir };
  newConnectors: string[];
  quietConnectors: string[];
  byConnector: Array<{ connectorId: string; recent: number; previous: number; direction: InboundDir }>;
}
// S135 — merged per-connector inbound intelligence (count · latest · trend · descriptive state · correlatable).
interface ConnectorIntel {
  connectorId: string;
  provider: string;
  verifiedSource: string;
  events: number;
  lastReceivedAt: number;
  trendDirection: InboundDir | null;
  state: 'NEW' | 'QUIET' | 'ACTIVE';
  correlatable: boolean;
  dedupeRefStatus: string;
  sampleEventIds: string[];
}
interface LineageData { counts: { lineage: number; connectors: number }; lineage: LineageRow[]; summary: ConnectorSummary[]; trend?: InboundTrend; intelligence?: ConnectorIntel[]; tenantId: string }
const inArrow = (d: InboundDir): string => (d === 'INCREASE' ? '▲' : d === 'DECREASE' ? '▼' : '→');
const stateTone = (s: ConnectorIntel['state']): 'green' | 'blue' | 'gray' => (s === 'NEW' ? 'blue' : s === 'QUIET' ? 'gray' : 'green');

const iso = (ms: number): string => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : '—');

export function ConnectorLineagePanel(): JSX.Element {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [data, setData] = useState<LineageData | null>(null);
  const [message, setMessage] = useState<string>('');

  const refresh = useCallback(async () => {
    setState('loading');
    try {
      const resp = await ipc.platform.inboundLineage({ limit: 50 });
      if (!resp.ok) {
        setMessage(resp.error?.message ?? 'Connector lineage is not available.');
        setState('error');
        return;
      }
      setData((resp.data ?? { counts: { lineage: 0, connectors: 0 }, lineage: [], summary: [], tenantId: '' }) as unknown as LineageData);
      setState('ready');
    } catch {
      setMessage('Connector lineage could not be loaded.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (state === 'loading') return <LoadingBlock label="Loading connector lineage…" />;

  const rows = data?.lineage ?? [];
  const summary = data?.summary ?? [];
  const trend = data?.trend;
  const intelligence = data?.intelligence ?? [];

  return (
    <OpsPanel
      title="Connector lineage"
      subtitle="Verified inbound-webhook events — read-only evidence, tenant-scoped, credential-free (S114 verified)"
      actions={
        <button type="button" className="text-2xs text-muted hover:text-ink" onClick={() => void refresh()}>
          Refresh
        </button>
      }
    >
      <div className="mb-3 flex flex-wrap gap-2">
        <StatusBadge tone="gray" label={`Events: ${data?.counts.lineage ?? 0}`} />
        <StatusBadge tone="blue" label={`Connectors: ${data?.counts.connectors ?? 0}`} />
        <StatusBadge tone="green" label="Read-only evidence" />
      </div>
      {state === 'error' ? (
        <EmptyState title="Unavailable" hint={message} />
      ) : rows.length === 0 ? (
        <EmptyState title="No verified inbound webhooks yet" hint="Verified inbound connector events will appear here as read-only, credential-free evidence." />
      ) : (
        <>
          {trend?.comparable && (trend.newConnectors.length > 0 || trend.quietConnectors.length > 0 || trend.byConnector.length > 0 || trend.totalVolume.direction !== 'STABLE') && (
            <div className="mb-3 surface-raised rounded-2xl px-4 py-3 shadow-card">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-2xs font-semibold uppercase tracking-wide text-faint">
                  Inbound trend · {trend.window.previous} → {trend.window.recent} events
                </span>
                <StatusBadge tone="gray" label={`Volume ${inArrow(trend.totalVolume.direction)} ${trend.totalVolume.recent}`} />
              </div>
              {(trend.newConnectors.length > 0 || trend.quietConnectors.length > 0) && (
                <div className="space-y-1 text-2xs">
                  {trend.newConnectors.length > 0 && (
                    <div className="truncate text-faint"><span className="font-medium text-ink">New connectors:</span> {trend.newConnectors.join(' · ')}</div>
                  )}
                  {trend.quietConnectors.length > 0 && (
                    <div className="truncate text-faint"><span className="font-medium text-ink">Quiet connectors:</span> {trend.quietConnectors.join(' · ')}</div>
                  )}
                </div>
              )}
              {trend.byConnector.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {trend.byConnector.map((c) => (
                    <StatusBadge key={c.connectorId} tone={c.direction === 'INCREASE' ? 'green' : c.direction === 'DECREASE' ? 'orange' : 'gray'} label={`${c.connectorId} ${inArrow(c.direction)} ${c.recent}`} />
                  ))}
                </div>
              )}
            </div>
          )}
          {intelligence.length > 0 && (
            <div className="mb-3">
              <div className="mb-1 text-2xs font-semibold uppercase tracking-wide text-faint">Connector inbound intelligence</div>
              <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
                {intelligence.map((c) => (
                  <div key={`intel:${c.connectorId}`} className="flex items-center gap-3 py-2 text-2xs">
                    <StatusBadge tone={stateTone(c.state)} label={c.state} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-ink">{c.connectorId} <span className="text-faint">· {c.provider}</span></div>
                      <div className="truncate text-faint">
                        {`${c.events} verified inbound${c.trendDirection ? ` · ${inArrow(c.trendDirection)} ${c.trendDirection.toLowerCase()}` : ''} · last ${iso(c.lastReceivedAt)} · ${c.correlatable ? 'correlatable' : 'not correlatable'} · dedupe ${c.dedupeRefStatus}`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {summary.length > 0 && (
            <div className="mb-3 surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
              {summary.map((s) => (
                <div key={s.connectorId} className="flex items-center justify-between gap-3 py-2 text-2xs">
                  <span className="font-medium text-ink">{s.connectorId} <span className="text-faint">· {s.provider}</span></span>
                  <span className="text-faint">{s.events} event{s.events === 1 ? '' : 's'} · last {iso(s.lastReceivedAt)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
            {rows.map((r) => (
              <div key={r.eventId} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">
                    {r.connectorId} <span className="text-2xs text-faint">· {r.provider}</span>
                  </div>
                  <div className="mt-0.5 truncate text-2xs text-faint">
                    {`verified: ${r.verifiedSource} · received ${iso(r.receivedAt)} · event ${r.eventId} · tenant ${r.tenantId} · dedupe ${r.dedupeRef ?? 'none'}`}
                  </div>
                </div>
                <StatusBadge tone={r.credentialsPresent ? 'red' : 'green'} label={r.credentialsPresent ? 'credential?!' : 'credential-free'} />
              </div>
            ))}
          </div>
        </>
      )}
    </OpsPanel>
  );
}
