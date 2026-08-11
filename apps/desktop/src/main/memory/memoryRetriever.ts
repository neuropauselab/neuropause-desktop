/**
 * The memory retriever — the swappable semantic-retrieval seam for AI Memory.
 *
 * Today: a lexical TF-IDF inverted index over memory titles, content, and tags,
 * with a title boost (the same scoring shape the unified Local Search backend
 * uses). Tomorrow: a vector backend (Qdrant) implementing the same interface,
 * with no change to the memory store or callers. Scores are returned normalized
 * to 0..1 within a result set so the UI and Enterprise Search can compare them.
 */
import type { MemoryItem, MemoryOwner, MemoryViewer } from '@neuropause/shared';
import { memoryOwnerIsWellFormed } from '@neuropause/shared';

export interface MemoryScore {
  id: string;
  score: number;
}

/**
 * Who is asking, resolved from the tenant chain — never from a caller.
 *
 * Structurally identical to `MemoryStore`'s own `MemoryViewerSource`, and
 * declared here rather than imported from there so the retriever does not
 * import the store it is injected into. The store binds this to its OWN
 * `viewerOrDeny` in its constructor, so the retriever and every read on the
 * store resolve the viewer through exactly one seam — including the ambient
 * test fallback, which it therefore inherits for free.
 */
export type MemoryRetrieverViewerSource = () => MemoryViewer | null;

