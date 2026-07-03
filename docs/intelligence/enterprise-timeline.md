# Enterprise Timeline

> Phase 5 · Module 2 — the universal "what happened" stream.
> Status: **implemented** (unifies platform events + UDM activity; replay + export).

The Enterprise Timeline is one chronological stream of everything that has
happened across the workspace. It is a **read-model**, not a new store: it owns
no data of its own and instead composes two sources that already exist, at read
time. That keeps it honest — every entry traces to a real platform event or a
real UDM record.

The low-level platform Timeline (`ipc.timeline`) still exists for raw event
access; the Enterprise Timeline sits above it and adds the *activity* half of the
story plus replay.

---

## 1. Two sources, one stream

| source | where it comes from | example entries |
| --- | --- | --- |
| `platform` | the durable platform Timeline (`platform.api.query`) | sync ran, app launched, permission granted, connector offline |
| `activity` | the Unified Data Model | a message was sent, a meeting occurred, a document was updated, a task moved |

The key insight: connected-system *work* is not in the platform event log — it
lives in the UDM as entities with timestamps. The Enterprise Timeline places
those entities on the timeline at the instant they happened, so the stream
reflects real activity, not just app telemetry.

**When a UDM entity becomes an entry** (`activityTimeFor`): anything with an
explicit event `timestamp` (messages, calendar events, commits) is placed at that
time; documents, tasks, files, attachments, and notifications without one are
placed at their `updatedAt` (a "last touched" signal). Pure containers and
identities (projects, organizations, contacts, …) are not timeline activity
unless they carry a timestamp.

---

## 2. The entry shape

Every entry — platform or activity — is one `EnterpriseTimelineEntry`:

```ts
{
  id,                       // event id, or `activity:<entityId>`
  source: 'platform' | 'activity',
  at,                       // ISO instant — the sort key
  kind, category,           // event type/category, or entity kind + 'activity'
  title, summary,
  actorId, actorLabel,      // who
  connectorId,
  resourceId,               // the primary entity/resource
  entityRefs[],             // everything it references (for entity filtering)
  url, metadata
}
```

---

## 3. What you can do with it

**Query** — filter by `sources`, `kinds`, `categories`, `connectorId`,
`actorId`, an `entityRef` (every entry touching a given entity — container,
parent, or resource), a `since`/`until` window, and free text; order ascending or
descending; paginate by cursor.

**Replay** — a `since`/`until` window returned in strict ascending order with
`from`/`to`/`count` bounds, for stepping through "what happened during this
period."

**Stats** — totals by source and category, plus oldest/newest instants.

**Export** — the full merged stream (newest first) as an NDJSON-ready payload.

**Search surface** — `search(text, limit)` feeds the Enterprise Search
`timeline` source, so one global query reaches timeline entries too.

---

## 4. Design notes

- **Composes, doesn't copy.** Each call reads live from `platform.api.query` and
  a UDM snapshot, merges, then filters/orders/paginates in memory. A merge pass
  pulls up to a bounded window of platform events (5000) plus current activity —
  appropriate for a desktop read-model.
- **Pure and injected.** The façade takes its two sources as constructor
  dependencies, so it unit-tests with fakes (see `enterpriseTimeline.test.ts`:
  merge ordering, entity filtering, ascending replay, search, and stats). The
  runtime wires the real platform query and `unifiedStore`.
- **Shared instance.** Once initialized it's exposed via `getEnterpriseTimeline()`
  so Enterprise Search can use it as a source without re-deriving anything.

---

## 5. IPC surface

| channel | request | returns |
| --- | --- | --- |
| `enterpriseTimeline:query` | filters + order + cursor | `EnterpriseTimelinePage` |
| `enterpriseTimeline:replay` | since? / until? / sources? / limit? | `TimelineReplay` (ascending) |
| `enterpriseTimeline:stats` | — | `EnterpriseTimelineStats` |
| `enterpriseTimeline:export` | — | `EnterpriseTimelineExport` |
| `enterpriseTimeline:event` (broadcast) | — | `EnterpriseTimelineStats` when activity changes |

---

## 6. Boundaries

- **Empty-ish until you sync.** With no connected accounts the activity half is
  empty; you'll still see platform events (app launches, the boot sync attempt).
  Real work appears once a connector syncs.
- **No re-emission.** Replay *returns* an ordered window for inspection; it does
  not re-publish events onto the bus (that would pollute the real event stream).
- **Last-touched is an approximation.** Entries placed at `updatedAt` mark when an
  artifact last changed, not necessarily a discrete user action — the honest
  signal the UDM actually carries.
- **Reads only derived state.** Like everything in this layer, it reads the
  platform timeline and the UDM — never a connector directly.

---

*Feeds: [Enterprise Search](./enterprise-search.md) (the `timeline` source).
See also: [AI Memory](./ai-memory.md), [Knowledge Graph](./knowledge-graph.md).*
