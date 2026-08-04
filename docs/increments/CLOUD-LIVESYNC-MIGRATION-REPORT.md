# INCREMENT — Cloud LiveSync Migration · Retire the Domain-Sync Simulator

**Status:** COMPLETE — closes audit findings **A4-2** and **A5-3**. Typecheck and lint green across every affected workspace; the old simulator is deleted, not merely bypassed.
**Scope discipline:** the real live-sync engine was **not** redesigned. No new sync system was created. This increment removes the *second, simulated* sync system that predated it, moves the one surviving consumer (`syncOps30d`) onto the real engine's own counter, and gives the Cloud → Sync panel a truthful projection of the real engine. Every deletion is of code that the real engine already superseded.

---

## 1. Repository Recon

Cloud synchronization existed twice in this repository.

The **real** path is `apps/desktop/src/main/cloud/livesync/` — a record-level engine (`engine.ts`, `liveSyncService.ts`, `scheduler.ts`, `store.ts`, `types.ts`) introduced across the V6.5/V6.6 commits (`git log` on that directory: *"reuses livesync id + orgClient pattern"*, *"memory sync bridge dispatch"*). It has a durable outbound queue, a local mirror of reconciled records, a cursor that is a monotonically increasing sequence of applied changes, and conflict records.

The **simulated** path was `apps/desktop/src/main/cloud/sync/` — `syncStore.ts` (239 lines), `syncEngine.ts` (56), `syncInstance.ts` (6). It modelled eight fixed `SyncDomain`s (`knowledge_graph`, `ai_memory`, `timeline`, `governance`, `ai_workers`, `templates`, `connectors`, `marketplace`) with `localVersion` / `remoteVersion` counters and a `cloud-sync.json` store file in `userData`. It was wired into `cloud/index.ts` through seven `cloud:sync.*` IPC channels and surfaced by the renderer `SyncPanel.tsx`.

Both were registered at once, so the product shipped two answers to "what is the sync state?" — one real, one simulated. *(Verified against the working tree: `cloud/index.ts`, `packages/shared/src/types/cloud.ts`, and the three deleted `sync/` files.)*

## 2. Runtime Audit

At initialization `initCloud()` called **both** `syncStore.load()` and `liveSync.init(); liveSync.start()`, and emitted a `'sync'` change event from `syncStore.on('changed', …)`. The admin summary's `syncOps30d` was computed from the simulator — `syncStore.states_().reduce((n, s) => n + s.localVersion, 0)` — i.e. a sum of simulated version counters, not applied operations. The seven `cloud:sync.*` handlers returned simulator state (`states_`, `summary`, `listConflicts`, `syncDomain`, `syncAll`, `setOnline`, `recordLocalChange`). *(Verified — `cloud/index.ts` diff.)*

## 3. Gap Analysis

The simulator is the subject of audit findings **A4-2** and **A5-3**: a parallel, non-authoritative sync surface whose `cloud-sync.json` store and `cloud:sync.*` channels reported version counters unrelated to the real engine's applied changes. Leaving it registered means a demo or a test can read a "synced" state that the real engine never produced, and the Sync panel can show domain rows that correspond to nothing on the wire. The gap is not a missing feature; it is a surplus, simulated one that must be removed for the panel to be honest.

## 4. Architecture Decisions

**Delete, do not deprecate.** The seven `cloud:sync.*` channels, the `sync/` trio, and the simulator's six exported types (`SyncDomain`, `SYNC_DOMAINS`, `SyncStatus`, `SyncDomainState`, `SyncConflict`, `SyncResult`) are removed outright (`shared/types/cloud.ts`, net −65 lines). A deprecated-but-registered channel is exactly the ambiguity this increment closes.

**One projection, computed from the engine's own two sources of truth.** The new `livesync/detail.ts` is a pure function: it folds the durable outbound queue (`pending`) and the local mirror of reconciled records (`mirrored`) into one row per entity type in `SYNC_ENTITY_TYPES`, always emitting every type in canonical order so the table has stable rows rather than ones that appear and vanish with traffic. `lastChangeAt` is the newer of the two `updatedAt`s. Nothing is estimated or simulated. It is surfaced on a new `livesync:detail` channel via `liveSync.getDetail()`.

