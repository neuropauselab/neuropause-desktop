/**
 * Enterprise Search — one search across everything.
 *
 * Fans a query out to each retrieval surface, maps every result into a common
 * `EnterpriseSearchHit`, normalizes scores *within* each source (each scores on
 * its own scale), then merges into a single ranked list plus a per-source
 * breakdown. The timeline source is added in Drop 2b; the query already supports
 * a `sources` filter so it slots in without a signature change.
 *
 * Pure: the retrieval surfaces are injected, so it unit-tests against real
 * electron-free stores. The runtime wiring passes the singletons.
 */
import type {
  EnterpriseSearchGroup,
  EnterpriseSearchHit,
  EnterpriseSearchQuery,
  EnterpriseSearchResult,
  EnterpriseTimelineEntry,
  SearchSourceKind,
} from '@neuropause/shared';
import type { SearchBackend } from '../unified/searchBackend';
import type { GraphStore } from '../graph/graphStore';
import type { MemoryStore } from '../memory/memoryStore';

/** Minimal structural surface for the timeline source (avoids a class import). */
export interface TimelineSearcher {
  search(text: string, limit: number): EnterpriseTimelineEntry[];
}

export interface EnterpriseSearchSources {
  entity: SearchBackend;
  graph: GraphStore;
  memory: MemoryStore;
  /** Optional until the Enterprise Timeline is initialized. */
  timeline?: TimelineSearcher;
}

const DEFAULT_SOURCES: SearchSourceKind[] = ['entity', 'graph', 'memory', 'timeline'];

function excerpt(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

/** Normalize a source's hits to 0..1 by its own max, so sources are comparable. */
function normalize(hits: EnterpriseSearchHit[]): EnterpriseSearchHit[] {
  const max = hits.reduce((m, h) => Math.max(m, h.score), 0);
  if (max <= 0) return hits;
  return hits.map((h) => ({ ...h, score: Math.round((h.score / max) * 1000) / 1000 }));
}

function graphScore(label: string, query: string): number {
  const l = label.toLowerCase();
  const t = query.toLowerCase();
  if (l === t) return 1;
  if (l.startsWith(t)) return 0.8;
  if (l.includes(t)) return 0.6;
  return 0.4;
}

function timelineScore(entry: EnterpriseTimelineEntry, query: string): number {
  const t = query.toLowerCase();
  const title = entry.title.toLowerCase();
  if (title === t) return 1;
  if (title.includes(t)) return 0.8;
  if ((entry.summary ?? '').toLowerCase().includes(t)) return 0.5;
  return 0.4;
}

export function runEnterpriseSearch(
  query: EnterpriseSearchQuery,
  sourcesApi: EnterpriseSearchSources,
): EnterpriseSearchResult {
  const text = query.text.trim();
  const sources = query.sources && query.sources.length > 0 ? query.sources : DEFAULT_SOURCES;
  const perLimit = query.limit ?? 10;
  const groups: EnterpriseSearchGroup[] = [];
  const backends = new Set<string>();

  if (sources.includes('entity')) {
    backends.add(sourcesApi.entity.name);
    const raw = sourcesApi.entity.search({ text, limit: perLimit });
    const hits = normalize(
      raw.map((h): EnterpriseSearchHit => ({
        source: 'entity',
        id: h.id,
        kind: h.kind,
        title: h.title,
        snippet: h.snippet,
        score: h.score,
        connectorId: h.connectorId,
        timestamp: null,
        url: null,
      })),
    );
    groups.push({ source: 'entity', hits, total: hits.length });
  }

  if (sources.includes('graph')) {
    backends.add('graph');
    const nodes = sourcesApi.graph.listNodes({ text, limit: perLimit });
    const hits = normalize(
      nodes.map((n): EnterpriseSearchHit => ({
        source: 'graph',
        id: n.id,
        kind: n.type,
        title: n.label,
        snippet: null,
        score: graphScore(n.label, text),
        connectorId: n.connectorId,
        timestamp: n.updatedAt,
        url: typeof n.metadata.url === 'string' ? n.metadata.url : null,
      })),
    );
    groups.push({ source: 'graph', hits, total: hits.length });
  }

  if (sources.includes('memory')) {
    const res = sourcesApi.memory.recall({ text, limit: perLimit });
    backends.add(res.retriever);
    const hits = res.hits.map((h): EnterpriseSearchHit => ({
      source: 'memory',
      id: h.item.id,
      kind: h.item.kind,
      title: h.item.title,
      snippet: excerpt(h.item.content, 160),
      score: h.score,
      connectorId: h.item.connectorId,
      timestamp: h.item.occurredAt,
      url: null,
    }));
    groups.push({ source: 'memory', hits, total: hits.length });
  }

  if (sources.includes('timeline') && sourcesApi.timeline) {
    backends.add('timeline');
    const entries = sourcesApi.timeline.search(text, perLimit);
    const hits = normalize(
      entries.map((e): EnterpriseSearchHit => ({
        source: 'timeline',
        id: e.id,
        kind: e.kind,
        title: e.title,
        snippet: e.summary,
        score: timelineScore(e, text),
        connectorId: e.connectorId,
        timestamp: e.at,
        url: e.url,
      })),
    );
    groups.push({ source: 'timeline', hits, total: hits.length });
  }

  const merged = groups.flatMap((g) => g.hits).sort((a, b) => b.score - a.score);
  return { query: text, hits: merged, groups, total: merged.length, backends: [...backends] };
}
