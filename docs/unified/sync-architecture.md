# NeuroPause — Synchronization Architecture

The sync engine is what turns connectors into a populated Unified Data Model. It
pulls each provider through its adapter, writes canonical entities into the
unified store, and keeps everything incremental, resilient, and observable.

```
scheduler ─┐
manual ────┼─► orchestrator ─► adapter.resource.pull ─► store.upsertMany ─► UDM
           │        │                                   store.markDeleted
           │        └─► sync-state (cursors + health) ─► Health Dashboard
           └────────────► Platform Event Bus (started / completed / failed / …)
```

Everything here lives in `apps/desktop/src/main/unified/sync/`.

---

## 1. The orchestrator (injectable, testable)

`SyncOrchestrator` is a plain class over **injected ports** — the store, the
sync-state store, a token accessor, the adapter registry, an event publisher, and
a rate gate. It imports no singletons, so it unit-tests against a fake adapter
with a real (Electron-free) store. The production singleton is composed in
`sync/index.ts`.

Two entry points, one core:

- **Manual sync** — the Connectors UI button / IPC → `connectorService.sync` →
  the injected runner → `orchestrator.requestSync`.
- **Automatic sync** — the scheduler tick → `orchestrator.tick` →
  `orchestrator.requestSync` for each *due* account.
- `requestSync` runs the account once via `runAccountSync` and, if the failure was
  transient, hands it to the retry queue.

## 2. Incremental, cursor-based sync

Each adapter resource (e.g. GitHub repos, issues, notifications) owns a **cursor**
persisted per account in `sync-state.json`. The orchestrator passes the stored
cursor into `resource.pull(ctx)`, which returns a page of entities, an optional
list of deleted source ids, the **next cursor**, and `hasMore`. The loop repeats
until `hasMore` is false (capped at `MAX_PAGES_PER_RESOURCE` as a safety stop),
persisting the cursor after every page so an interrupted sync resumes where it
left off.

Because the **Unified Identifier is derived deterministically** from a record's
source coordinates, a re-sync of the same object maps to the same canonical
entity — the cursor narrows *what* gets pulled, and the store's conflict
resolution settles *what* gets written.

## 3. Conflict resolution

Writes go through `store.upsertMany`, which is **source-authoritative**: an
incoming record replaces the stored one only when its `updatedAt` is newer, or
equal-but-different (resolved by content signature). A stale re-sync never
clobbers fresher local state. True conflicts — same timestamp, different content —
are counted and surfaced as `connector.conflict_detected` +
`connector.conflict_resolved` events.

## 4. Retry queue

Transient failures (rate limit, offline, retryable 5xx) are enqueued in an
in-process `RetryQueue` with **exponential backoff** and a hard attempt cap. The
queue re-runs the account sync; if it keeps failing it gives up cleanly (the
sync-state already records the failure). The queue's depth per account is the
Health Dashboard's **Queue Size**. Permanent failures (auth, 4xx) are not retried
— they require reconnect.

## 5. Rate limiting

`RateLimiter` is a per-connector gate the HTTP client consults before every
request. It does two things:

- **Proactive** — enforces a minimum spacing between requests to a connector.
- **Reactive** — on a `429` (or GitHub `x-ratelimit-remaining: 0`) the client
  reads `Retry-After` / `x-ratelimit-reset`, the gate enters a cooldown, and the
  account is parked until the window passes (`rateLimitedUntil`), with a
  `connector.rate_limited` event.

## 6. Offline support

A failed `fetch` becomes a `NetworkError`. The orchestrator marks the connector
offline (once), emits `connector.offline`, and parks the account for retry. The
next successful sync emits `connector.online`. Offline is per-connector, so one
unreachable provider doesn't stall the others.

## 7. Health monitoring

`sync-state.json` records, per account: `status` (idle / syncing / success /
error / rate_limited / offline), last + next sync time, last duration, entity
count, last error, consecutive failures, and the rate-limit window. The
`connectors:sync-state` IPC channel projects these (plus live queue depth) into
`ConnectorSyncSnapshot[]` for the Health Dashboard, and the engine broadcasts a
fresh snapshot whenever state changes.

## 8. Background scheduling

A single low-frequency interval (`SCHEDULER_INTERVAL_MS`) calls
`orchestrator.tick`; the orchestrator decides which accounts are actually due
(default cadence `SYNC_INTERVAL_MS = 15 min`), skipping any that are rate-limited
or not yet due. Cadence policy lives in one place; the timer stays dumb.

## 9. The Connector Event Bus

Every sync signal is published to the **existing Platform Event Bus** (no parallel
bus), so it lands in the Timeline, Activity feed, and Diagnostics alongside app
and runtime events:

| Spec event          | Platform event                  | Category  |
|---------------------|----------------------------------|-----------|
| Sync Started        | `connector.sync_started`         | connector |
| Sync Completed      | `connector.sync_completed`       | connector |
| Sync Failed         | `connector.sync_failed`          | connector |
| Entity Created      | `knowledge.entity_created`       | knowledge |
| Entity Updated      | `knowledge.entity_updated`       | knowledge |
| Entity Deleted      | `knowledge.entity_deleted`       | knowledge |
| Conflict Detected   | `connector.conflict_detected`    | connector |
| Conflict Resolved   | `connector.conflict_resolved`    | connector |
| Rate Limited        | `connector.rate_limited`         | connector |
| Connector Offline   | `connector.offline`              | connector |
| Connector Online    | `connector.online`               | connector |

Entity events are emitted once per sync as aggregate counts (not per record) to
keep the timeline readable.

## 10. The HTTP layer & error taxonomy

Adapters never call `fetch` directly — they use the `HttpClient` from the
`SyncContext`, which attaches the bearer token, applies the rate gate, and maps
transport outcomes into typed errors the orchestrator switches on:

| Error            | Meaning                          | Engine response                |
|------------------|----------------------------------|--------------------------------|
| `AuthError`      | 401/403 — token rejected         | mark error; reconnect required |
| `RateLimitError` | 429 / quota                      | park + `rate_limited` + retry  |
| `NetworkError`   | fetch failed                     | offline + retry                |
| `HttpError`      | other 4xx (no retry) / 5xx (retry) | error; retry if 5xx          |

## 11. Verification

`orchestrator.test.ts` drives the engine with a fake adapter against a real
Electron-free store: multi-page cursor paging, cursor persistence, incremental
re-sync (the second run receives the stored cursor), adapter-reported deletions
soft-deleting, a `NetworkError` producing a retryable + offline outcome with the
`connector.offline` event, and the verify-only path for a connector with no
adapter.

> Note: until Part B registers the four adapters, the registry is empty, so every
> sync runs verify-only and the UDM stays empty. Once an adapter is registered and
> a connector is connected (provider env credentials set), the same engine begins
> pulling real data with no further changes.
