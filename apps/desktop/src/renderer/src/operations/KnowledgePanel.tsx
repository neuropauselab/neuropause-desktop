import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConnectorDto, SearchHit, SearchResult, UnifiedCounts, UnifiedEntityKind } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { OpsPanel, Stat, Bar } from './primitives';
import { TINT_TONE, type OpsTone } from './lib';

const KIND_TONE: Record<string, OpsTone> = {
  project: 'blue',
  task: 'green',
  document: 'purple',
  file: 'gray',
  conversation: 'accent',
  message: 'accent',
  calendar_event: 'orange',
  event: 'orange',
  notification: 'red',
  contact: 'blue',
  label: 'gray',
  activity: 'blue',
  workspace: 'purple',
  organization: 'purple',
  account: 'gray',
  attachment: 'gray',
};
const kindTone = (k: string): OpsTone => KIND_TONE[k] ?? 'accent';

function humanizeKind(k: string): string {
  return k
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
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

function FilterChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full px-2.5 py-1 text-2xs font-medium outline-none transition focus-visible:shadow-focus',
        active ? 'surface-raised text-ink shadow-sm' : 'text-muted hover:text-ink [background:var(--fill-1)]',
      )}
    >
      {label}
    </button>
  );
}

function HitRow({ hit, source }: { hit: SearchHit; source: string }): JSX.Element {
  return (
    <li className="rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] px-3.5 py-2.5">
      <div className="flex items-center gap-2">
        <span className={cn('shrink-0 rounded-md px-1.5 py-0.5 text-2xs font-semibold', TINT_TONE[kindTone(hit.kind)])}>
          {humanizeKind(hit.kind)}
        </span>
        <span className="truncate text-sm font-medium text-ink">{hit.title}</span>
        <span className="ml-auto shrink-0 text-2xs text-faint">{source}</span>
      </div>
      {hit.snippet && <p className="mt-1 line-clamp-2 text-xs text-muted">{hit.snippet}</p>}
    </li>
  );
}

function CountRow({ label, count, max, tone }: { label: string; count: number; max: number; tone: OpsTone }): JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <span className="w-36 shrink-0 truncate text-sm text-muted">{label}</span>
      <div className="flex-1">
        <Bar value={max > 0 ? count / max : 0} tone={tone} />
      </div>
      <span className="w-14 shrink-0 text-right text-sm font-medium text-ink">{count.toLocaleString()}</span>
    </div>
  );
}

export function KnowledgePanel(): JSX.Element {
  const [counts, setCounts] = useState<UnifiedCounts | null>(null);
  const [connectors, setConnectors] = useState<ConnectorDto[]>([]);
  const [q, setQ] = useState('');
  const [kindFilter, setKindFilter] = useState<UnifiedEntityKind | null>(null);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const debounce = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    void ipc.unified.counts().then((c) => alive && setCounts(c)).catch(() => {});
    void ipc.connectors.list().then((c) => alive && setConnectors(c)).catch(() => {});
    const off = ipc.unified.onChange((c) => setCounts(c));
    return () => {
      alive = false;
      off();
    };
  }, []);

  useEffect(() => {
    if (debounce.current) window.clearTimeout(debounce.current);
    const text = q.trim();
    if (!text) {
      setResult(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounce.current = window.setTimeout(() => {
      void ipc.unified
        .search({ text, kinds: kindFilter ? [kindFilter] : undefined })
        .then((r) => {
          setResult(r);
          setSearching(false);
        })
        .catch(() => setSearching(false));
    }, 220);
    return () => {
      if (debounce.current) window.clearTimeout(debounce.current);
    };
  }, [q, kindFilter]);

  const nameOf = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of connectors) m[c.id] = c.name;
    return m;
  }, [connectors]);

  const kindEntries = useMemo(
    () => (counts ? Object.entries(counts.byKind).sort((a, b) => b[1] - a[1]) : []),
    [counts],
  );
  const sourceEntries = useMemo(
    () => (counts ? Object.entries(counts.byConnector).sort((a, b) => b[1] - a[1]) : []),
    [counts],
  );
  const total = counts?.total ?? 0;
  const kindMax = kindEntries.reduce((mx, [, n]) => Math.max(mx, n), 0);
  const sourceMax = sourceEntries.reduce((mx, [, n]) => Math.max(mx, n), 0);

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat icon="database" label="Total records" value={total.toLocaleString()} tone="blue" />
        <Stat icon="layers" label="Entity kinds" value={kindEntries.length} tone="purple" />
        <Stat icon="connectors" label="Sources" value={sourceEntries.length} tone="green" />
        <Stat icon="clock" label="Last updated" value={timeAgo(counts?.lastUpdatedAt ?? null)} tone="gray" />
      </div>

      <OpsPanel
        title="Search across everything"
        subtitle="One index over the unified model — results don't care which app the data came from"
      >
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint">
            <Icon name="search" size={16} />
          </span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search projects, tasks, documents, messages, events…"
            className="w-full rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] py-2.5 pl-9 pr-3 text-sm text-ink outline-none transition placeholder:text-faint focus:border-transparent focus-visible:shadow-focus"
          />
        </div>

        {kindEntries.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            <FilterChip active={kindFilter === null} label="All" onClick={() => setKindFilter(null)} />
            {kindEntries.map(([k]) => (
              <FilterChip
                key={k}
                active={kindFilter === k}
                label={humanizeKind(k)}
                onClick={() => setKindFilter((cur) => (cur === k ? null : (k as UnifiedEntityKind)))}
              />
            ))}
          </div>
        )}

        <div className="mt-4">
          {searching && <div className="text-sm text-faint">Searching…</div>}
          {!searching && result && result.hits.length === 0 && q.trim() && (
            <div className="text-sm text-faint">No matches for “{q.trim()}”.</div>
          )}
          {!searching && result && result.hits.length > 0 && (
            <>
              <div className="mb-2 text-2xs text-faint">
                {result.total} result{result.total === 1 ? '' : 's'} · {result.backend} index
              </div>
              <ul className="space-y-1.5">
                {result.hits.map((h) => (
                  <HitRow key={h.id} hit={h} source={nameOf[h.connectorId] ?? h.connectorId} />
                ))}
              </ul>
            </>
          )}
          {!q.trim() && total === 0 && (
            <EmptyState
              icon="database"
              compact
              title="Nothing to search yet"
              description="Connect a provider and run a sync — projects, tasks, documents, messages, and events from every connector land in one searchable model here."
            />
          )}
          {!q.trim() && total > 0 && (
            <p className="flex items-center gap-1.5 text-2xs text-faint">
              <Icon name="info" size={12} />
              Type to search across {total.toLocaleString()} records from every connected source.
            </p>
          )}
        </div>
      </OpsPanel>

      {total > 0 && (
        <div className="grid gap-6 lg:grid-cols-2">
          <OpsPanel title="By type" subtitle="Canonical entities in the model">
            <div className="space-y-2.5">
              {kindEntries.map(([k, n]) => (
                <CountRow key={k} label={humanizeKind(k)} count={n} max={kindMax} tone={kindTone(k)} />
              ))}
            </div>
          </OpsPanel>
          <OpsPanel title="By source" subtitle="Which connectors the data came from">
            <div className="space-y-2.5">
              {sourceEntries.map(([c, n]) => (
                <CountRow key={c} label={nameOf[c] ?? c} count={n} max={sourceMax} tone="accent" />
              ))}
            </div>
          </OpsPanel>
        </div>
      )}
    </>
  );
}
