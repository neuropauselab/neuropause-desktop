/**
 * Context Builder — the retrieval and relevance engine for the AI Engine.
 *
 * Its job: for a specific question or briefing, identify, rank, and assemble
 * ONLY the evidence needed — never the whole platform. The AI Engine never
 * receives raw platform data; it receives the curated `AiContextItem[]` this
 * builder produces. Sources today: Knowledge Graph, Timeline, AI Memory, the
 * Unified Data Model (incl. connected GitHub data), and the Mission Brief.
 *
 * It reuses the existing federated search (`runEnterpriseSearch`) as its
 * retrieval backbone rather than reinventing it, then layers on relevance ×
 * recency ranking, per-worker source selection, a governance seam, and a hard
 * budget (item + character caps) so context stays small and on-point.
 *
 * Pure: retrieval surfaces are injected, so it unit-tests electron-free.
 */
import type {
  AiContextItem,
  AiContextSource,
  AiWorkerId,
  Briefing,
  BriefingItem,
  BriefingSection,
  BriefingSectionId,
  EnterpriseSearchHit,
  EnterpriseSearchResult,
  SearchSourceKind,
} from '@neuropause/shared';
import { runEnterpriseSearch } from '../search/enterpriseSearch';
import type { EnterpriseSearchSources } from '../search/enterpriseSearch';

/** A request for assembled context. The query drives relevance retrieval. */
export interface ContextRequest {
  worker: AiWorkerId;
  /** Natural-language intent (a question or a subject) that drives retrieval. */
  query: string;
  /** Override the per-worker default source set. */
  sources?: AiContextSource[];
  /** Max context items to assemble (budget). */
  maxItems?: number;
  /** Max total characters across all items (budget). */
  maxChars?: number;
  /** Per-source search cap before ranking. */
  perSourceLimit?: number;
  /** ISO time used for recency scoring (defaults to now). */
  now?: string;
}

/** Injected retrieval seams — keeps the builder pure and unit-testable. */
export interface RetrievalPorts {
  /** Federated search across UDM/GitHub, graph, memory, timeline. */
  search?: (q: {
    text: string;
    sources: SearchSourceKind[];
    limit: number;
  }) => EnterpriseSearchResult;
  /** The current Mission Brief, or null when none is available. */
  briefing?: () => Briefing | null;
  /** Governance hook: return false to exclude an item before it reaches the model. */
  governanceFilter?: (item: AiContextItem) => boolean;
}

const ALL_SOURCES: AiContextSource[] = [
  'knowledge-graph',
  'timeline',
  'mission-brief',
  'unified-model',
  'github',
  'notion',
  'calendar',
  'slack',
  'ai-memory',
  'previous-decisions',
];

/** Which sources each worker draws on by default (overridable per request). */
const DEFAULT_SOURCES: Record<AiWorkerId, AiContextSource[]> = {
  engineering: ['github', 'knowledge-graph', 'timeline', 'mission-brief', 'ai-memory'],
  founder: [
    'mission-brief',
    'knowledge-graph',
    'ai-memory',
    'previous-decisions',
    'timeline',
    'github',
    'notion',
    'calendar',
    'slack',
  ],
  research: ['ai-memory', 'knowledge-graph', 'unified-model', 'timeline'],
  finance: ['mission-brief', 'unified-model', 'ai-memory'],
  marketing: ['unified-model', 'ai-memory', 'timeline'],
  support: ['unified-model', 'ai-memory', 'timeline'],
  'mission-brief': ['mission-brief', 'github', 'timeline', 'knowledge-graph'],
  diagnostic: ALL_SOURCES,
};

/** Higher = surface sooner. Engineering risk / CI lead; routine activity trails. */
const SECTION_PRIORITY: Record<BriefingSectionId, number> = {
  engineering_risk: 1.0,
  ci_health: 0.95,
  attention: 0.9,
  pr_health: 0.85,
  release_health: 0.8,
  in_progress: 0.7,
  upcoming: 0.65,
  meetings: 0.6,
  documents: 0.55,
  completed: 0.5,
  activity: 0.4,
};

const RELEVANCE_WEIGHT = 0.7;
const RECENCY_WEIGHT = 0.3;
const RECENCY_HALFLIFE_DAYS = 14;
const DEFAULT_MAX_ITEMS = 12;
const DEFAULT_MAX_CHARS = 6000;
const DEFAULT_PER_SOURCE = 8;

interface Scored {
  item: AiContextItem;
  score: number;
}

export class ContextBuilder {
  constructor(private readonly ports: RetrievalPorts = {}) {}

