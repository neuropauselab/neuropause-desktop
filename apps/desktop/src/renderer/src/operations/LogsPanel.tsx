import { useMemo, useState } from 'react';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';
import { Button } from '@renderer/components/ui/Button';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { formatRelative } from '@renderer/lib/format';
import { useOperations, type OpsLogSource } from './OperationsProvider';
import { OpsPanel, StatusDot } from './primitives';

const FILTERS: { id: OpsLogSource | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'runtime', label: 'Runtime' },
  { id: 'download', label: 'Downloads' },
  { id: 'plugin', label: 'Plugins' },
  { id: 'permission', label: 'Permissions' },
  { id: 'registry', label: 'Registry' },
  { id: 'system', label: 'System' },
];

/** Activity Log — a chronological, filterable, exportable event timeline. */
export function LogsPanel(): JSX.Element {
  const { logEntries } = useOperations();
  const [filter, setFilter] = useState<OpsLogSource | 'all'>('all');

  const entries = useMemo(
    () => (filter === 'all' ? logEntries : logEntries.filter((e) => e.source === filter)),
    [logEntries, filter],
  );

  const exportJson = (): void => {
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `neuropause-activity-${new Date().toISOString().slice(0, 19)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <OpsPanel
      title="Activity Log"
      subtitle={`${logEntries.length} events this session`}
      actions={
        <Button size="sm" variant="secondary" icon="upload" onClick={exportJson} disabled={entries.length === 0}>
          Export
        </Button>
      }
    >
      <div className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium outline-none transition-colors focus-visible:shadow-focus',
              filter === f.id ? 'bg-accent text-accent-fg' : 'text-muted hover:text-ink [background:var(--fill-1)]',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {entries.length === 0 ? (
        <div className="surface-raised rounded-2xl shadow-card">
          <EmptyState
            icon="list"
            title="No events yet"
            description="Launch, install, or manage an app and its events will stream here in real time."
          />
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[var(--hairline)]">
          {entries.map((e, idx) => (
            <div
              key={e.id}
              className={cn('flex items-start gap-3 px-4 py-2.5', idx > 0 && 'border-t border-[var(--hairline)]')}
            >
              <span className="mt-1.5">
                <StatusDot tone={e.tone} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{e.title}</span>
                  <span className="rounded [background:var(--fill-2)] px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide text-faint">
                    {e.source}
                  </span>
                </div>
                {e.detail && <div className="truncate text-xs text-faint">{e.detail}</div>}
              </div>
              <span className="shrink-0 tabular-nums text-2xs text-faint">{formatRelative(e.at)}</span>
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 flex items-center gap-1.5 text-2xs text-faint">
        <Icon name="info" size={12} /> Events are kept for the current session. Export to archive them.
      </p>
    </OpsPanel>
  );
}
