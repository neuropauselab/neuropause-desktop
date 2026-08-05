/**
 * Module 10 — Global Search. A unified search across organizations, federations, exchanged
 * artifacts, and marketplace listings — built on the same source-registry indexing pattern
 * used in Waves 2/3 (reused, not reinvented). External sources (e.g. execution history,
 * intelligence graph) plug in through the same `SearchSource` interface.
 */
import type { OrganizationManager } from './organizations';
import type { FederationRuntime } from './federation';
import type { CrossOrgExchange } from './exchange';
import type { MarketplaceRuntime } from './marketplace';

export interface GlobalSearchHit {
  source: string;
  type: string;
  id: string;
  title: string;
}

export interface SearchSource {
  id: string;
  search(query: string, limit: number): GlobalSearchHit[] | Promise<GlobalSearchHit[]>;
}

export interface GlobalSearchResult {
  query: string;
  total: number;
  bySource: Record<string, number>;
  hits: GlobalSearchHit[];
}

export class GlobalSearch {
  private readonly sources = new Map<string, SearchSource>();

  register(source: SearchSource): void {
    this.sources.set(source.id, source);
  }
  sourceIds(): string[] {
    return [...this.sources.keys()];
  }

  async search(query: string, opts: { sources?: string[]; limit?: number } = {}): Promise<GlobalSearchResult> {
    const limit = opts.limit ?? 20;
    const ids = opts.sources ?? [...this.sources.keys()];
    const batches = await Promise.all(
      ids.map(async (id) => {
        const s = this.sources.get(id);
        if (!s) return [] as GlobalSearchHit[];
        try {
          return await s.search(query, limit);
        } catch {
          return [] as GlobalSearchHit[];
        }
      }),
    );
    const hits = batches.flat();
    const bySource: Record<string, number> = {};
    for (const h of hits) bySource[h.source] = (bySource[h.source] ?? 0) + 1;
    return { query, total: hits.length, bySource, hits };
  }
}

const match = (text: string, q: string): boolean => text.toLowerCase().includes(q.toLowerCase());

export function organizationSource(orgs: OrganizationManager): SearchSource {
  return { id: 'organizations', search: (q, limit) => orgs.list().filter((o) => match(o.name, q)).slice(0, limit).map((o) => ({ source: 'organizations', type: 'organization', id: o.id, title: o.name })) };
}
export function federationSource(federations: FederationRuntime): SearchSource {
  return { id: 'federations', search: (q, limit) => federations.list().filter((f) => match(f.name, q)).slice(0, limit).map((f) => ({ source: 'federations', type: 'federation', id: f.id, title: f.name })) };
}
export function exchangeSource(exchange: CrossOrgExchange): SearchSource {
  return { id: 'exchange', search: (q, limit) => exchange.all().filter((a) => match(a.name, q)).slice(0, limit).map((a) => ({ source: 'exchange', type: a.kind, id: a.id, title: a.name })) };
}
export function marketplaceSource(marketplace: MarketplaceRuntime): SearchSource {
  return { id: 'marketplace', search: (q, limit) => marketplace.search(q).slice(0, limit).map((l) => ({ source: 'marketplace', type: l.kind, id: l.id, title: l.name })) };
}
