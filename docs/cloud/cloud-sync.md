# Cloud Synchronization

> `apps/desktop/src/main/cloud/sync/`

Offline-first, incremental synchronization of every local-first store to the
cloud, with conflict resolution.

## Domains

Eight syncable domains: `knowledge_graph`, `ai_memory`, `timeline`,
`governance`, `ai_workers`, `templates`, `connectors`, `marketplace`.

## Model

- **SyncDomainState** — `{ domain, localVersion, remoteVersion, pendingChanges,
  status (synced|pending|syncing|offline|conflict), lastSyncedAt, cursor }`.
- **SyncConflict** — `{ domain, entityId, field, localValue, remoteValue,
  resolution, resolvedAt }`.
- **SyncResult** — `{ pushed, pulled, conflicts, fromVersion, toVersion, cursor,
  durationMs }`.

## The sync engine (`syncEngine.ts`, pure)

`planSync({ state, localPending, remoteChanges, conflicts, now })`:

- pushes local pending and pulls remote changes;
- resolves conflicts **server-authoritative last-write-wins** (remote wins; the
  local value is preserved on the conflict record for audit);
- advances the version (`max(local, remote) + pushed + pulled`) and emits an
  incremental **cursor** (`domain@version`).

The cursor + version vector make sync **incremental** — only the delta moves —
and **offline-first** — local edits queue as `pending`/`offline` and reconcile
on reconnect.

## Behavior

`SyncStore` seeds the eight domains synced. `recordLocalChange` simulates a
local edit (→ `pending`). `setOnline(false)` parks every domain `offline` and
queues syncs; `setOnline(true)` resumes. `syncDomain` runs the engine; `syncAll`
runs all eight and stamps `lastFullSyncAt`.

## Seam

There is no real remote backend in this stage. The "remote" is an **in-process
simulated mirror** that produces small, deterministic deltas so offline-first,
incremental sync, and conflict resolution are demonstrable and unit-tested. The
state machine and engine are real and drop onto a real backend unchanged.
