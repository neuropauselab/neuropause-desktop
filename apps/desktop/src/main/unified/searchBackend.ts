/**
 * Pluggable search over the UDM.
 *
 * `SearchBackend` is the seam: the Query/Search facade and the UI call it and
 * never know which engine answers. `LocalSearchBackend` is a real in-memory
 * inverted index (TF-IDF scoring) that works with zero external services. A
 * `MeilisearchBackend` (keyword) and `QdrantBackend` (vector) can implement the
 * same interface later without changing a single caller.
 */
import type { SearchHit, TenantScope, UnifiedEntity, UnifiedEntityKind } from '@neuropause/shared';
import { ownershipOf } from '@neuropause/shared';
import { registerTenantStore } from '../tenancy/tenantOwnedStore';

/**
 * A process-wide fallback scope for the index, for TESTS ONLY.
 *
 * Separate from the store's ambient seam because a test can construct a
 * `LocalSearchBackend` directly, without a store to bind it. Same runtime
 * guard; a per-instance binding always wins.
 */
let ambientSearchScope: (() => TenantScope | null) | null = null;

export function setAmbientSearchScopeForTests(source: (() => TenantScope | null) | null): void {
  if (process.env.VITEST === undefined && process.env.NODE_ENV !== 'test') {
    throw new Error(
      'setAmbientSearchScopeForTests is a test-only seam and must not be called at runtime.',
    );
  }
  ambientSearchScope = source;
}

export interface SearchBackendQuery {
  text: string;
  kinds?: UnifiedEntityKind[];
  connectorId?: string;
  limit?: number;
}

export interface SearchBackend {
  /** Identifier returned in results ('local' | 'meilisearch' | 'qdrant'). */
  readonly name: string;
  /** Index (or re-index) entities. Existing ids are replaced. */
  index(entities: UnifiedEntity[]): void;
  /** Drop entities from the index. */
  remove(ids: string[]): void;
  /** Run a search. */
  search(query: SearchBackendQuery): SearchHit[];
  /** Empty the index. */
  clear(): void;
  /** Index size, for diagnostics. */
  stats(): { documents: number; terms: number };
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'her', 'was', 'one', 'our',
  'out', 'has', 'had', 'his', 'how', 'its', 'who', 'did', 'yes', 'this', 'that', 'with', 'from',
  'they', 'will', 'would', 'there', 'their', 'what', 'about', 'which', 'when', 'into',
]);

function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 2) continue;
    if (STOPWORDS.has(raw)) continue;
    out.push(raw);
  }
  return out;
}

/** What the index stores per document. */
interface IndexedDoc {
  id: string;
  kind: UnifiedEntityKind;
  connectorId: string;
  title: string;
  /** Original searchable text, kept for snippet generation. */
  text: string;
  /** Term → frequency within this doc. */
  terms: Map<string, number>;
}

function searchableText(e: UnifiedEntity): string {
  return [e.title, e.body ?? '', e.author ?? '', e.labels.join(' ')].filter(Boolean).join('  ');
}