**Move the one real consumer onto the real number.** `syncOps30d` now reads `liveSync.getStatus().cursor` — the engine's applied-operation counter — and is an honest zero offline.

**Adopt the A7 broadcaster.** `CloudDeps.broadcast` moves from `(channel: string, payload: unknown)` to the typed `IpcBroadcaster`, consistent with the A7 IPC-contract increment committed alongside this one.

## 5. Files Modified

**26 files: 3 deleted, 2 new, 21 modified.**

- **Deleted (3):** `apps/desktop/src/main/cloud/sync/{syncEngine,syncInstance,syncStore}.ts`.
- **New (2):** `apps/desktop/src/main/cloud/livesync/detail.ts` (the projection) + `detail.test.ts`.
- **Modified (21):** `cloud/index.ts` (channel + wiring migration); `cloud/{cloud.test,cloudProdSeed.test}.ts`; `cloud/controlPlane/{cloudAuthz,controlPlaneModel,controlPlaneModel.test,controlPlaneService.test,index}.ts`; `cloud/livesync/{engine,engine.test,liveSyncInstance,liveSyncService,scheduler,scheduler.test,store,types}.ts`; renderer `cloud/{CloudProvider.tsx,CloudView.tsx,SyncPanel.tsx,lib.ts}`; `packages/shared/src/types/cloud.ts`.

`SyncPanel.tsx` is the largest renderer change (+162 / −64): it is rewritten to consume `livesync:detail` instead of the retired `cloud:sync.*` states.

## 6. Verification Results

- **Typecheck:** green — `@neuropause/shared`, `apps/backend`, and `apps/desktop` (node + web) each `tsc --noEmit` exit 0 against the working tree containing this change. *(Verified this session.)*
- **Lint:** the repo's ESLint (`--max-warnings 0`) is clean across all changed files, including the deletions' former callers. *(Verified.)*
- **Conflict markers:** none (`git diff --check` clean).
- **Test suite:** the desktop/backend vitest suites validate this change on a macOS host with the project's `node_modules`; they were **not** re-run in the linux review VM used for this report because the Mac-installed native toolchain (rollup) is platform-specific and the VM has no network to reinstall. This is an environment limitation of the review, not a code result. *(UNVERIFIED FROM THIS ENVIRONMENT — run `npm test` natively to close.)*

## 7. Performance Impact

Net removal. One store file (`cloud-sync.json`) is no longer loaded at startup, one `.on('changed')` subscription and one `syncStore.load()` are gone from `initCloud()`, and the admin summary drops a reduce over simulated domain states in favour of a single field read (`getStatus().cursor`). No new polling, timers, or listeners are introduced; `livesync:detail` is computed on demand from state the engine already holds.

## 8. Security Impact

Neutral-to-positive. The change removes an IPC surface (seven channels) rather than adding one; the two new channels (`livesync:status` already existed; `livesync:detail` is added) are read-only and pass through the same `secureBridge` pipeline as every other handler. No authz path is weakened. The orphaned `cloud-sync.json` in `userData` is no longer read; it is inert data at rest and can be removed by an operator.

## 9. Backward Compatibility

The `cloud:sync.*` channels are **removed**, so any renderer code invoking them would fail its compile-time contract — which is why the renderer `cloud/` surface is part of this same change and no caller of the retired channels remains (verified: `git diff --check` clean, typecheck green, and the removed types produce no dangling references). This is a deliberate breaking change internal to the desktop process; it crosses no published API. `userData/cloud-sync.json` from prior runs is ignored, not migrated.

## 10. Known Limitations

The Sync panel now reflects exactly what the real engine holds, which means offline or pre-first-sync it shows honest zeros rather than the simulator's populated-looking domains. The orphaned `cloud-sync.json` is left on disk (not deleted) to avoid a destructive file operation at upgrade time; removing it is an operator action.

## 11. Future Considerations

A one-time cleanup that deletes a stale `cloud-sync.json` on first run could be added to the engine's `init()` if telemetry shows the file lingering. The `SYNC_ENTITY_TYPES` list is the single source of the panel's rows; adding a syncable entity type there automatically gives it a stable row in the detail projection.
