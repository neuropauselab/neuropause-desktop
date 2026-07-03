/**
 * Pluggable search over the UDM.
 *
 * `SearchBackend` is the seam: the Query/Search facade and the UI call it and
 * never know which engine answers. `LocalSearchBackend` is a real in-memory
 * inverted index (TF-IDF scoring) that works with zero external services. A
 * `MeilisearchBackend` (keyword) and `QdrantBackend` (vector) can implement the
 * same interface later without changing a single caller.
 */
import type { SearchHit, UnifiedEntity, UnifiedEntityKind } from '@neuropause/shared';

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

/** In-memory inverted index with TF-IDF scoring. */
export class LocalSearchBackend implements SearchBackend {
  readonly name = 'local';
  private docs = new Map<string, IndexedDoc>();
  /** term → set of doc ids containing it (postings). */
  private postings = new Map<string, Set<string>>();

  index(entities: UnifiedEntity[]): void {
    for (const e of entities) {
      // Deleted records are removed from the index.
      if (e.syncState === 'deleted') {
        this.removeOne(e.id);
        continue;
      }
      this.removeOne(e.id); // replace any prior version
      const text = searchableText(e);
      const terms = new Map<string, number>();
      for (const tok of tokenize(text)) terms.set(tok, (terms.get(tok) ?? 0) + 1);
      this.docs.set(e.id, { id: e.id, kind: e.kind, connectorId: e.connectorId, title: e.title, text, terms });
      for (const term of terms.keys()) {
        let set = this.postings.get(term);
        if (!set) {
          set = new Set();
          this.postings.set(term, set);
        }
        set.add(e.id);
      }
    }
  }

  private removeOne(id: string): void {
    const doc = this.docs.get(id);
    if (!doc) return;
    for (const term of doc.terms.keys()) {
      const set = this.postings.get(term);
      if (set) {
        set.delete(id);
        if (set.size === 0) this.postings.delete(term);
      }
    }
    this.docs.delete(id);
  }

  remove(ids: string[]): void {
    for (const id of ids) this.removeOne(id);
  }

  search(query: SearchBackendQuery): SearchHit[] {
    const terms = tokenize(query.text);
    if (terms.length === 0) return [];
    const N = Math.max(1, this.docs.size);
    const kindFilter = query.kinds && query.kinds.length > 0 ? new Set(query.kinds) : null;

    const scores = new Map<string, number>();
    for (const term of terms) {
      const set = this.postings.get(term);
      if (!set) continue;
      const idf = Math.log(1 + N / set.size);
      for (const id of set) {
        const doc = this.docs.get(id);
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
      const doc = this.docs.get(id)!;
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
    this.docs.clear();
    this.postings.clear();
  }

  stats(): { documents: number; terms: number } {
    return { documents: this.docs.size, terms: this.postings.size };
  }
}
