# Enterprise Search

> Phase 5 · Module 4 — one federated search across everything.
> Status: **implemented** (entities + graph + memory + timeline).

Enterprise Search is the single query box over the whole intelligence layer. One
text query fans out to every retrieval surface, each result is mapped into a
common shape, scores are made comparable, and the whole thing comes back as one
ranked list plus a per-source breakdown.

It does not introduce a new index. It **federates** the indexes that already
exist — so it stays honest about where every hit came from and how confident
each source is.

---

## 1. Sources

| source | backs onto | retriever |
| --- | --- | --- |
| `entity` | Unified Data Model search backend | TF-IDF (`local`) |
| `graph` | Knowledge Graph node labels | substring match |
| `memory` | AI Memory recall | TF-IDF (`lexical`), Qdrant-ready |
| `timeline` | Enterprise Timeline | match-tier on title/summary |

A query may restrict itself with a `sources` filter; absent that, all available
sources are queried. The timeline source is optional at the wiring level — it
joins automatically once the Enterprise Timeline façade is initialized, with no
signature change to callers.

---

## 2. The result shape

Every hit, regardless of origin, is an `EnterpriseSearchHit`:

```ts
{
  source: 'entity' | 'graph' | 'memory' | 'timeline',
  id, kind, title,
  snippet: string | null,
  score: number,            // 0..1, normalized within its source
  connectorId, timestamp, url
}
```

The response carries both views:

```ts
{
  query,
  hits:    EnterpriseSearchHit[],     // merged + ranked across sources
  groups:  EnterpriseSearchGroup[],   // per-source, with totals
  total,
  backends: string[]                  // which retrievers answered
}
```

`groups` lets the UI show "3 documents, 2 graph nodes, 1 decision"; `hits` is the
flat, ranked stream for a unified results list.

---

## 3. Scoring & ranking (and its honest caveat)

Each source scores on its **own scale** — TF-IDF magnitudes, graph match tiers,
and memory relevance are not natively comparable. So before merging, each
source's hits are **normalized within that source** to `0..1` (top hit = `1.0`).
The merged list is then sorted by that normalized score.

Graph nodes (which have no intrinsic relevance score) are tiered by match
quality: exact label `1.0`, prefix `0.8`, substring `0.6`, otherwise `0.4`.

**This is a heuristic, and the code says so.** Per-source normalization makes
results *presentable together*, but it is not a principled cross-source ranking —
a `1.0` memory and a `1.0` entity are "best in their source," not "equally
relevant in absolute terms." True hybrid ranking (lexical + semantic, with
comparable scores) arrives when the vector backend lands behind the memory and
entity retrievers' shared seam. The federation layer above won't change.

---

## 4. Design: pure core, injected sources

`runEnterpriseSearch(query, sources)` is **pure** — the three retrieval surfaces
are passed in, not imported. That keeps it unit-testable against real
electron-free stores (the test stands up a `UnifiedStore`, `GraphStore`, and
`MemoryStore` on temp files and asserts federation + normalization + the
`sources` filter). The runtime composition root (`search/index.ts`) injects the
live singletons:

```ts
runEnterpriseSearch(req, {
  entity: unifiedStore.searchBackend,
  graph:  graphStore,
  memory: memoryStore,
});
```

There is no persistent state and no load step — Enterprise Search is a stateless
read over surfaces that maintain their own indexes.

---

## 5. IPC surface

| channel | request | returns |
| --- | --- | --- |
| `search:enterprise` | `{ text, sources?, limit? }` | `EnterpriseSearchResult` |

`limit` is a **per-source** cap (default 10), so the merged list contains up to
`limit × (number of sources)` hits before ranking.

---

## 6. Boundaries

- **Lexical today.** Two of three sources rank by word overlap (§3); semantic
  recall is a backend swap away, not a rewrite.
- **No connectors.** Like everything in this layer, search reads only the UDM,
  graph, and memory — never a connector directly.
- **Federated, not unified-index.** Each source keeps its own index; this is a
  fan-out/merge, which is why provenance (`source`, `connectorId`) is always
  present on every hit.

---

*See also: [AI Memory](./ai-memory.md) (Module 3) and
[Knowledge Graph](./knowledge-graph.md) (Module 1).*
