# NeuroPause — Query Engine & Local Search

The Query Engine is the **single API every module queries**. Whether a project
came from GitHub or Notion, a message from Slack, or an event from Google
Calendar, callers ask the same questions and get back canonical `UnifiedEntity`
records. **The caller never knows which connector owns the data.**

---

## 1. The finder API

`unifiedQuery` (main process) exposes one finder per major kind plus a generic
query. Each finder is a typed projection over the store with the kind fixed:

```ts
unifiedQuery.findProjects(opts?)        // kind = project
unifiedQuery.findTasks(opts?)           // kind = task
unifiedQuery.findDocuments(opts?)       // kind = document
unifiedQuery.findFiles(opts?)
unifiedQuery.findConversations(opts?)
unifiedQuery.findMessages(opts?)
unifiedQuery.findNotifications(opts?)
unifiedQuery.findCalendarEvents(opts?)  // kind = calendar_event
unifiedQuery.findEvents(opts?)
unifiedQuery.findActivities(opts?)
unifiedQuery.findContacts(opts?)
unifiedQuery.findLabels(opts?)
unifiedQuery.findWorkspaces(opts?)
unifiedQuery.findOrganizations(opts?)
unifiedQuery.findAccounts(opts?)
unifiedQuery.findAttachments(opts?)

unifiedQuery.query(fullQuery)           // any kinds / advanced filtering
```

These are the **in-process** API the upcoming phases (Activity Intelligence, AI
Memory, Automation, Daily Summary, Analytics) call directly. The renderer reaches
the same engine over IPC (`ipc.unified.query`, `.get`, `.counts`, `.search`).

Every finder returns a `UnifiedQueryResult`:

```ts
{ items: UnifiedEntity[]; total: number; nextCursor: string | null }
```

---

## 2. Query filters

`FindOptions` is the full `UnifiedQuery` minus `kinds` (the finder sets that). All
fields are optional and AND-combined:

| Filter           | Effect |
|------------------|--------|
| `connectorId`    | restrict to one connector (rarely needed — callers are connector-agnostic) |
| `accountId`      | restrict to one connected account |
| `containerId`    | records inside a scope (tasks in a project, messages in a channel) |
| `parentId`       | records under a direct parent |
| `status`         | exact lifecycle status match |
| `text`           | case-insensitive substring over `title` + `body` |
| `since` / `until`| `updatedAt` window (ISO) |
| `includeDeleted` | include soft-deleted records (default false) |
| `sortBy`         | `updatedAt` (default) · `createdAt` · `timestamp` · `title` |
| `order`          | `desc` (default) · `asc` |
| `limit`          | page size (default 50) |
| `cursor`         | opaque pagination cursor from a prior result |

For lifecycle examples: "tasks I still owe" →
`findTasks({ status: 'open', sortBy: 'timestamp' })`; "today's meetings" →
`findCalendarEvents({ since: startOfDay, until: endOfDay, order: 'asc' })`;
"recent activity" → `findActivities({ limit: 50 })`.

### Pagination

`cursor` is an opaque offset token. A result whose `nextCursor` is non-null can be
re-queried with `cursor: nextCursor` to get the next page; `null` means the result
set is exhausted.

---

## 3. Counts

`unifiedStore.counts()` (and `ipc.unified.counts()`) returns aggregate totals for
dashboards:

```ts
{ total, byKind: Record<kind, n>, byConnector: Record<connectorId, n>, lastUpdatedAt }
```

The store also emits a `changed` event after every write; the unified subsystem
broadcasts a fresh `counts` snapshot to the renderer so dashboards and search
update live.

---

## 4. Local Search

Search is a separate, **pluggable** path designed so the engine can be swapped
without touching callers.

### The seam

```ts
interface SearchBackend {
  name: string;                       // 'local' | 'meilisearch' | 'qdrant'
  index(entities: UnifiedEntity[]): void;
  remove(ids: string[]): void;
  search(query): SearchHit[];
  clear(): void;
  stats(): { documents: number; terms: number };
}
```

Callers use the `unifiedSearch.search(query)` facade and the `ipc.unified.search`
channel. Results are tagged with the `backend` that answered.

### Today: `LocalSearchBackend`

A real in-memory **inverted index** with **TF-IDF** scoring — no external service
required. It tokenizes `title + body + author + labels` (lowercased, stop-worded),
maintains term → document postings, and scores matches by term frequency × inverse
document frequency, with a boost for title hits. It returns ranked `SearchHit`s
with a contextual **snippet** around the match, and supports `kinds` / `connectorId`
filters. The store keeps the index in sync automatically: indexed on upsert,
removed on delete.

```ts
ipc.unified.search({ text: 'investor deck', kinds: ['document'] })
//   → { hits: [{ id, kind, connectorId, title, snippet, score }], total, backend: 'local' }
```

### Later: Meilisearch & Qdrant

Because every caller goes through `SearchBackend`, production engines slot in
behind the same interface with **no caller changes**:

- **Meilisearch** — keyword/typo-tolerant indexing for large corpora.
- **Qdrant** — vector/semantic search (embeddings) for "find things *like* this".

A future `MeilisearchBackend` / `QdrantBackend` implements `index`/`remove`/
`search`/`clear`/`stats`; the store points at it; `unifiedSearch` and the UI keep
calling the same methods. Standing up those services is infrastructure work
outside the app code, which is why the local backend ships first and the seam is
explicit.

---

## 5. Verification

`unifiedStore.test.ts` exercises the store and search directly (no Electron):
insert + conflict resolution (a stale re-sync never clobbers fresher local state),
kind/text filtering, soft-delete visibility, cursor pagination, count aggregation,
persistence across reloads, and search ranking/snippets/kind-filtering/removal.
