# AI Memory

> Phase 5 · Module 3 — persistent organizational memory.
> Status: **implemented** (lexical retrieval real; semantic seam swappable).

AI Memory is the system's durable, searchable recollection of what the
organization knows and has done. It answers "what do we remember about X?" — and
it never makes anything up. A memory is either a faithful, traceable distillation
of a real record in the Unified Data Model (UDM), or something a person explicitly
chose to remember. Those two origins are tracked separately and never blurred.

This document covers the data model, where memories come from, how recall works,
the retrieval seam, the IPC surface, and the honest boundaries.

---

## 1. What a memory is

A `MemoryItem` is a compact, self-describing record:

| field | meaning |
| --- | --- |
| `id` | `mem:<entityId>` for projected, `mem:explicit:<uuid>` for explicit |
| `kind` | `decision · conversation · document · task · meeting · context · relationship · note` |
| `origin` | `projected` (from the UDM) or `explicit` (authored in-app) |
| `title` / `content` | the searchable text (content is a distilled summary, not a copy) |
| `connectorId` / `source` | provenance — a connector id, or `manual` for explicit |
| `entityRefs[]` | UDM entity / graph node ids this memory concerns |
| `tags[]` | labels carried from the source (or supplied explicitly) |
| `occurredAt` | when the underlying thing happened (for time filtering) |
| `createdAt` / `updatedAt` | when it was remembered |
| `evidence` | `{ kind, id }` back-pointer to the UDM record (projected only) |
| `metadata` | small typed bag (kind, status, url, …) |

A projected memory is a **pointer with a summary**, not a second copy of your
data. The full record still lives in the UDM; the memory exists so retrieval is
fast, cross-referenced, and time-aware.

---

## 2. Two origins, kept apart

**Projected** memories are derived deterministically from the UDM by the memory
projector (`memoryProjector.ts`). On every UDM change the projector re-runs and
the store **replaces the whole projected set** (`applyProjected`), so memory
tracks reality exactly — nothing stale lingers, and first-seen timestamps are
preserved across rebuilds.

**Explicit** memories are authored in the app via `remember()` — a decision, a
note, a piece of captured context that has no connector source. A rebuild
**never touches** explicit memories. They persist until explicitly forgotten.

This separation is the core honesty guarantee: the system can distinguish "this
is what your connected tools say" from "this is what a human decided," and it
will never overwrite the latter while syncing the former.

---

## 3. Projection rules

Only **memory-worthy** UDM kinds are projected. Granular, high-volume, or
identity-only signals are intentionally left out so memory stays meaningful:

| UDM kind | → memory kind | note |
| --- | --- | --- |
| `document` | `document` | |
| `task` | `task` | |
| `conversation` | `conversation` | a channel/thread, not each message |
| `calendar_event` (with attendees) | `meeting` | solo focus-blocks are skipped |
| `event` | `meeting` | |
| `project` | `context` | a project is organizational context |
| `message`, `notification`, `contact`, `file`, … | — | not memorialized here |

For each projected item the projector records:

- **content** = title + a trimmed body excerpt (≤ 280 chars) + status + labels,
- **entityRefs** = the entity id, its container, and its author as a stable
  `person:<connector>:<handle>` id (so memories link to people and projects),
- **evidence** = `{ kind, id }` pointing back at the exact UDM record.

The projector is pure (no I/O) and unit-tested from synthetic entities.

---

## 4. Recall

`recall(query)` is the read path. It filters first, then ranks:

**Filters** — `kinds`, `entityRef` (memories about a given entity or person),
`tag`, and a `since`/`until` time window (over `occurredAt`, falling back to
`createdAt`).

**Ranking** —
- with **free text**: the retriever scores the filtered pool by relevance and
  returns normalized `0..1` scores (best match = `1.0`);
- with **no text** (pure browse): results are ordered most-recent-first with a
  flat score of `1`.

Every result is a `MemoryHit { item, score }`, and the result is tagged with the
retriever that answered (`lexical` today).

---

## 5. The retrieval seam (lexical now, semantic later)

Retrieval sits behind a single interface, `MemoryRetriever`:

```ts
interface MemoryRetriever {
  readonly name: string;             // 'lexical' | 'qdrant'
  index(items: MemoryItem[]): void;
  search(text: string, limit: number): { id: string; score: number }[];
  clear(): void;
  stats(): { documents: number; terms: number };
}
```

Today's implementation, `LexicalMemoryRetriever`, is a real TF-IDF inverted
index over title + content + tags, with a title boost — the same scoring shape
the unified Local Search backend uses. Scores are normalized to `0..1` within a
result set so the UI and Enterprise Search can compare them.

**This is honest about its limits.** Lexical retrieval matches words, not
meaning: a search for "datastore" won't surface a memory that only says
"database" unless the words overlap. The seam exists precisely so a vector
backend (e.g. Qdrant) can replace it — same interface, same callers, semantic
recall — when embeddings are wired. Nothing above the seam changes.

---

## 6. Persistence

The store writes `memory.json` under Electron's `userData` using the project's
standard **serialized atomic writer**: writes are coalesced and serialized
(no two persists race the same temp file), each write is `tmp → rename`, and the
index is rebuilt from disk on load. The `MemoryStore` class is electron-free
(file path + retriever are injected), so it unit-tests on a temp file with a real
retriever; the `userData` singleton lives in `memoryInstance.ts`.

---

## 7. IPC surface

All channels go through the secure, schema-validated bridge:

| channel | request | returns |
| --- | --- | --- |
| `memory:recall` | text? / kinds? / entityRef? / tag? / since? / until? / limit? | `MemoryRecallResult` |
| `memory:get` | `{ id }` | `MemoryItem \| null` |
| `memory:remember` | kind / title / content / refs? / tags? / occurredAt? / metadata? | `MemoryItem` |
| `memory:forget` | `{ ids }` | `{ forgotten: n }` |
| `memory:counts` | — | `MemoryCounts` |
| `memory:rebuild` | — | `MemoryCounts` (re-projects now) |
| `memory:event` (broadcast) | — | `MemoryCounts` on every change |

---

## 8. Boundaries (what this is *not*, yet)

- **Empty until you sync.** With no connected accounts there are no projected
  memories — only whatever has been explicitly remembered. This is by design:
  memory reflects real data, never placeholder content.
- **Lexical, not semantic.** See §5. Meaning-based recall awaits the vector
  backend behind the existing seam.
- **`relationship` memories are not auto-projected.** Relationships live in the
  Knowledge Graph (Module 1); the `relationship` kind is reserved for explicit
  captures and future graph-derived synthesis.
- **No summarization model.** Projected `content` is a deterministic excerpt, not
  an LLM-written abstract. A future generation step could enrich summaries, but
  it would do so *grounded by* this layer — it would never invent facts.
- **Per-connector identity.** Author refs are `person:<connector>:<handle>`;
  the same human across two connectors is not yet merged into one identity.

---

*Next (Module 4): [Enterprise Search](./enterprise-search.md) federates this
memory together with UDM entities and the Knowledge Graph into one ranked query.*
