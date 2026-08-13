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
import type { TenantScope } from '@neuropause/shared';
import type { SearchBackend } from '../unified/searchBackend';
import type { GraphStore } from '../graph/graphStore';
import type { MemoryStore } from '../memory/memoryStore';

/** Minimal structural surface for the timeline source (avoids a class import). */
export interface TimelineSearcher {
  search(text: string, limit: number): EnterpriseTimelineEntry[];
}

/**
 * P10 — the Federation source. Returns hits already in the common shape (tagged
 * `source: 'federation'`); the engine normalizes their scores like every other source, so
 * organizations, exchange packages, shared workers, and cross-org policies become searchable
 * through the ONE search engine (no duplicate search).
 */
export interface FederationSearcher {
  search(text: string, limit: number): EnterpriseSearchHit[];
}

export interface EnterpriseSearchSources {
  entity: SearchBackend;
  graph: GraphStore;
  memory: MemoryStore;
  /**
   * The authority under which the memory leg may run (P13A). REQUIRED.
   *
   * Required rather than optional, and that is the entire mechanism. Memory is
   * the one source here whose store enforces a per-viewer boundary, so a caller
   * that fans out to it without establishing an authority is asking a question
   * on nobody's behalf. Making the field optional would mean the compiler
   * accepted exactly that call — which is how the memory leg came to be
   * unscoped in the first place.
   *
   * `null` is a legitimate value meaning "no tenant resolved right now"
   * (cold start, signed out, suspended member). It is spelled explicitly so
   * that omitting the field and having no tenant are different acts: the first
   * does not compile, the second returns no memory hits.
   *
   * Nothing is trusted from it beyond its presence. The store re-derives the
   * real viewer from its own binding, so a forged scope passed here cannot
   * widen a single result — see the `memoryScope` guard in `runEnterpriseSearch`.
   */
  memoryScope: TenantScope | null;
  /** Optional until the Enterprise Timeline is initialized. */
  timeline?: TimelineSearcher;
  /** Optional until the Federation Platform is initialized (P10). */
  federation?: FederationSearcher;
}

// Federation is an OPT-IN source (callers pass `sources: ['federation']`); it is intentionally
// NOT in the default set, so cross-org metadata never flows through the broadly-reachable default
// Enterprise Search — the gated `federation:read` Federation Center is the primary surface (P10).
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

  /**
   * P13A — the memory leg runs only under a resolved authority.
   *
   * FAIL CLOSED, and note what is NOT happening here: this function does not
   * filter memory hits by `memoryScope`, because a filter applied by the caller
   * of a store is a filter the next caller can forget. The store's own
   * `filterFor` is the boundary, and it reads its viewer from its own binding —
   * so a FORGED `memoryScope` naming another tenant changes nothing about which
   * memories come back. What this gate adds is refusal of the case the store
   * cannot see: a fan-out issued when no tenant has resolved at all, which
   * would otherwise reach `recall` and depend entirely on the store having been
   * bound correctly.
   *
   * The group is still emitted, empty. Omitting it would make "search ran and
   * memory had nothing" indistinguishable from "memory was not consulted".
   */
  if (sources.includes('memory') && sourcesApi.memoryScope === null) {
    groups.push({ source: 'memory', hits: [], total: 0 });
  } else if (sources.includes('memory')) {
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

  if (sources.includes('federation') && sourcesApi.federation) {
    backends.add('federation');
    const hits = normalize(sourcesApi.federation.search(text, perLimit));
    groups.push({ source: 'federation', hits, total: hits.length });
  }

  const merged = groups.flatMap((g) => g.hits).sort((a, b) => b.score - a.score);
  return { query: text, hits: merged, groups, total: merged.length, backends: [...backends] };
}
