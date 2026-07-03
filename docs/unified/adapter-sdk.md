# NeuroPause — Adapter SDK

An adapter is the **only** thing a new connector needs. It is a provider-specific
mapping layer; everything else — paging, cursors, conflict resolution, retries,
rate limiting, offline handling, events — is the engine's job. Write the mapping,
register it, done.

---

## 1. The shape

```ts
interface ConnectorAdapter {
  connectorId: ConnectorId;
  baseHeaders?: Record<string, string>;   // e.g. { 'Notion-Version': '2022-06-28' }
  resources: AdapterResource[];
}

interface AdapterResource {
  id: string;                 // stable; used as the cursor key (e.g. 'repos')
  label: string;
  kind: UnifiedEntityKind;    // the primary kind this resource produces
  pull(ctx: SyncContext): Promise<SyncPage>;
}
```

A resource pulls **one page** at a time. The orchestrator calls `pull` repeatedly
until `hasMore` is false.

```ts
interface SyncContext {
  connectorId; accountId;
  http: HttpClient;           // token attached + rate-gated for you
  cursor: string | null;      // your cursor from the previous call (null on first sync)
  now: string;                // run timestamp → becomes syncedAt
}

interface SyncPage {
  entities: UnifiedEntity[];
  deletedSourceIds?: string[]; // provider ids deleted at source → soft-deleted
  cursor: string | null;       // persisted; what you get back next call
  hasMore: boolean;            // more pages right now?
}
```

## 2. `makeEntity`

Adapters never hand-build the envelope. `makeEntity({...})` fills the Unified
Identifier (deterministically from `connectorId + accountId + kind + sourceId`),
`syncState`, `syncedAt`, and the nullable defaults — you supply the fields that
matter:

```ts
makeEntity({
  connectorId: ctx.connectorId, accountId: ctx.accountId, now: ctx.now,
  kind: 'task', sourceId: String(issue.id),
  title: issue.title, url: issue.html_url,
  createdAt: issue.created_at, updatedAt: issue.updated_at,
  status: issue.state, body: truncate(issue.body, 500),
  labels: issue.labels.map((l) => l.name),
  metadata: { number: issue.number, isPullRequest: issue.pull_request != null },
});
```

Relationships (`parentId`, `containerId`) are themselves Unified Identifiers —
build them with `makeUnifiedId(connectorId, accountId, kind, sourceId)` so records
link up across resources (a Slack message → its channel, a Notion page → its
database).

## 3. The cursor is yours

The cursor is **opaque to the engine** — a string the adapter encodes and decodes
however it likes (the built-ins use JSON). It does double duty: pagination within
a run *and* the incremental baseline between runs. The rule that makes this work:

> The cursor returned on the **final page** (`hasMore: false`) is the baseline
> handed back on the next run.

So a resource:

- with no incremental API → paginates with a token and returns `null` on the final
  page → next run does a full re-sync (the store dedups). *(GitHub repos.)*
- with an incremental API → returns the incremental token (a high-water timestamp
  or a provider sync token) on the final page → next run resumes incrementally.
  *(GitHub issues `since`, Notion `last_edited_time`, Google `syncToken`.)*

Intermediate pages return a pagination cursor; if a sync is interrupted, the next
run resumes from it.

## 4. The HTTP client & errors

Use `ctx.http.getJson` / `postJson`. The client attaches the bearer token, applies
the rate gate, and throws the typed errors the engine acts on (`AuthError`,
`RateLimitError`, `NetworkError`, `HttpError`). Adapters mostly ignore these and
let them propagate; the Google adapter catches `HttpError` 410 to reset an expired
sync token, and the Slack adapter translates Slack's `{ ok: false, error }`
responses into `AuthError` / `Error`.

## 5. The four built-in adapters

| Connector       | Resource → kind                                   | Incremental strategy                          |
|-----------------|---------------------------------------------------|-----------------------------------------------|
| **GitHub**      | repos → `project`                                 | full list + store dedup                       |
|                 | issues + PRs → `task`                             | `?since=` high-water (sorted ascending)       |
|                 | notifications → `notification`                    | `?since=` high-water                          |
| **Notion**      | pages → `document`                                | `last_edited_time` cutoff (search, descending)|
|                 | databases → `project`                             | `last_edited_time` cutoff                     |
| **Google Cal.** | events → `calendar_event`                         | `syncToken` (changes + cancellations); 410 → full resync |
| **Slack**       | channels → `conversation`                         | full list (channels change rarely)            |
|                 | history → `message`                               | per-channel high-water `ts` (composite cursor)|

Together they exercise projects, tasks, documents, conversations, messages,
notifications, and calendar events — the spread that proves the model.

**Bounded by design:** the Slack messages resource caps at 20 channels and one
history page per channel per run (recent activity, not unbounded backfill); GitHub
repos full-resync each run rather than diffing. These are deliberate v1 limits, not
gaps in the engine — each is a one-line change in the adapter.

## 6. Adding a connector

1. Write `adapters/<provider>.ts`: define the provider response types, write pure
   `mapX(ctx, raw): UnifiedEntity` mappers, and a `pull` per resource.
2. Export a `ConnectorAdapter` and register it in `adapters/index.ts`.
3. Add mapper tests (sample payload → asserted entity).

No change to the store, query engine, search, scheduler, or event bus. That is the
point of the layer: **the model absorbs the provider; the provider never leaks
upward.**

## 7. Verification

`adapters/adapters.test.ts` asserts every built-in mapper against sample provider
payloads — ids, kinds, titles, status, labels, metadata, and the Unified
Identifier links — and the orchestrator test drives a fake adapter through the full
paging / cursor / delete / offline lifecycle.

> Until a connector is connected with provider credentials (its OAuth env vars
> set), its adapter is registered but pulls nothing. Connect GitHub and the next
> sync begins mapping repos, issues, and notifications into the UDM with no further
> changes.
