# Performance Benchmarks

> Phase 5. Measured timings for the deterministic intelligence engines at scale.

## Methodology

The benchmark builds a **synthetic workspace of 5,000 UDM entities** (a realistic
mix of projects, tasks linked to projects, documents, messages, and calendar
events, each with a title and body for search), then measures each engine's hot
path once and prints a table. It lives at
`apps/desktop/src/main/__bench__/performance.test.ts` and runs as part of the
normal suite, so you can reproduce it:

```bash
npm test -w @neuropause/desktop
```

The figures below were captured in the build container (Linux x64, Node 20, via
vitest/esbuild). **They are single-run measurements on one machine** — treat them
as an order-of-magnitude guide, not a benchmark-suite average. Your numbers on
macOS will differ, and run-to-run variance of a few milliseconds is normal. The
assertions in the test are deliberately generous regression guards (each path
must stay under 2,000 ms), not the headline.

## Results — 5,000 entities

| Engine | Operation | Time |
| --- | --- | ---: |
| Knowledge Graph | `graph.project` (entities → nodes + edges) | ~33 ms |
| AI Memory | `memory.project` (entities → memory items) | ~6 ms |
| AI Memory | `memory.index` (build lexical index) | ~60 ms |
| AI Memory | `memory.recall` (ranked query) | ~31 ms |
| Enterprise Search | `search.index` (build TF-IDF index) | ~28 ms |
| Enterprise Search | `search.query` (ranked query) | ~10 ms |
| Enterprise Timeline | `timeline.query` (merge + page) | ~13 ms |
| Daily Intelligence | `briefing.generate` (weekly) | ~16 ms |
| Recommendations | `recommendations.generate` | ~19 ms |

## Reading the numbers

- **Everything is well under a frame budget** at 5,000 entities. The whole
  pipeline — project the graph, build the memory and search indexes, merge the
  timeline, then generate a briefing and recommendations — completes in roughly
  220 ms end to end, and the *query* paths (search, recall, briefing,
  recommendations) are all in the 10–30 ms range.
- The **index-build** steps (`memory.index`, `search.index`) dominate because
  they tokenize every record. They run once when data changes, not per query, and
  are the natural place to swap in the semantic-retrieval seam (Qdrant) if/when
  the corpus grows beyond what a lexical in-memory index serves comfortably.
- These are **deterministic, CPU-only** operations with no network and no model
  inference, which is exactly why they are this fast and this predictable.

## Scaling notes

The current engines hold the full working set in memory and rebuild indexes on
change — appropriate for a single user's connected accounts. The seams that would
carry this to a much larger corpus are already in place and documented: the
`MemoryRetriever` interface (lexical now, embedding-ready) and the
`SearchBackend` interface behind Enterprise Search. Neither swap changes the
public contracts of the briefing, recommendation, Founder-AI, or trace engines.