export interface MemoryRetriever {
  /** Identifier surfaced in results ('lexical' now; 'qdrant' later). */
  readonly name: string;
  /**
   * Bind the tenant boundary. UNBOUND DENIES.
   *
   * REQUIRED on the interface, not optional. A retrieval backend that cannot be
   * told who is asking cannot be safely indexed over more than one tenant's
   * memories, and this store holds every tenant's in one file. Making it
   * optional would let a future backend be dropped in that silently ranks
   * across the whole install — which is exactly the defect this interface
   * change exists to close.
   */
  bindViewer(source: MemoryRetrieverViewerSource): void;
  /** Index (or re-index) the full set of items; existing ids are replaced. */
  index(items: MemoryItem[]): void;
  /** Rank the CALLER'S OWN readable memories by relevance; normalized 0..1. */
  search(text: string, limit: number): MemoryScore[];
  clear(): void;
  /** Index size FOR THIS CALLER — a global cardinality is a disclosure. */
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

/** One audience's private corpus: its documents and its own postings. */
interface Partition {
  docs: Map<string, Doc>;
  /** term → set of doc ids containing it, WITHIN this partition. */
  postings: Map<string, Set<string>>;
}

/**
 * The partition an owner's memories live in, or `null` for "index nowhere".
 *
 * THE KEY IS THE VISIBILITY KEY — exactly what `memoryVisibleTo` matches on,
 * field for field. That equality is the whole correctness argument: the index
 * and the read filter must be two views of ONE boundary, because any place they
 * disagree is a place a candidate is retrieved that cannot be returned (or a
 * score is computed from a document that cannot be read).
 *
 * Four buckets, mirroring the four visibilities:
 *   system     → one install-wide bucket, readable by every resolved viewer
 *   tenant     → per organization
 *   workspace  → per organization + workspace
 *   personal   → per organization + workspace + identity
 *
 * A malformed or absent owner returns `null` and is NOT INDEXED AT ALL — the
 * same call `LocalSearchBackend.index` makes, for the same reason: such a
 * memory is unreadable through every path on the store, so an index entry for
 * it would be a way to reach one.
 *
 * A NUL separates the segments. The ids here are organization ids, workspace
 * ids and account emails, none of which can contain one, so two different
 * (tenant, workspace) pairs can never produce the same key — which an ordinary
 * delimiter such as `/` or `:` would allow.
 */
const SEP = '\u0000';
const SYSTEM_PARTITION = 'sys';

function partitionKeyOf(owner: MemoryOwner | null | undefined): string | null {
  if (!memoryOwnerIsWellFormed(owner)) return null;
  switch (owner.visibility) {
    case 'system':
      return SYSTEM_PARTITION;
    case 'tenant':
      return `t${SEP}${owner.tenantId}`;
    case 'workspace':
      return `w${SEP}${owner.tenantId}${SEP}${owner.workspaceId}`;
    case 'personal':
      return `p${SEP}${owner.tenantId}${SEP}${owner.workspaceId}${SEP}${owner.userId}`;
    default:
      // An unknown visibility indexes nowhere. Fails closed, like the predicate.
      return null;
  }
}

/**
 * The partitions a viewer may read, widest to narrowest.
 *
 * The inverse of `partitionKeyOf`, and the pair has to be checked together: a
 * key generated on the index side with no reader here is a memory nobody can
 * find, and a key read here with no writer there is dead weight. A viewer with
 * no identity (`userId === null` — a service principal) gets NO personal key,
 * which matches `memoryVisibleTo` refusing personal memory to such a viewer;
 * `memoryOwnerIsWellFormed` guarantees a personal owner's userId is a non-empty
 * string, so there is no key a null identity could collide with anyway.
 */
function readableKeys(viewer: MemoryViewer): string[] {
  const keys = [
    SYSTEM_PARTITION,
    `t${SEP}${viewer.tenantId}`,
    `w${SEP}${viewer.tenantId}${SEP}${viewer.workspaceId}`,
  ];
  if (typeof viewer.userId === 'string' && viewer.userId !== '') {
    keys.push(`p${SEP}${viewer.tenantId}${SEP}${viewer.workspaceId}${SEP}${viewer.userId}`);
  }
  return keys;
}

/**
 * Lexical TF-IDF retrieval over AI Memory.
 *
 * P13C ROUND 10 (NEW-H4) — PARTITIONED PER AUDIENCE, NOT FILTERED PER QUERY.
 *
 * `MemoryStore.reindex()` hands this class EVERY tenant's memories, because one
 * `memory.json` holds them all and an index rebuild cannot know who will ask
 * next. Until this change there was one corpus, `search` returned the GLOBAL
 * top-N, and the store filtered the survivors to the viewer afterwards. Two
 * distinct defects lived in that gap, and only the second is the famous one.
 *
 * 1. CANDIDATE STARVATION, AND A DIVERGENCE BETWEEN TWO READS OF THE SAME DATA.
 *    `slice(0, limit)` ran before the ownership filter, so another tenant's
 *    documents occupied the candidate slots. Proven: tenant A recalls its own
 *    memory and gets 1 hit; tenant B then writes 200 notes containing the same
 *    term; A's recall for its own memory drops to 0 while `counts()` and
 *    `allItems()` — which never touch the index — still report it. One tenant
 *    could make another unable to find their own data, and the product gave two
 *    contradictory answers about whether that data existed.
 *
 * 2. A NUMERIC ORACLE THAT NEVER RETURNS A RECORD. `N` was the global document
 *    count, `idf = log(1 + N / postings.size)` used the global posting list, and
 *    `max = ranked[0]` normalised against a top score that could belong to
 *    another tenant's document. The result is returned to the renderer as
 *    `MemoryHit.ranking.lexicalScore`. Proven: A's score FOR ITS OWN MEMORY
 *    moved 1 → 0.453 → 0.229 as B's private corpus grew. That binary-searches
 *    another tenant's vocabulary and document counts one term at a time.
 *
 * FILTERING AFTER RANKING CANNOT FIX EITHER. The starvation happens before the
 * filter runs; the score was computed before the filter runs. The boundary has
 * to be drawn by the DATA STRUCTURE, which is what `LocalSearchBackend` already
 * concluded for the unified index — see its class comment, which describes this
 * same attack. This class now follows it: `N` is the caller's own document
 * count, postings are the caller's own, `stats()` reports the caller's own
 * cardinality, and a term appearing only in another tenant's corpus has no
 * posting list the caller can reach. Nothing global is consulted, so there is
 * nothing global to leak.
 *
 * WHERE IT GOES FURTHER THAN `LocalSearchBackend`, AND WHY. That backend keys
 * `byTenant` on `tenantId` alone, because `recordInScope` is the whole question
 * for a unified record. Memory has four visibilities, including PERSONAL — one
 * human's private notes inside a workspace their colleagues also use. Keying on
 * the tenant alone would leave the same oracle intact between colleagues, so the
 * key here is the full visibility key and a query reads the UNION of the
 * partitions the viewer may read. The union is taken for `N`, for every posting
 * list and for the normaliser, so the scored corpus is exactly the set of
 * documents `memoryVisibleTo` would admit — no more, and no fewer.
 *
 * The cost is one Map lookup per readable partition per term, and some
 * duplicated term keys across partitions. Same trade `LocalSearchBackend` takes,
 * and the same shape a real engine would use: an index per audience, not a
 * shared index with a filter.
 */
export class LexicalMemoryRetriever implements MemoryRetriever {
  readonly name = 'lexical';
  /** partition key → that audience's private index. */
  private parts = new Map<string, Partition>();
  private viewerSource: MemoryRetrieverViewerSource | null = null;

