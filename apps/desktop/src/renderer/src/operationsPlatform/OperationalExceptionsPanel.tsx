/**
 * S139 — the operator-facing Operational Exceptions panel. A read-only, unified "needs follow-up" queue
 * that surfaces the two operational exception signals that already exist but were scattered across three
 * surfaces: RETRYABLE deliveries (S35) and held reconciliations (S40). It is fetched through the governed
 * operational-exceptions IPC (`ipc.platform.operationalExceptions`) → the secure bridge → the main read
 * branch → the durable command journal, tenant-scoped and authorized server-side.
 *
 * It mutates nothing (no resolve / retry / replay — hold resolution already lives, governed, in the Hold
 * Center; delivery retry is undefined policy and OUT OF SCOPE). It renders exactly the sanitized items the
 * main process returns and NEVER hardcodes success — a retrying/held item visibly stays an exception. It
 * invents no severity, priority, or SLA — it is a pure union ordered most-recent-first.
 *
 * S140 — each exception that GENUINELY carries a correlationId (only `delivery_retrying` items do; held
 * reconciliations carry none) offers a read-only "View trace" that opens its EXISTING Evidence Trace via the
 * governed `QueryEvidenceTrace` read (S126). correlationId is NEVER manufactured and NEVER used as a tenant
 * selector; an item with no correlationId shows NO trace action (honest absence — no fuzzy/temporal inference).
 */
import { useCallback, useEffect, useState } from 'react';
import { ipc } from '@renderer/lib/ipc';
import { OpsPanel, StatusBadge } from '@renderer/operations/primitives';
import type { OpsTone } from '@renderer/operations/lib';
import { EmptyState, LoadingBlock } from '@renderer/operationsCenter/primitives';

interface TraceEntry { source?: string; id: string; at?: string; type?: string; status?: string | null }
interface TraceData { found?: boolean; counts?: { total?: number }; entries?: TraceEntry[] }

interface ExceptionRow {
  kind: 'delivery_retrying' | 'held_reconciliation';
  id: string;
  at: string;
  summary: string;
  eventType?: string;
  aggregateId?: string;
  attempts?: number;
  lastError?: string;
  correlationId?: string;
  idempotencyKey?: string;
  state?: string;
  reason?: string;
}
interface Counts {
  retryingDeliveries: number;
  heldReconciliations: number;
  total: number;
}
interface ExceptionsData {
  counts: Counts;
  exceptions: ExceptionRow[];
}

/** Both exception kinds are follow-up items (never success) → red/orange, never green. */
function kindTone(kind: string): OpsTone {
  return kind === 'delivery_retrying' ? 'red' : 'orange';
}
function kindLabel(kind: string): string {
  return kind === 'delivery_retrying' ? 'Delivery retrying' : 'Held';
}

const EMPTY_COUNTS: Counts = { retryingDeliveries: 0, heldReconciliations: 0, total: 0 };

/**
 * S140 — read-only Evidence Trace cross-link for a SINGLE exception that genuinely carries a correlationId.
 * Lazily opens the EXISTING governed `QueryEvidenceTrace` read (S126); never manufactures a correlationId,
 * never mutates, and surfaces `found:false` honestly ("no correlation records"). Rendered only by callers
 * that already verified a non-empty correlationId — so a held reconciliation (no correlationId) never mounts it.
 */
