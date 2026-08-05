import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MemoryCounts, MemoryHit, MemoryKind } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import {
  describeRetrieval,
  retrievalStatusForIpcFailure,
  type RetrievalStatus,
} from '@renderer/lib/retrievalStatus';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Chip, ChipRow } from '@renderer/components/ui/pillTabs';
import { ViewHeader, ViewScroll } from '@renderer/components/ui/Page';
import { Spinner } from '@renderer/components/Spinner';
import { explanationLabels } from './memoryExplanation';
import { RelatedMemories } from './RelatedMemories';
import { KnowledgeTopics } from './KnowledgeTopics';

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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /** A6 — what retrieval actually did. `null` means "nothing to report". */
  const [retrieval, setRetrieval] = useState<RetrievalStatus | null>(null);
  /** A6 — set when recall produced NO answer at all, as distinct from an empty one. */
  const [failure, setFailure] = useState<string | null>(null);

  const recall = useCallback(async (text: string, k: MemoryKind | 'all') => {
    setLoading(true);
    try {
      const params = {
        text: text.trim() || undefined,
        kinds: k === 'all' ? undefined : [k],
        limit: 50,
      };
      // Prefer semantic recall; fall back to lexical if it errors client-side
      // (the main handler also degrades gracefully, but this covers IPC failures).
      //
      // A6 — the fallback is kept, but it is no longer SILENT. The catch below
      // used to swallow every client-side rejection, including the RBAC denial
      // on `memory:semanticRecall` ('intelligence:read'): a user without that
      // permission got keyword-only results presented as a complete answer,
      // forever, with nothing anywhere saying why. What the fallback protects
      // (results keep appearing) is right; what it hid is not.
      let res: Awaited<ReturnType<typeof ipc.memory.recall>>;
      let status: RetrievalStatus | null;
      try {
        res = await ipc.memory.semanticRecall(params);
        // The call resolving is not proof retrieval ran — read the envelope.
        status = describeRetrieval(res?.retrieval);
      } catch (err) {
        res = await ipc.memory.recall(params);
        // Keep the reason the semantic attempt failed; the lexical channel has
        // no envelope of its own to describe (it has no semantic leg).
        status = retrievalStatusForIpcFailure(err);
      }
      setHits(res?.hits ?? []);
      setRetrieval(status);
      setFailure(null);
    } catch (err) {
      // Nothing answered. Previously this rendered the "No memories match that"
      // empty state — a claim about the user's data made from a failure to read
      // it. Say what happened instead.
      setHits([]);
      setRetrieval(null);
      setFailure(retrievalStatusForIpcFailure(err).detail ?? 'Memory search is unavailable.');
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
  const byKind = useMemo(() => counts?.byKind ?? {}, [counts]);

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

      <KnowledgeTopics onPick={(entity) => setQuery(entity)} />

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

      <div className="mb-4">
        <ChipRow>
          {filterChips.map((c) => (
            <Chip
              key={c.id}
              label={c.label}
              count={c.count}
              active={kind === c.id}
              onClick={() => setKind(c.id)}
            />
          ))}
        </ChipRow>
      </div>

      {/* A6 — shown only for a genuine degradation, so it stays meaningful. A
          by-design lexical mode (no org, not configured, empty query) is normal
          operation and says nothing; a warning on every browse would train the
          user to ignore the one case that matters. */}
      {!loading && retrieval?.degraded && (
        <div
          role="status"
          className="mb-3 flex items-start gap-2.5 rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] p-3.5"
        >
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sysorange/15">
            <Icon name="info" size={14} className="text-sysorange" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-ink">{retrieval.message}</p>
            {retrieval.detail && (
              <p className="mt-1 break-words text-[10px] text-white/40">{retrieval.detail}</p>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Spinner />
        </div>
      ) : failure ? (
        /* Distinct from "no matches": memory could not be read, so we know
           nothing about whether matches exist. */
        <EmptyState
          icon="memory"
          title="Couldn’t search your memory"
          description={failure}
        />
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
            const labels = explanationLabels(h.ranking);
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
                    {labels.length > 0 && (
                      <div className="mt-1 text-[10px] text-white/30">{labels.join(' • ')}</div>
                    )}
                    <button
                      type="button"
                      onClick={() => setExpandedId(expandedId === it.id ? null : it.id)}
                      className="mt-2 text-[10px] text-white/40 transition hover:text-white/70"
                    >
                      {expandedId === it.id ? 'Hide related' : 'Related memories'}
                    </button>
                    {expandedId === it.id && <RelatedMemories memoryId={it.id} />}
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
