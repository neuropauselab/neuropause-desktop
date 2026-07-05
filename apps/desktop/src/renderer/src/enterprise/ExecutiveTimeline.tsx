import { useEffect, useMemo, useState } from 'react';
import {
  buildDecisionTimeline,
  filterTimeline,
  timelineEventLabel,
  type DecisionPriority,
  type DecisionStatus,
  type ExecutiveDecision,
  type ExecutiveTimelineEntry,
} from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { formatRelative } from '@renderer/lib/format';
import { Card } from '@renderer/components/ui/Card';
import { Icon } from '@renderer/components/ui/Icon';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Spinner } from '@renderer/components/Spinner';
import { TINT_TONE, TEXT_TONE, DOT_BG, type OpsTone } from '../operations/lib';

function priorityToTone(p: DecisionPriority): OpsTone {
  return p === 'critical' ? 'red' : p === 'high' ? 'orange' : p === 'medium' ? 'blue' : 'gray';
}

/** Tone for an event by its resulting state. */
function eventTone(e: ExecutiveTimelineEntry): OpsTone {
  if (e.kind === 'blocked') return 'orange';
  if (e.newState === 'completed') return 'green';
  if (e.newState === 'rejected' || e.newState === 'archived') return 'gray';
  if (e.kind === 'resumed' || e.newState === 'in_progress') return 'blue';
  return 'gray';
}

const PRIORITIES: DecisionPriority[] = ['critical', 'high', 'medium', 'low'];
const STATUSES: DecisionStatus[] = [
  'suggested',
  'accepted',
  'in_progress',
  'blocked',
  'completed',
  'rejected',
];

/**
 * Executive Timeline (V3.7) — a chronological, filterable view built purely from
 * decision history (reuses ipc.decisions.list + the shared timeline builder). No
 * new persistence; no polling (one fetch on mount).
 */
export function ExecutiveTimeline(): JSX.Element {
  const [decisions, setDecisions] = useState<ExecutiveDecision[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [owner, setOwner] = useState<string>('');
  const [priority, setPriority] = useState<DecisionPriority | ''>('');
  const [status, setStatus] = useState<DecisionStatus | ''>('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let alive = true;
    ipc.decisions
      .list()
      .then((r) => {
        if (alive) setDecisions(r.decisions);
      })
      .catch(() => {
        if (alive) setDecisions([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const owners = useMemo(() => {
    const set = new Set<string>();
    (decisions ?? []).forEach((d) => set.add(d.owner));
    return [...set].sort();
  }, [decisions]);

  const entries = useMemo(() => buildDecisionTimeline(decisions ?? []), [decisions]);

  const filtered = useMemo(
    () =>
      filterTimeline(entries, {
        owner: owner || undefined,
        priority: priority || undefined,
        status: status || undefined,
        query: query || undefined,
      }),
    [entries, owner, priority, status, query],
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-xs text-white/40">
        <Spinner size={14} /> Loading timeline…
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <EmptyState
        icon="clock"
        title="No timeline yet"
        description="Accept a recommendation and move decisions through their lifecycle to build the executive timeline."
      />
    );
  }

  const hasFilters = owner || priority || status || query;

  return (
    <div>
      {/* Filter bar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 basis-48">
          <Icon
            name="search"
            className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/30"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search timeline…"
            aria-label="Search timeline"
            className="w-full rounded-lg border border-[var(--hairline)] bg-[var(--fill-1)] py-1.5 pl-7 pr-2 text-xs text-ink outline-none placeholder:text-faint focus-visible:shadow-focus"
          />
        </div>
        <FilterSelect
          value={owner}
          onChange={setOwner}
          label="Owner"
          options={owners.map((o) => ({ value: o, label: o }))}
        />
        <FilterSelect
          value={priority}
          onChange={(v) => setPriority(v as DecisionPriority | '')}
          label="Priority"
          options={PRIORITIES.map((p) => ({ value: p, label: p }))}
        />
        <FilterSelect
          value={status}
          onChange={(v) => setStatus(v as DecisionStatus | '')}
          label="Status"
          options={STATUSES.map((s) => ({ value: s, label: s.replace('_', ' ') }))}
        />
        {hasFilters && (
          <button
            onClick={() => {
              setOwner('');
              setPriority('');
              setStatus('');
              setQuery('');
            }}
            className="rounded-lg px-2 py-1.5 text-xs text-white/50 transition hover:bg-white/5 hover:text-white/80 focus:outline-none focus-visible:shadow-focus"
          >
            Clear
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="py-6 text-center text-xs text-white/30">No events match these filters.</p>
      ) : (
        <ol className="relative space-y-2 border-l border-white/5 pl-4">
          {filtered.map((e) => {
            const tone = eventTone(e);
            const pTone = priorityToTone(e.priority);
            return (
              <li key={e.id} className="relative">
                <span
                  className={cn(
                    'absolute -left-[21px] top-2 h-2 w-2 rounded-full ring-2 ring-[var(--bg)]',
                    DOT_BG[tone],
                  )}
                  aria-hidden="true"
                />
                <Card variant="flat" flush className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={cn('text-xs font-semibold', TEXT_TONE[tone])}>
                          {timelineEventLabel(e)}
                        </span>
                        <span className="truncate text-xs text-white/60">{e.title}</span>
                      </div>
                      <p className="mt-0.5 line-clamp-1 text-[11px] text-white/40">
                        {e.businessImpact}
                      </p>
                    </div>
                    <span
                      className={cn(
                        'shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase',
                        TINT_TONE[pTone],
                        TEXT_TONE[pTone],
                      )}
                    >
                      {e.priority}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-white/40">
                    <span>{formatRelative(e.at)}</span>
                    <span>{e.owner}</span>
                    <span>{e.evidenceCount} evidence</span>
                    {e.reason && <span className="text-white/50">{e.reason}</span>}
                  </div>
                </Card>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  label,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  options: Array<{ value: string; label: string }>;
}): JSX.Element {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={`Filter by ${label}`}
      className="rounded-lg border border-[var(--hairline)] bg-[var(--fill-1)] px-2 py-1.5 text-xs text-ink outline-none focus-visible:shadow-focus"
    >
      <option value="">{label}: all</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