  /** Bind the tenant boundary. UNBOUND DENIES — see `viewerOrDeny`. */
  bindViewer(source: MemoryRetrieverViewerSource): void {
    this.viewerSource = source;
  }

  /**
   * The active viewer, or null meaning DENY.
   *
   * Read from the BINDING, never from the query. `search(text, limit)`
   * deliberately has no viewer parameter: it is called from `lexicalPool`,
   * which is reached by four retrieval paths, and a viewer on the signature
   * would be a viewer each of those paths could choose. The store binds this
   * from the same resolver every read on it uses.
   */
  private viewerOrDeny(): MemoryViewer | null {
    return this.viewerSource === null ? null : this.viewerSource();
  }

  /**
   * Index each memory into ITS OWN audience's partition.
   *
   * The partition is read off each item's stamped owner rather than from the
   * active viewer, for the same reason `LocalSearchBackend.index` does: this is
   * called from `load()`, which replays the whole file at boot, when the items
   * being indexed may belong to a tenant nobody is currently signed into.
   */
  index(items: MemoryItem[]): void {
    this.clear();
    for (const item of items) {
      const key = partitionKeyOf(item.owner);
      if (key === null) continue; // unowned ⇒ readable by nobody ⇒ indexed nowhere
      let part = this.parts.get(key);
      if (!part) {
        part = { docs: new Map(), postings: new Map() };
        this.parts.set(key, part);
      }
      const text = `${item.title} ${item.content} ${item.tags.join(' ')}`;
      const terms = new Map<string, number>();
      for (const tok of tokenize(text)) terms.set(tok, (terms.get(tok) ?? 0) + 1);
      part.docs.set(item.id, { id: item.id, title: item.title.toLowerCase(), terms });
      for (const term of terms.keys()) {
        let set = part.postings.get(term);
        if (!set) part.postings.set(term, (set = new Set()));
        set.add(item.id);
      }
    }
  }

  /** The partitions this viewer may read. Empty when no viewer resolves. */
  private readable(): Partition[] {
    const viewer = this.viewerOrDeny();
    if (viewer === null) return [];
    const out: Partition[] = [];
    for (const key of readableKeys(viewer)) {
      const part = this.parts.get(key);
      if (part) out.push(part);
    }
    return out;
  }

  search(text: string, limit: number): MemoryScore[] {
    const parts = this.readable();
    if (parts.length === 0) return [];
    const terms = tokenize(text);
    if (terms.length === 0) return [];

    // N is the size of THIS VIEWER'S readable corpus. See the class comment.
    let documents = 0;
    for (const part of parts) documents += part.docs.size;
    const N = Math.max(1, documents);

    const scores = new Map<string, number>();
    for (const term of terms) {
      // The document frequency is the union across the readable partitions —
      // never the install-wide posting list.
      let df = 0;
      for (const part of parts) df += part.postings.get(term)?.size ?? 0;
      if (df === 0) continue;
      const idf = Math.log(1 + N / df);
      for (const part of parts) {
        const set = part.postings.get(term);
        if (!set) continue;
        for (const id of set) {
          const doc = part.docs.get(id);
          if (!doc) continue;
          const tf = doc.terms.get(term) ?? 0;
          const titleBoost = doc.title.includes(term) ? 1.5 : 1;
          scores.set(id, (scores.get(id) ?? 0) + tf * idf * titleBoost);
        }
      }
    }

    const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
    // The normaliser is the caller's own top score. It could not be another
    // tenant's before either — but only by accident of which document sorted
    // first, which is not a boundary.
    const max = ranked[0]?.[1] ?? 0;
    return ranked.map(([id, raw]) => ({
      id,
      score: max > 0 ? Math.round((raw / max) * 1000) / 1000 : 0,
    }));
  }

  clear(): void {
    this.parts.clear();
  }

  stats(): { documents: number; terms: number } {
    const parts = this.readable();
    let documents = 0;
    const terms = new Set<string>();
    for (const part of parts) {
      documents += part.docs.size;
      for (const term of part.postings.keys()) terms.add(term);
    }
    return { documents, terms: terms.size };
  }
}
