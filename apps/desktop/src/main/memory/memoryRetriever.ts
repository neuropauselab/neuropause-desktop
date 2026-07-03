/**
 * The memory retriever — the swappable semantic-retrieval seam for AI Memory.
 *
 * Today: a lexical TF-IDF inverted index over memory titles, content, and tags,
 * with a title boost (the same scoring shape the unified Local Search backend
 * uses). Tomorrow: a vector backend (Qdrant) implementing the same interface,
 * with no change to the memory store or callers. Scores are returned normalized
 * to 0..1 within a result set so the UI and Enterprise Search can compare them.
 */
import type { MemoryItem } from '@neuropause/shared';

export interface MemoryScore {
  id: string;
  score: number;
}

export interface MemoryRetriever {
  /** Identifier surfaced in results ('lexical' now; 'qdrant' later). */
  readonly name: string;
  /** Index (or re-index) the full set of items; existing ids are replaced. */
  index(items: MemoryItem[]): void;
  /** Rank items by relevance to free text; returns normalized 0..1 scores. */
  search(text: string, limit: number): MemoryScore[];
  clear(): void;
  stats(): { documents: number; terms: number };
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'for', 'on', 'with', 'is',
  'are', 'was', 'were', 'be', 'by', 'at', 'as', 'it', 'this', 'that', 'from',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

interface Doc {
  id: string;
  title: string; // lowercased, for the title boost
  terms: Map<string, number>;
}

export class LexicalMemoryRetriever implements MemoryRetriever {
  readonly name = 'lexical';
  private docs = new Map<string, Doc>();
  private postings = new Map<string, Set<string>>();

  index(items: MemoryItem[]): void {
    this.clear();
    for (const item of items) {
      const text = `${item.title} ${item.content} ${item.tags.join(' ')}`;
      const terms = new Map<string, number>();
      for (const tok of tokenize(text)) terms.set(tok, (terms.get(tok) ?? 0) + 1);
      this.docs.set(item.id, { id: item.id, title: item.title.toLowerCase(), terms });
      for (const term of terms.keys()) {
        let set = this.postings.get(term);
        if (!set) this.postings.set(term, (set = new Set()));
        set.add(item.id);
      }
    }
  }

  search(text: string, limit: number): MemoryScore[] {
    const terms = tokenize(text);
    if (terms.length === 0) return [];
    const N = Math.max(1, this.docs.size);

    const scores = new Map<string, number>();
    for (const term of terms) {
      const set = this.postings.get(term);
      if (!set) continue;
      const idf = Math.log(1 + N / set.size);
      for (const id of set) {
        const doc = this.docs.get(id);
        if (!doc) continue;
        const tf = doc.terms.get(term) ?? 0;
        const titleBoost = doc.title.includes(term) ? 1.5 : 1;
        scores.set(id, (scores.get(id) ?? 0) + tf * idf * titleBoost);
      }
    }

    const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
    const max = ranked[0]?.[1] ?? 0;
    return ranked.map(([id, raw]) => ({
      id,
      score: max > 0 ? Math.round((raw / max) * 1000) / 1000 : 0,
    }));
  }

  clear(): void {
    this.docs.clear();
    this.postings.clear();
  }

  stats(): { documents: number; terms: number } {
    return { documents: this.docs.size, terms: this.postings.size };
  }
}
