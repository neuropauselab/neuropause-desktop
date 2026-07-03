import { useMemo } from 'react';
import { AppGlyph } from '@renderer/components/ui/AppGlyph';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Icon } from '@renderer/components/ui/Icon';
import { Button } from '@renderer/components/ui/Button';
import { formatRelative } from '@renderer/lib/format';
import { useOperations } from './OperationsProvider';
import { OpsPanel, OpsTable, IconAction, StatusBadge, Bar } from './primitives';
import { formatBytes, formatEta, formatRate, glyphFor, opStatusMeta, pct, toneFor } from './lib';

const ACTIVE: string[] = ['queued', 'resolving', 'downloading', 'verifying', 'installing', 'paused'];

/**
 * Download Center — a professional transfer manager. Active operations stream
 * live from the Package Service (progress, derived speed & ETA, integrity and
 * signature state); completed transfers persist to history across relaunches.
 */
export function DownloadsPanel(): JSX.Element {
  const { operations, rates, history, registry, dlPause, dlResume, dlCancel, dlRetry, clearDownloadHistory } = useOperations();

  const active = useMemo(() => operations.filter((o) => ACTIVE.includes(o.status)), [operations]);
  const sigBySlug = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const r of registry) m.set(r.slug, r.hasSignature);
    return m;
  }, [registry]);

  if (active.length === 0 && history.length === 0) {
    return (
      <OpsPanel title="Download Center" subtitle="Installs, updates, and repairs">
        <div className="surface-raised rounded-2xl shadow-card">
          <EmptyState
            icon="download"
            title="No active downloads"
            description="When you install or update an app, its transfer appears here with live speed, ETA, and integrity checks."
          />
        </div>
      </OpsPanel>
    );
  }

  const integrityLabel = (status: string): string => {
    if (status === 'verifying') return 'Checking…';
    if (['installing', 'completed'].includes(status)) return 'Verified';
    return '—';
  };

  return (
    <div>
      <OpsPanel title="Download Center" subtitle={`${active.length} active`}>
        {active.length === 0 ? (
          <p className="surface-raised rounded-2xl px-4 py-6 text-center text-sm text-faint shadow-card">No active transfers.</p>
        ) : (
          <OpsTable
            head={
              <>
                <th className="py-2.5 pl-4 pr-3 font-semibold">Name</th>
                <th className="px-3 py-2.5 font-semibold">Progress</th>
                <th className="px-3 py-2.5 font-semibold">Speed</th>
                <th className="px-3 py-2.5 font-semibold">ETA</th>
                <th className="px-3 py-2.5 font-semibold">Integrity</th>
                <th className="px-3 py-2.5 font-semibold">Signature</th>
                <th className="px-3 py-2.5 font-semibold">Status</th>
                <th className="py-2.5 pl-3 pr-4 text-right font-semibold">Actions</th>
              </>
            }
          >
            {active.map((o) => {
              const meta = opStatusMeta(o.status);
              const rate = rates[o.id];
              const paused = o.status === 'paused';
              const signed = sigBySlug.get(o.appSlug);
              return (
                <tr key={o.id} className="border-t border-[var(--hairline)] align-middle">
                  <td className="py-2.5 pl-4 pr-3">
                    <div className="flex items-center gap-2.5">
                      <AppGlyph glyph={glyphFor(o.appSlug)} tone={toneFor(o.appSlug)} size={28} />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{o.appSlug}</div>
                        <div className="text-2xs capitalize text-faint">{o.kind}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-24"><Bar value={o.progress} tone={paused ? 'orange' : 'accent'} /></div>
                      <span className="tabular-nums text-2xs text-faint">{pct(o.progress)}</span>
                    </div>
                    {o.bytesTotal != null && (
                      <div className="mt-0.5 text-2xs text-faint">{formatBytes(o.bytesDownloaded)} / {formatBytes(o.bytesTotal)}</div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-muted">{rate ? formatRate(rate.bytesPerSec) : '—'}</td>
                  <td className="px-3 py-2.5 tabular-nums text-muted">{rate ? formatEta(rate.etaSeconds) : '—'}</td>
                  <td className="px-3 py-2.5 text-muted">{integrityLabel(o.status)}</td>
                  <td className="px-3 py-2.5">
                    {signed
                      ? <span className="inline-flex items-center gap-1 text-xs text-sysgreen"><Icon name="shield" size={12} /> Signed</span>
                      : <span className="text-xs text-faint">—</span>}
                  </td>
                  <td className="px-3 py-2.5"><StatusBadge tone={meta.tone} label={meta.label} pulse={o.status === 'downloading'} /></td>
                  <td className="py-2 pl-3 pr-3">
                    <div className="flex items-center justify-end gap-0.5">
                      {paused
                        ? <IconAction icon="play" label="Resume" tone="green" onClick={() => void dlResume(o.id, o.appSlug)} />
                        : <IconAction icon="pause" label="Pause" onClick={() => void dlPause(o.id, o.appSlug)} />}
                      <IconAction icon="stop" label="Cancel" tone="red" onClick={() => void dlCancel(o.id, o.appSlug)} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </OpsTable>
        )}
      </OpsPanel>

      <OpsPanel
        title="History"
        subtitle={`${history.length} completed transfers`}
        actions={
          <Button size="sm" variant="secondary" icon="trash" onClick={clearDownloadHistory} disabled={history.length === 0}>
            Clear
          </Button>
        }
      >
        {history.length === 0 ? (
          <p className="surface-raised rounded-2xl px-4 py-6 text-center text-sm text-faint shadow-card">No download history yet.</p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-[var(--hairline)]">
            {history.map((h, idx) => {
              const meta = opStatusMeta(h.status);
              return (
                <div key={h.id} className={`flex items-center gap-3 px-4 py-2.5 ${idx > 0 ? 'border-t border-[var(--hairline)]' : ''}`}>
                  <AppGlyph glyph={glyphFor(h.appSlug)} tone={toneFor(h.appSlug)} size={26} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{h.appSlug}</div>
                    <div className="text-2xs capitalize text-faint">{h.kind} · {formatBytes(h.bytesTotal)}</div>
                  </div>
                  {h.status === 'failed' && <IconAction icon="undo" label="Retry" onClick={() => void dlRetry(h.appSlug)} />}
                  <span className="tabular-nums text-2xs text-faint">{formatRelative(h.at)}</span>
                  <StatusBadge tone={meta.tone} label={meta.label} />
                </div>
              );
            })}
          </div>
        )}
      </OpsPanel>
    </div>
  );
}
