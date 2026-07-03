/**
 * Enterprise Search — one search across everything.
 *
 * A federated query that fans out to every retrieval surface — Unified Data
 * Model entities, Knowledge Graph nodes, AI Memory, and (from Drop 2b) the
 * Enterprise Timeline — then merges and ranks the results into a single typed
 * list, with a per-source breakdown. Each source scores on its own scale, so
 * scores are normalized per source before merging; true cross-source hybrid
 * ranking arrives with the vector backend behind the same seam.
 *
 * Types-only.
 */

export type SearchSourceKind = 'entity' | 'graph' | 'memory' | 'timeline';

export const SEARCH_SOURCE_KINDS: readonly SearchSourceKind[] = [
  'entity', 'graph', 'memory', 'timeline',
] as const;

export interface EnterpriseSearchHit {
  source: SearchSourceKind;
  /** Ref id within its source (UDM id, graph node id, memory id, event id). */
  id: string;
  /** Entity kind / node type / memory kind / event type. */
  kind: string;
  title: string;
  snippet: string | null;
  /** Relevance in 0..1, normalized within the source. */
  score: number;
  connectorId: string | null;
  timestamp: string | null;
  url: string | null;
}

export interface EnterpriseSearchQuery {
  text: string;
  /** Which sources to include; defaults to all available. */
  sources?: SearchSourceKind[];
  /** Per-source result cap (default 10). */
  limit?: number;
}

export interface EnterpriseSearchGroup {
  source: SearchSourceKind;
  hits: EnterpriseSearchHit[];
  total: number;
}

export interface EnterpriseSearchResult {
  query: string;
  /** Merged + ranked across sources. */
  hits: EnterpriseSearchHit[];
  /** Per-source breakdown. */
  groups: EnterpriseSearchGroup[];
  total: number;
  /** Which retrievers answered (e.g. 'local', 'lexical'). */
  backends: string[];
}
