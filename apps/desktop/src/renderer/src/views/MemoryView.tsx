import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MemoryCounts, MemoryHit, MemoryKind } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { ViewHeader, ViewScroll } from '@renderer/components/ui/Page';
import { Spinner } from '@renderer/components/Spinner';

const KIND_LABEL: Record<MemoryKind, string> = {
  decision: 'Decisions',
  conversation: 'Conversations',
  document: 'Documents',
  task: 'Tasks',
  meeting: 'Meetings',
  context: 'Context',
  relationship: 'Relationships',
  note: 'Notes',
};

const KIND_ICON: Record<MemoryKind, IconName> = {
  decision: 'shield',
  conversation: 'command',
  document: 'doc',
  task: 'checklist',
  meeting: 'user',
  context: 'sparkles',
  relationship: 'connectors',
  note: 'doc',
};

const KINDS = Object.keys(KIND_LABEL) as MemoryKind[];

function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const s = Math.round((Date.now() - then) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/**
 * AI Memory — search everything you've worked on in plain language. Wired to the
 * real memory backend (recall + counts). Rendered defensively so a malformed
 * result can never crash the view.
 */
export function MemoryView(): JSX.Element {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<MemoryKind | 'all'>('all');
  const [hits, setHits] = useState<MemoryHit[]>([]);
  const [counts, setCounts] = useState<MemoryCounts | null>(null);
  const [loading, setLoading] = useState(true);

  const recall = useCallback(async (text: string, k: MemoryKind | 'all') => {
    setLoading(true);
    try {
      const res = await ipc.memory.recall({
        text: text.trim() || undefined,
        kinds: k === 'all' ? undefined : [k],
        limit: 50,
      });
      setHits(res?.hits ?? []);
    } catch {
      setHits([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void ipc.memory
      .counts()
      .then((c) => setCounts(c))
      .catch(() => {});
  }, []);

  // Debounced recall on query / kind change.
  useEffect(() => {
    const t = setTimeout(() => void recall(query, kind), 200);
    return () => clearTimeout(t);
  }, [query, kind, recall]);

  const total = counts?.total ?? 0;
  const byKind = counts?.byKind ?? {};

  const filterChips = useMemo(
    () => [
      { id: 'all' as const, label: 'All', count: total },
      ...KINDS.map((k) => ({ id: k, label: KIND_LABEL[k], count: byKind[k] ?? 0 })),
    ],
    [total, byKind],
  );

  return (
    <ViewScroll max={880}>
      <ViewHeader
        title="AI Memory"
        subtitle="Search everything you've worked on across every app, in plain language."
        right={
          <span className="text-xs text-faint">
            {total} {total === 1 ? 'memory' : 'memories'}
            {counts?.lastBuiltAt ? ` · updated ${relativeTime(counts.lastBuiltAt)}` : ''}
          </span>
        }
      />

      <div className="relative mb-3">
        <Icon
          name="search"
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30"
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask anything — “what did I work on yesterday”, “find the investor deck”…"
          aria-label="Search your memory"
          className="w-full rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] py-2.5 pl-9 pr-3 text-sm text-ink outline-none placeholder:text-faint focus-visible:shadow-focus"
        />
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {filterChips.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setKind(c.id)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition',
              kind === c.id
                ? 'border-transparent bg-white/15 text-white'
                : 'border-[var(--hairline)] text-faint hover:text-ink',
            )}
          >
            {c.label}
            <span className="text-white/40">{c.count}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Spinner />
        </div>
      ) : hits.length === 0 ? (
        <EmptyState
          icon="memory"
          title={query.trim() ? 'No memories match that' : 'Nothing remembered yet'}
          description={
            query.trim()
              ? 'Try a broader search, or a different filter.'
              : 'As you work across connected apps, NeuroPause remembers sessions and outputs here automatically.'
          }
        />
      ) : (
        <div className="space-y-2">
          {hits.map((h) => {
            const it = h.item;
            if (!it) return null;
            const k = (it.kind as MemoryKind) ?? 'context';
            return (
              <div
                key={it.id}
                className="rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] p-3.5"
              >
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/10">
                    <Icon name={KIND_ICON[k] ?? 'sparkles'} size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-ink">{it.title}</span>
                      <span className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase text-white/50">
                        {k}
                      </span>
                    </div>
                    {it.content && (
                      <p className="mt-1 line-clamp-2 text-xs text-white/60">{it.content}</p>
                    )}
                    <div className="mt-1.5 flex items-center gap-2 text-[10px] text-white/40">
                      {it.source && <span>{it.source}</span>}
                      {it.occurredAt || it.createdAt ? (
                        <span>· {relativeTime(it.occurredAt ?? it.createdAt)}</span>
                      ) : null}
                      {(it.tags ?? []).slice(0, 3).map((tag) => (
                        <span key={tag} className="rounded bg-white/5 px-1 py-0.5">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </ViewScroll>
  );
}