  /** Identify, rank, and assemble the context for one request. */
  build(req: ContextRequest): AiContextItem[] {
    const nowMs = parseNow(req.now);
    const sources =
      req.sources && req.sources.length > 0
        ? req.sources
        : (DEFAULT_SOURCES[req.worker] ?? ALL_SOURCES);
    const sourceSet = new Set(sources);
    const maxItems = req.maxItems ?? DEFAULT_MAX_ITEMS;
    const maxChars = req.maxChars ?? DEFAULT_MAX_CHARS;
    const perLimit = req.perSourceLimit ?? DEFAULT_PER_SOURCE;

    const scored: Scored[] = [];

    // 1) Federated search across the searchable sources (relevance).
    const searchKinds = toSearchSources(sources);
    const q = req.query.trim();
    if (this.ports.search && searchKinds.length > 0 && q.length > 0) {
      const result = this.ports.search({ text: q, sources: searchKinds, limit: perLimit });
      for (const hit of result.hits) {
        const source = hitToSource(hit);
        if (!sourceSet.has(source)) continue; // respect the requested source set precisely
        scored.push({
          item: { source, text: hitText(hit), evidence: [{ kind: hit.kind, id: hit.id }] },
          score:
            RELEVANCE_WEIGHT * clamp01(hit.score) +
            RECENCY_WEIGHT * recencyScore(hit.timestamp, nowMs),
        });
      }
    }

    // 2) Mission Brief (narrative facts; sections prioritized, recency-boosted).
    if (sourceSet.has('mission-brief') && this.ports.briefing) {
      const brief = this.ports.briefing();
      if (brief && brief.grounded) {
        for (const section of brief.sections) {
          if (section.empty) continue;
          const priority = SECTION_PRIORITY[section.id] ?? 0.5;
          for (const bi of section.items) {
            scored.push({
              item: {
                source: 'mission-brief',
                text: briefText(section, bi),
                evidence: bi.evidence.map((e) => ({ kind: e.kind, id: e.id })),
              },
              score: RELEVANCE_WEIGHT * priority + RECENCY_WEIGHT * recencyScore(bi.at, nowMs),
            });
          }
        }
      }
    }

    // 3) Governance seam (default allow-all; real policy enforcement wired later).
    let candidates = scored;
    const gf = this.ports.governanceFilter;
    if (gf) candidates = candidates.filter((c) => gf(c.item));

    // 4) Rank by relevance × recency.
    candidates.sort((a, b) => b.score - a.score);

    // 5) Budget — assemble only what's needed.
    return applyBudget(candidates, maxItems, maxChars);
  }
}

export interface ContextBuilderDeps {
  /** Live federated-search surfaces (UDM search backend, graph, memory, timeline). */
  searchSources?: EnterpriseSearchSources;
  /** Returns the current Mission Brief (or null). */
  getBriefing?: () => Briefing | null;
  governanceFilter?: (item: AiContextItem) => boolean;
}

/** Wire the Context Builder to the live subsystems (federated search + brief). */
export function createContextBuilder(deps: ContextBuilderDeps): ContextBuilder {
  const ports: RetrievalPorts = {};
  if (deps.searchSources) {
    const sourcesApi = deps.searchSources;
    ports.search = (qq): EnterpriseSearchResult =>
      runEnterpriseSearch({ text: qq.text, sources: qq.sources, limit: qq.limit }, sourcesApi);
  }
  if (deps.getBriefing) ports.briefing = deps.getBriefing;
  if (deps.governanceFilter) ports.governanceFilter = deps.governanceFilter;
  return new ContextBuilder(ports);
}

// --- helpers ----------------------------------------------------------------

function parseNow(now?: string): number {
  if (!now) return Date.now();
  const t = Date.parse(now);
  return Number.isNaN(t) ? Date.now() : t;
}

/** Map abstract context sources to the federated-search source kinds. */
function toSearchSources(sources: AiContextSource[]): SearchSourceKind[] {
  const set = new Set<SearchSourceKind>();
  for (const s of sources) {
    if (s === 'knowledge-graph') set.add('graph');
    else if (s === 'ai-memory' || s === 'previous-decisions') set.add('memory');
    else if (s === 'timeline') set.add('timeline');
    else if (
      s === 'unified-model' ||
      s === 'github' ||
      s === 'notion' ||
      s === 'calendar' ||
      s === 'slack'
    )
      set.add('entity');
  }
  return [...set];
}

/** Map a search hit back to the abstract context source it represents. */
function hitToSource(hit: EnterpriseSearchHit): AiContextSource {
  switch (hit.source) {
    case 'graph':
      return 'knowledge-graph';
    case 'memory':
      return 'ai-memory';
    case 'timeline':
      return 'timeline';
    case 'entity':
    default:
      if (hit.connectorId === 'github') return 'github';
      if (hit.connectorId === 'notion') return 'notion';
      if (hit.connectorId === 'google-workspace') return 'calendar';
      if (hit.connectorId === 'slack') return 'slack';
      return 'unified-model';
  }
}

function hitText(hit: EnterpriseSearchHit): string {
  const head = hit.title.trim() || hit.id;
  return hit.snippet ? `${head}\n${hit.snippet.trim()}` : head;
}

function briefText(section: BriefingSection, bi: BriefingItem): string {
  const head = `[${section.title}] ${bi.text}`;
  return bi.detail ? `${head}\n${bi.detail}` : head;
}

/** Recency in 0..1: 1 = now, halving every RECENCY_HALFLIFE_DAYS; unknown = 0.3. */
function recencyScore(ts: string | null, nowMs: number): number {
  if (!ts) return 0.3;
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return 0.3;
  const ageDays = Math.max(0, (nowMs - t) / 86_400_000);
  return Math.pow(0.5, ageDays / RECENCY_HALFLIFE_DAYS);
}

/** Greedily keep the highest-ranked items that fit the item + character budget. */
function applyBudget(ranked: Scored[], maxItems: number, maxChars: number): AiContextItem[] {
  const out: AiContextItem[] = [];
  let chars = 0;
  for (const c of ranked) {
    if (out.length >= maxItems) break;
    const len = c.item.text.length;
    if (chars + len > maxChars) continue; // skip; a smaller item below may still fit
    out.push(c.item);
    chars += len;
  }
  // Never return empty when there was something relevant: include the top item, truncated.
  if (out.length === 0 && ranked.length > 0) {
    const top = ranked[0];
    if (top) out.push({ ...top.item, text: top.item.text.slice(0, maxChars) });
  }
  return out;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