function ExceptionTrace({ correlationId }: { correlationId: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [trace, setTrace] = useState<TraceData | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const resp = await ipc.platform.evidenceTrace({ correlationId });
      if (!resp.ok) { setState('error'); return; }
      setTrace((resp.data ?? null) as unknown as TraceData | null);
      setState('ready');
    } catch {
      setState('error');
    }
  }, [correlationId]);

  const onToggle = (): void => {
    const next = !open;
    setOpen(next);
    if (next && state === 'idle') void load();
  };

  const entries = trace?.entries ?? [];
  return (
    <div className="mt-1">
      <button type="button" onClick={onToggle} aria-label="View evidence trace" className="text-2xs text-muted underline-offset-2 hover:text-ink hover:underline">
        {open ? 'Hide trace' : 'View trace'}
      </button>
      {open && (
        <div className="mt-1 rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] p-2">
          {state === 'loading' ? (
            <div className="text-2xs text-faint">Loading trace…</div>
          ) : state === 'error' ? (
            <div className="text-2xs text-faint">Evidence trace is unavailable.</div>
          ) : !trace?.found || entries.length === 0 ? (
            <div className="text-2xs text-faint">No correlation records for this exception.</div>
          ) : (
            <ul className="space-y-1">
              {entries.map((e) => (
                <li key={`${e.source ?? 's'}:${e.id}`} className="text-2xs text-faint">
                  <span className="text-ink">{e.type ?? '—'}</span>
                  {e.status ? ` · ${e.status}` : ''}
                  {e.at ? ` · ${e.at}` : ''}
                  {e.source ? ` · ${e.source}` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** A non-empty, genuinely-present correlationId — never fabricated. */
function traceableCorrelationId(r: ExceptionRow): string | null {
  return typeof r.correlationId === 'string' && r.correlationId.trim() !== '' ? r.correlationId.trim() : null;
}

export function OperationalExceptionsPanel({ onNavigate }: { onNavigate?: (section: string) => void } = {}): JSX.Element {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [data, setData] = useState<ExceptionsData | null>(null);
  const [message, setMessage] = useState<string>('');

  const refresh = useCallback(async () => {
    setState('loading');
    try {
      const resp = await ipc.platform.operationalExceptions({ limit: 25 });
      if (!resp.ok) {
        setMessage(resp.error?.message ?? 'Operational exceptions are not available.');
        setState('error');
        return;
      }
      setData((resp.data ?? { counts: EMPTY_COUNTS, exceptions: [] }) as unknown as ExceptionsData);
      setState('ready');
    } catch {
      setMessage('Operational exceptions could not be loaded.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (state === 'loading') return <LoadingBlock label="Loading operational exceptions…" />;

  const counts = data?.counts ?? EMPTY_COUNTS;
  const rows = data?.exceptions ?? [];

  return (
    <OpsPanel
      title="Operational exceptions"
      subtitle="Unified follow-up queue — retrying deliveries + held reconciliations, tenant-scoped, read-only (durable command journal)"
      actions={
        <button type="button" className="text-2xs text-muted hover:text-ink" onClick={() => void refresh()}>
          Refresh
        </button>
      }
    >
      <div className="mb-3 flex flex-wrap gap-2">
        <StatusBadge tone={counts.total > 0 ? 'red' : 'green'} label={`Needs attention: ${counts.total}`} />
        <StatusBadge tone={counts.retryingDeliveries > 0 ? 'red' : 'gray'} label={`Retrying: ${counts.retryingDeliveries}`} />
        <StatusBadge tone={counts.heldReconciliations > 0 ? 'orange' : 'gray'} label={`Held: ${counts.heldReconciliations}`} />
      </div>
      {state === 'error' ? (
        <EmptyState title="Unavailable" hint={message} />
      ) : rows.length === 0 ? (
        <EmptyState title="Nothing needs attention" hint="Retrying deliveries and held reconciliations will appear here as they occur." />
      ) : (
        <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
          {rows.map((r) => {
            const corr = traceableCorrelationId(r);
            return (
              <div key={`${r.kind}:${r.id}`} className="py-2.5">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">{r.summary}</div>
                    <div className="mt-0.5 text-2xs text-faint">
                      {r.kind === 'delivery_retrying'
                        ? `${r.aggregateId ? `${r.aggregateId} · ` : ''}attempts: ${r.attempts ?? 0}${r.lastError ? ` · ${r.lastError}` : ''}`
                        : `${r.state ?? '—'}${r.reason ? ` · ${r.reason}` : ''}`}
                      {` · ${r.at}`}
                    </div>
                  </div>
                  <StatusBadge tone={kindTone(r.kind)} label={kindLabel(r.kind)} />
                </div>
                {/* S140 — Evidence Trace cross-link ONLY when a genuine correlationId is present. */}
                {corr ? <ExceptionTrace correlationId={corr} /> : null}
                {/* S141 — held reconciliations carry NO correlationId (so no Evidence Trace); offer a read-only
                    deep-link to the EXISTING governed Hold Center where they are resolvable. No mutation here. */}
                {r.kind === 'held_reconciliation' && onNavigate ? (
                  <div className="mt-1">
                    <button type="button" onClick={() => onNavigate('holds')} aria-label="Open in Hold Center" className="text-2xs text-muted underline-offset-2 hover:text-ink hover:underline">
                      Open in Hold Center
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </OpsPanel>
  );
}
