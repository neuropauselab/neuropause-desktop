# NeuroPause Platform Core — Timeline Schema

> Status: **Part B‑2·II·A** — implemented and shipped.

The Timeline Service is the authoritative, append‑only store for Platform
Events. It captures and exposes events; it performs **no** AI summarization. It
is the substrate that Activity Intelligence, Summaries, Reminders, Automation,
and AI Memory will read from later (Phases 5–6).

## Record schema

Each recorded entry is a full `PlatformEvent` (see `event-architecture.md`),
serialized verbatim. Every field the spec calls for is present:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `string` | Unique event id. |
| `timestamp` | ISO‑8601 `string` | Used for time‑bound queries and ordering. |
| `type` | `PlatformEventType` | e.g. `application.installed`. |
| `category` | `PlatformEventCategory` | Coarse grouping. |
| `version` | `number` | Event schema version. |
| `priority` | `string` | `low` / `normal` / `high` / `critical`. |
| `source` | `string` | Module that emitted it. |
| `actor` | `{ kind, id }` | Originator. |
| `resource` | `{ type, id, name } \| null` | Subject of the event. |
| `correlationId` | `string` | Chain id. |
| `causationId` | `string \| null` | Direct cause. |
| `metadata` | `Record<string, primitive>` | Flat extra detail. |

## Storage format

- **On disk:** a single newline‑delimited JSON file,
  `‹userData›/timeline/timeline.jsonl`. One event per line — append‑only, easy to
  tail, stream, and export, and resilient to partial writes (a torn final line
  is skipped on load).
- **In memory:** a bounded ring of the most recent events (`maxInMemory`,
  default **5000**) for fast queries. On startup the service warms this window
  from the tail of the durable log.

```
{"id":"…","type":"application.installed","category":"application","version":1,
 "priority":"normal","timestamp":"2026-06-28T15:02:11.481Z","source":"nps",
 "actor":{"kind":"user","id":null},"resource":{"type":"app","id":"figma","name":"Figma"},
 "correlationId":"…","causationId":null,"metadata":{"version":"3.2.0"}}
```

## Batched persistence

The Timeline never writes once per event. Appends land in memory immediately and
are buffered for persistence; the buffer is flushed when **either**:

- the pending count reaches `batchSize` (default **50**), **or**
- the flush timer fires every `flushIntervalMs` (default **2000 ms**).

A flush serializes the whole pending batch into a single `appendFile`. A
`writing` guard prevents overlapping flushes, and a failed write **re‑queues** the
batch so nothing is silently lost. `export()` and `dispose()` force a final
flush. The result: a burst of events costs a handful of appends, not one syscall
each — and the publisher is never blocked on disk I/O.

This is verified by `timelineService.test.ts`, which asserts that nothing is on
disk until a flush, that a flush writes the whole batch, and that a fresh service
reloads the persisted events into its query window.

## Query, filter, search

`query(TimelineQuery)` runs over the in‑memory window. All fields are optional
and AND‑combined:

| Field | Effect |
| --- | --- |
| `types` | Restrict to these event types. |
| `categories` | Restrict to these categories. |
| `source` | Exact source‑module match. |
| `actorId` | Match `actor.id`. |
| `resourceId` | Match `resource.id`. |
| `correlationId` | Pull one whole chain. |
| `priorities` | Restrict to these priorities. |
| `search` | Free‑text (case‑insensitive) over `type`, `source`, `resource` id/name, and metadata values. |
| `since` / `until` | Inclusive ISO time bounds. |
| `order` | `asc` or `desc` (default `desc`). |
| `limit` | Page size (default **100**, max 500 at the IPC layer). |
| `cursor` | Opaque pagination cursor from a previous page. |

### Pagination

Paging is cursor‑based. A page returns `{ events, nextCursor, total }`, where
`total` is the count of all matches for the query and `nextCursor` is an opaque,
base64 offset token (or `null` at the end). Pass it back as `cursor` to fetch the
next page; the cursor is validated and falls back to the start if malformed.

## Stats and export

- `stats()` → `{ total, byCategory, byType, oldest, newest }` over the live
  window. `total` reflects every event ever recorded (including those rolled off
  the in‑memory window).
- `export()` flushes pending writes, reads the full durable log, and returns
  `{ format: 'jsonl', generatedAt, count, data }`. The `data` is the complete
  newline‑delimited log — suitable for support bundles or external analysis. The
  `timeline:export` IPC channel is marked **audited**.

## Ephemeral events

High‑frequency churn is delivered live but **not** persisted: the Timeline
subscriber skips `download.progress` (a download emits one `started`, many
`progress`, and one `completed`/`failed` — only the milestones are durable). This
keeps the log meaningful and bounded while the live stream still shows real‑time
progress to any subscriber that wants it.

## Memory and retention

Both the durable log and the in‑memory window are bounded by design:

- the **query window** is a hard‑capped ring (`maxInMemory`), so query cost and
  memory do not grow with session length;
- the **durable log** grows append‑only on disk. Rotation/retention policy and a
  move to an indexed store are the planned next step (below).

## Forward path

The query/filter/search/pagination/export surface is the **stable interface**.
The current implementation backs it with JSONL plus an in‑memory window, which is
the right fit for v1: simple, debuggable, and dependency‑free. A later revision
can swap the backing store for **SQLite** (full‑history indexed queries, log
rotation, retention windows) *behind this same interface* without touching any
caller — producers, subscribers, the IPC handlers, and the renderer client all
continue to work unchanged.

AI summarization, activity rollups, and memory extraction are explicitly **out of
scope** here — they are downstream readers of this store, not part of it.

## Where the code lives

```
apps/desktop/src/main/platform/timelineService.ts        Implementation
apps/desktop/src/main/platform/timelineService.test.ts   Persistence + query tests
packages/shared/src/types/platform.ts                    TimelineQuery / TimelinePage / TimelineStats / TimelineExport
```