function makeSnippet(text: string, queryTerms: string[]): string {
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of queryTerms) {
    const i = lower.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return text.slice(0, 140).trim();
  const start = Math.max(0, at - 50);
  const end = Math.min(text.length, at + 90);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

/** One tenant's private corpus: its documents and its own postings. */
interface TenantIndex {
  docs: Map<string, IndexedDoc>;
  /** term → set of doc ids containing it, WITHIN this tenant. */
  postings: Map<string, Set<string>>;
}

/**
 * In-memory inverted index with TF-IDF scoring.
 *
 * P13B — PARTITIONED PER TENANT, NOT FILTERED PER QUERY.
 *
 * This is the one place in the program where the boundary is drawn by data
 * structure rather than by a predicate, and the reason is TF-IDF.
 *
 * The obvious fix — keep one corpus and drop non-visible hits after scoring —
 * would have left a working oracle. `idf = log(1 + N / postings.size)` is
 * computed from the GLOBAL document count and the GLOBAL posting-list length,
 * and the resulting score is returned to the caller. So the score of a hit the
 * caller IS allowed to see silently encodes how many documents in the whole
 * install — including other tenants' — contain that term. Filtering afterwards
 * does not perturb the number, because the number was computed before the
 * filter ran. A tenant could binary-search another tenant's vocabulary through
 * a value that looks like a relevance score.
 *
 * Partitioning removes the question instead of answering it. `N` is the
 * caller's own document count, postings are the caller's own, `stats()` reports
 * the caller's own cardinality, and a term that appears only in another
 * tenant's corpus has no posting list here at all — so it cannot be counted,
 * ranked, or scored. There is nothing to leak because nothing global is
 * consulted.
 *
 * The cost is one Map lookup per operation and some duplicated term keys across
 * tenants. That is the correct trade for an install holding a handful of
 * tenants, and it is the same shape a real engine would use: an index per
 * tenant, not a shared index with a filter.
 */
export class LocalSearchBackend implements SearchBackend {
  readonly name = 'local';
  /** tenantId → that tenant's private index. */
  private byTenant = new Map<string, TenantIndex>();
  private scopeSource: (() => TenantScope | null) | null = null;

  /**
   * P13C ROUND 3 — PHASE 4. Declare this index to the startup gate.
   *
   * Worth singling out: this backend is bound ONLY transitively, from
   * `UnifiedStore.bindScope`. It holds a second copy of every unified record,
   * so an instance constructed anywhere else would be a searchable, unscoped
   * duplicate of the entire corpus — and nothing would have said so.
   */
  constructor() {
    registerTenantStore('unified-search-index', () => this.hasScope());
  }

  /** Bind the tenant boundary. UNBOUND DENIES — see `scopeOrDeny`. */
  /** True once a boundary is bound. Evidence for the startup gate. */
  hasScope(): boolean {
    return this.scopeSource !== null;
  }

  bindScope(source: () => TenantScope | null): this {
    this.scopeSource = source;
    return this;
  }

  /**
   * The active scope, or null meaning DENY.
   *
   * Read from the BINDING, never from the query. `SearchBackendQuery`
   * deliberately has no scope field: five call sites hold this object directly
   * and pass it into `runEnterpriseSearch`, so a scope on the query would be a
   * scope those callers could choose — and the caller is the renderer's
   * request, one step removed. The store binds this from the same resolver
   * everything else uses.
   */
  private scopeOrDeny(): TenantScope | null {
    const source = this.scopeSource ?? ambientSearchScope;
    return source === null ? null : source();
  }

  /** This tenant's index, created on first write. */
  private indexFor(tenantId: string): TenantIndex {
    let idx = this.byTenant.get(tenantId);
    if (!idx) {
      idx = { docs: new Map(), postings: new Map() };
      this.byTenant.set(tenantId, idx);
    }
    return idx;
  }

  /**
   * Index entities into THEIR OWN tenant's partition.
   *
   * The tenant is read off each entity rather than from the active scope: this
   * is called from `load()`, which replays the whole file at boot, when the
   * entities being indexed may belong to a tenant nobody is currently signed
   * into. An entity with no owner is not indexed at all — it is unreadable
   * through `query` too, and an index entry for a record no query can return
   * would be a way to reach it.
   */
  index(entities: UnifiedEntity[]): void {
    for (const e of entities) {
      const tenantId = ownershipOf(e) === 'assigned' ? (e.tenantId as string) : null;
      if (tenantId === null) {
        this.removeEverywhere(e.id);
        continue;
      }
      const idx = this.indexFor(tenantId);
      // Deleted records are removed from the index.
      if (e.syncState === 'deleted') {
        this.removeOne(idx, e.id);
        continue;
      }
      this.removeOne(idx, e.id); // replace any prior version
      const text = searchableText(e);
      const terms = new Map<string, number>();
      for (const tok of tokenize(text)) terms.set(tok, (terms.get(tok) ?? 0) + 1);
      idx.docs.set(e.id, { id: e.id, kind: e.kind, connectorId: e.connectorId, title: e.title, text, terms });
      for (const term of terms.keys()) {
        let set = idx.postings.get(term);
        if (!set) {
          set = new Set();
          idx.postings.set(term, set);
        }
        set.add(e.id);
      }
    }
  }

  private removeOne(idx: TenantIndex, id: string): void {
    const doc = idx.docs.get(id);
    if (!doc) return;
    for (const term of doc.terms.keys()) {
      const set = idx.postings.get(term);
      if (set) {
        set.delete(id);
        if (set.size === 0) idx.postings.delete(term);
      }
    }
    idx.docs.delete(id);
  }

  /**
   * Drop an id from every partition.
   *
   * `remove(ids)` is called with ids alone — the entities are already gone by
   * then, so their tenant is no longer knowable. Sweeping all partitions is the
   * only correct answer, and it is safe because ids are tenant-qualified: an id
   * can exist in at most one partition, so this removes exactly one document.
   */
  private removeEverywhere(id: string): void {
    for (const idx of this.byTenant.values()) this.removeOne(idx, id);
  }

  remove(ids: string[]): void {
    for (const id of ids) this.removeEverywhere(id);
  }

  search(query: SearchBackendQuery): SearchHit[] {
    const scope = this.scopeOrDeny();
    if (scope === null) return [];
    const idx = this.byTenant.get(scope.tenantId);
    if (!idx) return [];
    const terms = tokenize(query.text);
    if (terms.length === 0) return [];
    // N is THIS TENANT's document count. See the class comment.
    const N = Math.max(1, idx.docs.size);
    const kindFilter = query.kinds && query.kinds.length > 0 ? new Set(query.kinds) : null;

    const scores = new Map<string, number>();
    for (const term of terms) {
      const set = idx.postings.get(term);
      if (!set) continue;
      const idf = Math.log(1 + N / set.size);
      for (const id of set) {
        const doc = idx.docs.get(id);
        if (!doc) continue;
        if (kindFilter && !kindFilter.has(doc.kind)) continue;
        if (query.connectorId && doc.connectorId !== query.connectorId) continue;
        const tf = doc.terms.get(term) ?? 0;
        // Title matches weigh more than body matches.
        const titleBoost = doc.title.toLowerCase().includes(term) ? 1.5 : 1;
        scores.set(id, (scores.get(id) ?? 0) + tf * idf * titleBoost);
      }
    }

    const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, query.limit ?? 25);
    return ranked.map(([id, score]) => {
      const doc = idx.docs.get(id)!;
      return {
        id,
        kind: doc.kind,
        connectorId: doc.connectorId,
        title: doc.title,
        snippet: makeSnippet(doc.text, terms),
        score: Math.round(score * 1000) / 1000,
      };
    });
  }

  clear(): void {
    this.byTenant.clear();
  }

  /** Index size FOR THIS CALLER — a global cardinality is a disclosure. */
  stats(): { documents: number; terms: number } {
    const scope = this.scopeOrDeny();
    if (scope === null) return { documents: 0, terms: 0 };
    const idx = this.byTenant.get(scope.tenantId);
    if (!idx) return { documents: 0, terms: 0 };
    return { documents: idx.docs.size, terms: idx.postings.size };
  }
}
