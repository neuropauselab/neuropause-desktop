/**
 * S125 — the operator-facing Operational Evidence Search panel. A READ-ONLY, tenant-scoped search over
 * canonical operational evidence (committed-command history + verified connector inbound lineage),
 * fetched through the governed read IPC (`ipc.platform.evidenceSearch` → `platform:command.dispatch`,
 * `QueryEvidenceSearch` → the S125 pure deterministic lexical projection, tenant resolved SERVER-SIDE).
 *
 * It mutates nothing, creates no ERP transaction, and renders exactly the sanitized, bounded, credential-
 * free evidence references the main process returns — id / source / type / time / concise summary /
 * status / correlation. It NEVER shows command payloads, raw outbox error text, secrets, tokens, or
 * connector payloads (the projection carries none). Empty query browses the most-recent evidence.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ipc } from '@renderer/lib/ipc';
import { OpsPanel, StatusBadge } from '@renderer/operations/primitives';
import { EmptyState, LoadingBlock } from '@renderer/operationsCenter/primitives';

interface EvidenceHit {
  kind: 'command' | 'inbound';
  id: string;
  source: string;
  type: string;
  timestamp: number;
  summary: string;
  status: string | null;
  correlationId: string | null;
  connectorId: string | null;
  score: number;
}
interface EvidenceData { query: string; counts: { command: number; inbound: number; total: number }; bounded: boolean; hits: EvidenceHit[] }

interface TraceDelivery { state: string; linked: boolean; attempts: number | null; deliveredAt: string | null }
interface TraceEntry { source: string; id: string; at: string; type: string; status: string | null; aggregateId: string | null; correlationId: string; delivery?: TraceDelivery }
// S127 — compact delivery badge tone; canonical states only (no invented FAILED/severity).
const deliveryTone = (s?: string): 'green' | 'orange' | 'gray' =>
  s === 'DELIVERED' ? 'green' : s === 'RETRYING' ? 'orange' : s === 'PENDING' || s === 'IN_FLIGHT' ? 'gray' : 'gray';
interface TraceData { correlationId: string; found: boolean; counts: { command: number; delivered: number; total: number }; entries: TraceEntry[]; bounded: boolean; note?: string }

const iso = (ms: number): string => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : '—');

export function EvidenceSearchPanel(): JSX.Element {
  const [query, setQuery] = useState<string>('');
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [data, setData] = useState<EvidenceData | null>(null);
  const [message, setMessage] = useState<string>('');
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [trace, setTrace] = useState<TraceData | null>(null);
  const [traceState, setTraceState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  const runTrace = useCallback(async (correlationId: string) => {
    setTraceState('loading');
    setTrace(null);
    try {
      const resp = await ipc.platform.evidenceTrace({ correlationId, limit: 100 });
      if (!resp.ok) {
        setTraceState('error');
        return;
      }
      setTrace((resp.data ?? null) as unknown as TraceData | null);
      setTraceState('ready');
    } catch {
      setTraceState('error');
    }
  }, []);

  const run = useCallback(async (q: string) => {
    setState('loading');
    try {
      const resp = await ipc.platform.evidenceSearch({ query: q, limit: 50 });
      if (!resp.ok) {
        setMessage(resp.error?.message ?? 'Evidence search is not available.');
        setState('error');
        return;
      }
      setData((resp.data ?? null) as unknown as EvidenceData | null);
      setState('ready');
    } catch {
      setMessage('Evidence search could not be loaded.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void run('');
  }, [run]);

  const onChange = (q: string): void => {
    setQuery(q);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void run(q), 200);
  };

  const hits = data?.hits ?? [];

  return (
    <OpsPanel
      title="Evidence search"
      subtitle="Search governed command history + verified connector lineage — read-only, tenant-scoped, credential-free"
      actions={
        <input
          type="search"
          value={query}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Search evidence…"
          aria-label="Search operational evidence"
          className="rounded-lg border border-[var(--hairline)] bg-transparent px-2 py-1 text-2xs text-ink placeholder:text-faint focus:outline-none"
        />
      }
    >
      {state === 'loading' ? (
        <LoadingBlock label="Searching evidence…" />
      ) : state === 'error' ? (
        <EmptyState title="Unavailable" hint={message} />
      ) : hits.length === 0 ? (
        <EmptyState title="No matching evidence" hint={query.trim() ? 'No command or connector evidence matches this query.' : 'Governed command and connector evidence will appear here.'} />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            <StatusBadge tone="gray" label={`Commands: ${data?.counts.command ?? 0}`} />
            <StatusBadge tone="blue" label={`Inbound: ${data?.counts.inbound ?? 0}`} />
            {data?.bounded ? <StatusBadge tone="orange" label="More results — refine query" /> : null}
          </div>
          <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
            {hits.map((h) => (
              <div key={`${h.kind}:${h.id}`} className="flex items-center gap-3 py-2.5">
                <StatusBadge tone={h.kind === 'command' ? 'purple' : 'blue'} label={h.kind} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">{h.summary}</div>
                  <div className="mt-0.5 truncate text-2xs text-faint">
                    {`${h.source} · ${h.type} · ${iso(h.timestamp)} · id ${h.id}${h.correlationId ? ` · corr ${h.correlationId}` : ''}`}
                  </div>
                </div>
                {h.status ? <StatusBadge tone="gray" label={h.status} /> : null}
                {h.correlationId ? (
                  <button
                    type="button"
                    className="rounded-lg border border-[var(--hairline)] px-2 py-0.5 text-2xs text-muted hover:text-ink"
                    onClick={() => void runTrace(h.correlationId as string)}
                  >
                    Trace
                  </button>
                ) : (
                  <span className="text-2xs text-faint" title="This evidence carries no correlation identifier">no corr</span>
                )}
              </div>
            ))}
          </div>

          {/* S126 — inline Evidence Trace (correlation timeline) for the selected hit. */}
          {traceState !== 'idle' && (
            <div className="mt-3 surface-raised rounded-2xl px-4 py-3 shadow-card">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-2xs font-semibold uppercase tracking-wide text-faint">
                  Evidence trace{trace?.correlationId ? ` · corr ${trace.correlationId}` : ''}
                </span>
                <button type="button" className="text-2xs text-muted hover:text-ink" onClick={() => { setTraceState('idle'); setTrace(null); }}>
                  Close
                </button>
              </div>
              {traceState === 'loading' ? (
                <LoadingBlock label="Composing trace…" />
              ) : traceState === 'error' ? (
                <EmptyState title="Trace unavailable" hint="The correlation trace could not be loaded." />
              ) : !trace || !trace.found ? (
                <EmptyState title="No correlated evidence" hint={trace?.note ?? 'No command or delivered-event evidence carries this correlation identifier.'} />
              ) : (
                <>
                  <div className="mb-2 flex flex-wrap gap-2">
                    <StatusBadge tone="purple" label={`Commands: ${trace.counts.command}`} />
                    <StatusBadge tone="green" label={`Delivered: ${trace.counts.delivered}`} />
                    {trace.bounded ? <StatusBadge tone="orange" label="Trace truncated" /> : null}
                  </div>
                  <ol className="relative space-y-2 border-l border-[var(--hairline)] pl-4">
                    {trace.entries.map((e) => (
                      <li key={`${e.source}:${e.id}`} className="text-2xs">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-ink">{e.type} <span className="text-faint">· {e.source}</span></span>
                          {e.delivery ? (
                            <StatusBadge tone={deliveryTone(e.delivery.state)} label={`delivery: ${e.delivery.state.toLowerCase()}${e.delivery.linked && e.delivery.attempts && e.delivery.attempts > 1 ? ` (${e.delivery.attempts}×)` : ''}`} />
                          ) : null}
                        </div>
                        <div className="truncate text-faint">
                          {`${e.at || '—'}${e.status ? ` · ${e.status}` : ''}${e.aggregateId ? ` · ${e.aggregateId}` : ''} · id ${e.id}`}
                        </div>
                      </li>
                    ))}
                  </ol>
                  <div className="mt-2 text-2xs text-faint">Inbound connector webhooks carry no correlation id and are not part of a correlation trace.</div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </OpsPanel>
  );
}
