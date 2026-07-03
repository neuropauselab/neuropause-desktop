# NeuroPause — Connector Health Dashboard & Knowledge UI

Drop 3 gives the unified layer its two faces, both as tabs in the **Operations**
command center (the app's monitoring surface): **Sync Health** (the Connector
Health Dashboard) and **Knowledge** (cross-connector search + a live breakdown of
the model). Neither needs a connector connected to render — they simply show an
honest empty state until data flows.

---

## 1. Sync Health — the Connector Health Dashboard

`operations/SyncHealthPanel.tsx`. A live, per-account view driven entirely by the
sync engine's state.

**Data source.** It reads `ipc.connectors.syncState()` →
`ConnectorSyncSnapshot[]`, subscribes to `ipc.connectors.onSyncState` for live
pushes (the engine broadcasts a fresh snapshot on every state change), and polls
every 5s as a backstop. Connector display names and account labels come from
`ipc.connectors.list()`.

**The eight required fields**, each mapped from the snapshot:

| Dashboard field      | Source                                  |
|----------------------|------------------------------------------|
| Connection Status    | `status` → colored badge (idle / syncing / synced / error / rate limited / offline) |
| Last Sync            | `lastSyncAt` → relative ("2m ago")       |
| Next Sync            | `nextSyncAt` → countdown ("in 13m" / "due") |
| Sync Duration        | `lastDurationMs`                         |
| Entity Counts        | `entityCount` (per account) + a synced-total tile |
| Errors               | `lastError` (shown inline under the connector when not healthy) |
| Rate Limits          | `status: rate_limited` + `rateLimitedUntil` ("resets in 40s") |
| Queue Size           | `queueSize` (retry-queue depth) + an "In retry queue" tile |

**Summary tiles.** Connected accounts, total entities synced, syncing-now count,
and retry-queue depth (flagging how many accounts need attention).

**Manual sync.** Each row has a Sync-now action → `ipc.connectors.sync(connectorId,
accountId)`, disabled while a sync is in flight. (Automatic sync continues on the
15-minute cadence regardless.)

**Empty state.** With nothing connected, a clear prompt to connect a provider from
the Connectors screen.

---

## 2. Knowledge — cross-connector search + breakdown

`operations/KnowledgePanel.tsx`. The face of the Unified Data Model.

**Search.** A single box queries `ipc.unified.search({ text, kinds? })` (debounced
~220ms) against the local index. Results are ranked `SearchHit`s — each showing a
kind badge, the title, the source connector, a snippet, and tagged with the
backend that answered (`local` today, Meilisearch/Qdrant later with no UI change).
Kind-filter chips narrow the search to one entity type. **The caller never cares
which connector owns a result** — that's the whole point of the layer.

**Live breakdown.** Above search, four tiles (total records, entity kinds, sources,
last updated) read `ipc.unified.counts()` and refresh on `ipc.unified.onChange`
(broadcast whenever the store changes). Below, two bar charts break the model down
**by type** (projects, tasks, documents, messages, events…) and **by source**
(which connectors contributed), so you can see the shape of your knowledge at a
glance.

**Empty state.** With zero records, a prompt explaining that connecting a provider
and syncing populates the searchable model.

---

## 3. Why Operations, and why self-contained

Both panels live in Operations because it is the existing monitoring/ops surface,
alongside Health and Diagnostics — sync health and the knowledge layer are
operational views, not part of the connect/manage flow. They are **self-contained**
(they fetch their own data via the unified + connector IPC and subscribe to live
events) rather than routed through the heavy `OperationsProvider`, which keeps the
unified layer decoupled from runtime/registry concerns.

---

## 4. The live path, end to end

```
adapter sync → unifiedStore.upsert / syncState.recordRun
            → 'changed' events
            → broadcast(ConnectorSyncState snapshots) + broadcast(UnifiedCounts)
            → ipc.connectors.onSyncState / ipc.unified.onChange
            → Sync Health + Knowledge panels re-render
```

So the moment a sync writes data, both dashboards reflect it without a manual
refresh.

---

## 5. Verification

The panels are driven by the same IPC channels exercised in the engine tests; with
no provider connected they render their empty states, and once a connector syncs
(its OAuth credentials set), the snapshots, counts, breakdowns, and search results
populate live. Typecheck (node + web) and the full suite (52 tests) stay green.
