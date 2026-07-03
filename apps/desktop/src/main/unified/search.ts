/**
 * The search facade callers use. It delegates to whatever `SearchBackend` the
 * unified store is configured with (local inverted index today; Meilisearch or
 * Qdrant later) and tags results with the backend name. Callers never change.
 */
import type { SearchQuery, SearchResult } from '@neuropause/shared';
import { unifiedStore } from './storeInstance';

export const unifiedSearch = {
  search(q: SearchQuery): SearchResult {
    const backend = unifiedStore.searchBackend;
    const hits = backend.search({ text: q.text, kinds: q.kinds, connectorId: q.connectorId, limit: q.limit });
    return { hits, total: hits.length, backend: backend.name };
  },
  stats(): { documents: number; terms: number } {
    return unifiedStore.searchBackend.stats();
  },
};
