# NeuroPause — Unified Data Model (UDM)

The Unified Data Model is NeuroPause's **universal knowledge layer**: one internal
representation that every connector maps into. From the UDM up, the rest of the
product reads a single API and never touches a provider — the caller never knows
(or needs to know) which connector owns a record.

```
Connector → Adapter → Unified Data Model → Query Engine → Activity Intelligence
                                                         → AI Memory
                                                         → Automation
                                                         → Daily Summary
                                                         → Enterprise Analytics
```

This document covers the model itself. The sync engine that *populates* it and the
adapter SDK that *maps into* it are documented separately (Synchronization
Architecture, Adapter SDK); the read API is documented in Query Engine.

---

## 1. Design principle — one flat canonical record

Every entity — whatever its kind, whatever connector it came from — is a single
flat `UnifiedEntity` with the **same shape and the same required envelope**.
Kind-specific meaning lives in a set of shared semantic fields (null when a field
doesn't apply to a kind) and in a primitive `metadata` bag.

This is a deliberate choice over 16 separate per-kind interfaces:

- The **store, query engine, and search index stay uniform** — one filter path,
  one index, one sort, across all kinds and all connectors.
- **Adding a connector requires no model change** — an adapter just fills the
  fields relevant to each kind it produces.
- **Cross-kind queries are trivial** ("everything updated today", "all records
  from this connector") because every record is comparable.

The trade-off — a wide record with nullable fields — is the standard shape for a
universal layer and is what keeps every downstream consumer connector-agnostic.

---

## 2. Canonical entity kinds

```
account · workspace · organization · project · task · conversation · message
document · file · event · calendar_event · notification · contact · label
activity · attachment
```

`UNIFIED_ENTITY_KINDS` is the runtime list; `UnifiedEntityKind` the type. The four
Stage-2 adapters exercise the model across all the major kinds:

| Connector       | Primarily produces |
|-----------------|--------------------|
| GitHub          | project (repo) · issue/PR → task · notification · activity |
| Notion          | document · project · task · workspace |
| Google Calendar | calendar_event · contact (attendees) |
| Slack           | conversation (channel) · message · notification |

Adding Linear, Jira, Google Drive, or Microsoft 365 later means mapping their
objects onto these same kinds — no new entity types.

---

## 3. The required envelope (on every entity)

Every `UnifiedEntity` carries this identity envelope:

| Field         | Meaning |
|---------------|---------|
| `id`          | **Unified Identifier** — stable, globally unique within NeuroPause |
| `kind`        | one of the canonical kinds |
| `connectorId` | **Source Connector** |
| `accountId`   | the connected account the record was synced through |
| `sourceId`    | **Source Identifier** — the provider's own id |
| `createdAt`   | **Created** (in the source, ISO) |
| `updatedAt`   | **Updated** (in the source, ISO) |
| `syncState`   | **Sync Status** — `active` or `deleted` |
| `syncedAt`    | when NeuroPause last synced this record (ISO) |
| `metadata`    | provider-specific extras (flat, primitive-valued) |

### The Unified Identifier

```
id = `${connectorId}:${accountId}:${kind}:${sourceId}`
```

Derived deterministically from a record's source coordinates (see `ids.ts`), so
**re-syncing the same provider object always maps to the same canonical entity** —
the foundation for incremental sync and conflict resolution. Account-scoped so two
accounts of the same connector never alias each other.

### Sync status

`syncState` is `active` for live records and `deleted` for soft-deleted ones.
Deletes are soft by default: the record is flagged (and dropped from the search
index) but retained, so history and the timeline stay intact. Queries exclude
`deleted` records unless `includeDeleted` is set.

---

## 4. Shared fields

Beyond the envelope, every record has common display and relationship fields plus
a set of semantic fields that are populated per kind:

**Display** — `title` (always present), `url` (canonical provider link or null).

**Relationships (by Unified Identifier)** —
`parentId` (direct parent: message→conversation, task→project, attachment→message)
and `containerId` (containing scope: workspace / project / repo / calendar).

**Semantic (null when N/A for a kind)** —

| Field          | Used by (examples) |
|----------------|--------------------|
| `body`         | message text, document excerpt, task description, notification body |
| `status`       | task/issue/PR state, event response |
| `author`       | author / assignee / owner / organizer display name |
| `timestamp`    | primary time — event start, message sent, activity occurred |
| `endTimestamp` | event end |
| `labels`       | label names attached to the record |

`metadata` holds anything provider-specific that doesn't map onto a shared field
(e.g. a GitHub PR's `additions`, a Slack channel's `is_private`), constrained to
primitives so it stays cheap to store, index, and serialize.

---

## 5. Where the model is enforced

- `packages/shared/src/types/unified.ts` — the canonical types (shared by main,
  renderer, and tests).
- `apps/desktop/src/main/unified/unifiedStore.ts` — the store that holds every
  record, resolves conflicts, answers queries, and keeps the search index in
  sync. It is the **only** writable home for canonical data.
- `apps/desktop/src/main/unified/queryEngine.ts` — the read API (see Query Engine
  doc).

### Architecture rule

The UDM is the **only** data source future phases use. Activity Intelligence, AI
Memory, Automation, Daily Summary, and Analytics read the Query Engine — they
**never** call a connector API or a provider SDK directly. All provider data flows
in through an adapter and the sync engine, lands in the store, and is read back
through the unified query and search APIs.
