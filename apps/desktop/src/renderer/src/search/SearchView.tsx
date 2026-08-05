/**
 * Phase 6 Stage 3 — Universal Search view (presentation only).
 *
 * One search box over every existing index, with: the Search Scope Selector,
 * streamed per-source status (loading / ready / honest "Unavailable — reason"),
 * "Understood as…" query-plan transparency, type/date filters + sorting,
 * grouped results, per-result quick actions, an expandable "Why this result?"
 * panel (relevance factors, source, freshness, confidence), saved + recent
 * searches, and full keyboard navigation. House tokens throughout.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { SavedView } from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { Card } from '@renderer/components/ui/Card';
import { Button } from '@renderer/components/ui/Button';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { SkeletonLines } from '@renderer/components/ui/Skeleton';
import { PIPELINE_SOURCES, type SearchAvailability } from './searchPipeline';
import type { PipelineSourceKey } from './queryPlanner';
import {
  SEARCH_SCOPES,
  TYPE_META,
  applyViewFilters,
  groupItems,
  type SearchDateFilter,
  type SearchItemType,
  type SearchScopeId,
  type SearchSort,
  type UnifiedSearchItem,
} from './searchModel';
import { actionsFor, type SearchActionId } from './searchActions';

const SOURCE_LABEL: Record<PipelineSourceKey, string> = {
  engine: 'Enterprise index',
  records: 'App records',
  semantic: 'Semantic',
  modules: 'Business records',
};

const CONFIDENCE_TONE: Record<string, string> = {
  high: 'text-sysgreen',
  medium: 'text-sysorange',
  low: 'text-faint',
};

export interface SearchViewProps {
  query: string;
  onQueryChange: (q: string) => void;
  onSubmit: (q: string) => void;
  scope: SearchScopeId;
  onScopeChange: (s: SearchScopeId) => void;
  items: UnifiedSearchItem[];
  availability: SearchAvailability;
  running: boolean;
  planExplain: string[];
  filterNotes: string[];
  timings: { totalMs: number; fromCache: boolean } | null;
  history: string[];
  saved: SavedView[];
  pinnedKeys: ReadonlySet<string>;
  onAction: (item: UnifiedSearchItem, action: SearchActionId) => void;
  onSaveSearch: () => void;
  onDeleteSaved: (id: string) => void;
  onPickQuery: (q: string) => void;
  onRefresh: () => void;
}

export function SearchView(props: SearchViewProps): JSX.Element {
  const { query, items, availability, running } = props;
  const [typeFilter, setTypeFilter] = useState<Set<SearchItemType>>(new Set());
  const [dateFilter, setDateFilter] = useState<SearchDateFilter>('any');
  const [sort, setSort] = useState<SearchSort>('relevance');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const now = Date.now();
  const visible = useMemo(
    () => applyViewFilters(items, { types: typeFilter.size > 0 ? typeFilter : null, date: dateFilter, sort, now }),
    [items, typeFilter, dateFilter, sort, now],
  );
  const groups = useMemo(() => groupItems(visible), [visible]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const presentTypes = useMemo(() => [...new Set(items.map((i) => i.type))], [items]);

  useEffect(() => {
    setActiveIndex((i) => Math.min(i, Math.max(0, flat.length - 1)));
  }, [flat.length]);

  const submitted = query.trim().length > 0 && (running || items.length > 0 || sourcesSettled(availability));

  const onKeyDown = (e: ReactKeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      props.onSubmit(query);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (flat.length ? (i + 1) % flat.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (flat.length ? (i - 1 + flat.length) % flat.length : 0));
    } else if (e.key === 'Escape') {
      props.onQueryChange('');
    }
  };

  const toggleType = (t: SearchItemType): void =>
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });

  let runningIndex = -1;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-6" onKeyDown={onKeyDown}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-ink">Search</h1>
          <p className="text-subtle text-sm">One search across every index — records, knowledge, activity, operations, business.</p>
        </div>
        {props.timings && (
          <span className="text-faint shrink-0 text-2xs tabular-nums">
            {props.timings.fromCache ? 'cached · ' : ''}{props.timings.totalMs} ms
          </span>
        )}
      </header>

      {/* Query box */}
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Icon name="search" size={16} className="text-faint pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => props.onQueryChange(e.target.value)}
            placeholder='Try: “invoices from last week” · “github issues” · “search gmail for the contract” · “connectors with failures”'
            aria-label="Universal search query"
            className="w-full rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] py-2.5 pl-10 pr-3 text-base text-ink outline-none placeholder:text-faint focus-visible:shadow-focus"
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <Button variant="primary" size="md" onClick={() => props.onSubmit(query)} loading={running}>
          Search
        </Button>
        {submitted && (
          <Button variant="ghost" size="md" icon="refresh" onClick={props.onRefresh} aria-label="Re-run bypassing cache" />
        )}
      </div>

      {/* Scope selector — routes across existing indexes; creates none */}
      <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Search scope">
        {SEARCH_SCOPES.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={props.scope === s.id}
            title={s.description}
            onClick={() => props.onScopeChange(s.id)}
            className={cn(
              'rounded-lg border px-2.5 py-1 text-xs font-medium outline-none transition-colors focus-visible:shadow-focus',
              props.scope === s.id ? 'border-transparent bg-accent/15 text-accent' : 'border-[var(--hairline)] text-subtle fill-hover',
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Query understanding — never a black box */}
      {props.planExplain.length > 0 && query.trim().length > 0 && (
        <p className="text-faint text-xs">
          Understood as: {props.planExplain.join(' · ')}
          {props.filterNotes.length > 0 && <span> — {props.filterNotes.join(' · ')}</span>}
        </p>
      )}

      {!submitted ? (
        <IdleRail history={props.history} saved={props.saved} onPickQuery={props.onPickQuery} onDeleteSaved={props.onDeleteSaved} />
      ) : (
        <>
          {/* Per-source status strip — every source states loading / ready / why not */}
          <div className="flex flex-wrap items-center gap-1.5 text-2xs">
            {PIPELINE_SOURCES.map((s) => {
              const st = availability[s];
              if (st.state === 'idle') return null;
              return (
                <span
                  key={s}
                  title={st.state === 'unavailable' ? st.reason : st.state === 'ready' ? st.note ?? 'ready' : 'loading'}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md border border-[var(--hairline)] px-1.5 py-0.5',
                    st.state === 'unavailable' ? 'text-sysorange' : st.state === 'loading' ? 'text-faint' : 'text-subtle',
                  )}
                >
                  <span
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      st.state === 'ready' ? 'bg-sysgreen' : st.state === 'loading' ? 'bg-[var(--fill-2)]' : 'bg-sysorange',
                    )}
                  />
                  {SOURCE_LABEL[s]}
                  {st.state === 'unavailable' && <span className="max-w-[260px] truncate">— {st.reason}</span>}
                </span>
              );
            })}
          </div>

          {/* Filters + sort + save */}
          <div className="flex flex-wrap items-center gap-1.5">
            {presentTypes.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => toggleType(t)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs outline-none focus-visible:shadow-focus',
                  typeFilter.has(t) ? 'border-transparent bg-accent/15 text-accent' : 'border-[var(--hairline)] text-faint fill-hover',
                )}
              >
                <Icon name={TYPE_META[t].icon as IconName} size={12} />
                {TYPE_META[t].label}
              </button>
            ))}
            <span className="mx-1 text-faint">·</span>
            {(['any', '24h', '7d', '30d'] as SearchDateFilter[]).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDateFilter(d)}
                className={cn('rounded-lg px-2 py-1 text-xs outline-none focus-visible:shadow-focus', dateFilter === d ? 'bg-accent/15 text-accent' : 'text-faint fill-hover')}
              >
                {d === 'any' ? 'Any time' : d}
              </button>
            ))}
            <span className="mx-1 text-faint">·</span>
            {(['relevance', 'newest'] as SearchSort[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSort(s)}
                className={cn('rounded-lg px-2 py-1 text-xs capitalize outline-none focus-visible:shadow-focus', sort === s ? 'bg-accent/15 text-accent' : 'text-faint fill-hover')}
              >
                {s}
              </button>
            ))}
            <span className="ml-auto" />
            <Button variant="ghost" size="sm" icon="pin" onClick={props.onSaveSearch}>
              Save search
            </Button>
          </div>

          {/* Results */}
          {flat.length === 0 && !running ? (
            <EmptyState
              icon="search"
              title={`No results for “${query.trim()}”`}
              description="Try a different term, widen the scope to Everything, or check the source status above — an unavailable source explains itself."
            />
          ) : (
            <div className="flex flex-col gap-4 pb-6">
              {running && flat.length === 0 && <SkeletonLines rows={4} />}
              {groups.map((g) => (
                <section key={g.type} aria-label={g.label}>
                  <h2 className="text-subtle mb-1.5 flex items-center gap-1.5 text-sm font-semibold">
                    <Icon name={g.icon as IconName} size={14} />
                    {g.label}
                    <span className="text-faint font-normal">· {g.items.length}</span>
                  </h2>
                  <Card flush className="p-1">
                    {g.items.map((item) => {
                      runningIndex += 1;
                      const index = runningIndex;
                      const active = index === activeIndex;
                      const expanded = expandedKey === item.key;
                      const acts = actionsFor(item);
                      return (
                        <div key={item.key} className={cn('rounded-xl', active && 'bg-accent/8')}>
                          <div
                            role="button"
                            tabIndex={0}
                            onMouseMove={() => setActiveIndex(index)}
                            onClick={() => props.onAction(item, 'open')}
                            onKeyDown={(e) => { if (e.key === 'Enter') props.onAction(item, 'open'); }}
                            className="fill-hover flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-left outline-none focus-visible:shadow-focus"
                          >
                            <Icon name={TYPE_META[item.type].icon as IconName} size={16} className="text-subtle shrink-0" />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-2">
                                <span className="truncate text-base font-medium text-ink">{item.title}</span>
                                {props.pinnedKeys.has(item.key) && <Icon name="pin" size={12} className="text-accent shrink-0" />}
                                <span className="text-faint shrink-0 text-2xs">{item.kind}</span>
                              </span>
                              {item.summary && <span className="text-faint block truncate text-xs">{item.summary}</span>}
                            </span>
                            {item.explanation.confidence && (
                              <span className={cn('shrink-0 text-2xs font-medium uppercase', CONFIDENCE_TONE[item.explanation.confidence])}>
                                {item.explanation.confidence}
                              </span>
                            )}
                            {item.explanation.freshness && (
                              <span className="text-faint shrink-0 text-2xs tabular-nums">{item.explanation.freshness}</span>
                            )}
                            <button
                              type="button"
                              aria-expanded={expanded}
                              aria-label="Why this result?"
                              onClick={(e) => { e.stopPropagation(); setExpandedKey(expanded ? null : item.key); }}
                              className="text-faint hover:text-ink shrink-0 rounded-md px-1.5 py-0.5 text-2xs outline-none focus-visible:shadow-focus"
                            >
                              Why?
                            </button>
                          </div>
                          {expanded && (
                            <div className="mx-3 mb-2 rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] px-3 py-2">
                              <p className="text-subtle mb-1 text-2xs font-semibold uppercase tracking-wide">Why this result?</p>
                              <ul className="space-y-0.5">
                                {item.explanation.factors.map((f, i) => (
                                  <li key={i} className="flex items-baseline gap-2 text-xs">
                                    <span className="text-ink">{f.label}</span>
                                    {f.detail && <span className="text-faint truncate">{f.detail}</span>}
                                    {typeof f.weight === 'number' && <span className="text-faint ml-auto shrink-0 tabular-nums">+{f.weight}</span>}
                                  </li>
                                ))}
                              </ul>
                              <p className="text-faint mt-1.5 text-2xs">
                                Source: {item.explanation.source}
                                {item.explanation.freshness ? ` · ${item.explanation.freshness}` : ' · no timestamp from this source'}
                                {item.explanation.confidence ? ` · confidence ${item.explanation.confidence}` : ''}
                                {` · final score ${item.score.toFixed(2)}`}
                              </p>
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {acts.map((a) => (
                                  <Button key={a.id} variant="secondary" size="sm" onClick={() => props.onAction(item, a.id)}>
                                    <Icon name={a.icon as IconName} size={13} />
                                    {a.label}
                                  </Button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </Card>
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function sourcesSettled(a: SearchAvailability): boolean {
  return PIPELINE_SOURCES.some((s) => a[s].state === 'ready' || a[s].state === 'unavailable');
}

function IdleRail({
  history,
  saved,
  onPickQuery,
  onDeleteSaved,
}: {
  history: string[];
  saved: SavedView[];
  onPickQuery: (q: string) => void;
  onDeleteSaved: (id: string) => void;
}): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card flush className="p-4">
        <h2 className="text-subtle mb-2 text-sm font-semibold">Saved searches</h2>
        {saved.length === 0 ? (
          <p className="text-faint text-xs">Run a search and press “Save search” to keep it here.</p>
        ) : (
          <ul className="space-y-1">
            {saved.map((v) => (
              <li key={v.id} className="flex items-center gap-2">
                <button type="button" onClick={() => onPickQuery(v.query)} className="fill-hover min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-left text-sm text-ink outline-none focus-visible:shadow-focus">
                  {v.label}
                </button>
                <Button variant="ghost" size="sm" icon="trash" aria-label={`Delete saved search ${v.label}`} onClick={() => onDeleteSaved(v.id)} />
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card flush className="p-4">
        <h2 className="text-subtle mb-2 text-sm font-semibold">Recent searches</h2>
        {history.length === 0 ? (
          <p className="text-faint text-xs">Your recent searches appear here (stored locally).</p>
        ) : (
          <ul className="space-y-1">
            {history.slice(0, 10).map((h) => (
              <li key={h}>
                <button type="button" onClick={() => onPickQuery(h)} className="fill-hover w-full truncate rounded-lg px-2 py-1.5 text-left text-sm text-ink outline-none focus-visible:shadow-focus">
                  {h}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
