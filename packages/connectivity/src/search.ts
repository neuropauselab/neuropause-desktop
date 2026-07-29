/**
 * Module 12 — Enterprise Search. A unified, tenant-scoped search that fans out across
 * registered sources and merges the results. Internal NEMS (organizations / users /
 * OKRs / dashboards / settings) is a genuinely-live source over the real database; each
 * connected system is a source backed by its adapter through the transport seam. A
 * source that throws is skipped, never fatal to the unified query.
 */
import type { NemsPlatform } from '@neuropause/nems';

export interface SearchHit {
  source: string;
  type: string;
  id: string;
  title: string;
  url?: string;
}

export interface SearchSource {
  id: string;
  search(tenantId: string, query: string, limit: number): Promise<SearchHit[]>;
}

export interface UnifiedSearchResult {
  query: string;
  total: number;
  bySource: Record<string, number>;
  hits: SearchHit[];
}

export class EnterpriseSearch {
  private readonly sources = new Map<string, SearchSource>();

  register(source: SearchSource): void {
    this.sources.set(source.id, source);
  }

  sources_(): string[] {
    return [...this.sources.keys()];
  }

  async search(tenantId: string, query: string, opts: { sources?: string[]; limit?: number } = {}): Promise<UnifiedSearchResult> {
    const limit = opts.limit ?? 10;
    const ids = opts.sources ?? [...this.sources.keys()];
    const batches = await Promise.all(
      ids.map(async (id) => {
        const s = this.sources.get(id);
        if (!s) return [] as SearchHit[];
        try {
          return await s.search(tenantId, query, limit);
        } catch {
          return [] as SearchHit[];
        }
      }),
    );
    const hits = batches.flat();
    const bySource: Record<string, number> = {};
    for (const h of hits) bySource[h.source] = (bySource[h.source] ?? 0) + 1;
    return { query, total: hits.length, bySource, hits };
  }
}

/** Internal-NEMS search source (real database). */
export function nemsSearchSource(nems: NemsPlatform): SearchSource {
  return {
    id: 'nems',
    async search(tenantId: string, query: string, limit: number): Promise<SearchHit[]> {
      const hits = await nems.search().search(tenantId, query, limit);
      return hits.map((h) => ({ source: 'nems', type: h.type, id: h.id, title: h.label }));
    },
  };
}

/** Adapt any async search function into a source (e.g. a connector-backed search). */
export function functionSearchSource(id: string, fn: (tenantId: string, query: string, limit: number) => Promise<SearchHit[]>): SearchSource {
  return { id, search: fn };
}
