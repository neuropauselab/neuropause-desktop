# NeuroPause Platform Core — Event Architecture

> Status: **Part B‑2·II·A (event-driven core)** — implemented and shipped.
> The Diagnostics Center page and Developer Event Inspector (Part B‑2·II·B) are
> renderer surfaces that consume the IPC defined here; they ship next.

## Why this exists

NeuroPause is an operating layer, not a single app. Installs, launches, crashes,
permission changes, downloads, plugin lifecycle, sign-in — all of it needs to be
observable, recordable, and reactable‑to *without* every feature reaching into
every other feature's internals.

The Platform Core establishes one rule:

> **Everything significant that happens becomes a typed Platform Event.**

Producers publish events. Subscribers react. The bus in the middle is pure
infrastructure — it carries events and contains no business logic. Every future
capability (Connector Framework, Activity Intelligence, AI Memory, Automation,
Enterprise Analytics) plugs in by subscribing through the **Public Event API**
rather than by coupling to a service.

## The event contract

Every event is materialized to the same shape (`packages/shared/src/types/platform.ts`):

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | `string` | Unique id for this event instance. |
| `type` | `PlatformEventType` | The canonical event name, e.g. `runtime.crashed`. |
| `category` | `PlatformEventCategory` | Coarse family for filtering/metrics. |
| `version` | `number` | Schema version of this event type (starts at `1`). |
| `priority` | `'low' \| 'normal' \| 'high' \| 'critical'` | Routing/QoS hint. |
| `timestamp` | ISO‑8601 `string` | When it happened. |
| `source` | `string` | The module that published it (`runtime`, `nps`, `plugins`, …). |
| `actor` | `{ kind, id }` | Who/what caused it (`user`/`system`/`plugin`/`connector`). |
| `resource` | `{ type, id, name } \| null` | The thing it's about (an app, a plugin, …). |
| `correlationId` | `string` | Groups related events into one logical chain. |
| `causationId` | `string \| null` | The id of the event that directly caused this one. |
| `metadata` | `Record<string, primitive>` | Flat, serializable extra detail. |

Producers publish a terse `PlatformEventInput`; the bus fills in `id`,
`timestamp`, and defaults for `version` (1), `priority` (`normal`), `actor`
(`system`), and `correlationId` (the event's own id, so a standalone event
correlates to itself).

### Event taxonomy

| Category | Types |
| --- | --- |
| `application` | `application.installed`, `application.updated`, `application.removed` |
| `runtime` | `runtime.started`, `runtime.stopped`, `runtime.crashed`, `runtime.health_changed` |
| `plugin` | `plugin.installed`, `plugin.enabled`, `plugin.disabled`, `plugin.removed`, `plugin.crashed` |
| `permission` | `permission.granted`, `permission.revoked` |
| `download` | `download.started`, `download.progress`, `download.completed`, `download.failed` |
| `update` | `update.available` |
| `session` | `user.signed_in`, `user.signed_out`, `workspace.opened`, `workspace.closed` |
| `diagnostics` | `diagnostics.health_changed` |
| `system` | `system.ready` |

Adding a type is additive. Changing the shape of an existing type bumps its
`version`, so long-lived consumers (and the durable Timeline) can branch on it.

## Correlation and causation

`correlationId` answers *"what workflow is this part of?"* and `causationId`
answers *"what directly triggered this?"*. A producer that emits a follow-on
event passes the parent's `correlationId` through and sets `causationId` to the
parent's `id`. This lets the Timeline reconstruct a chain — e.g. an install that
triggers a permission prompt that triggers a first launch — without any of those
producers knowing about each other.

## Priorities

Priority is a QoS hint carried on every event. Within a single `publish` call,
higher‑priority events are dispatched ahead of routine ones, and subscribers can
filter on priority (the Notifications subscriber only reacts to `high`/`critical`).
Crashes and download failures are published at `high`; routine progress at `low`.
Priority never changes delivery semantics — it is advisory, and the bus stays
synchronous and lossless under normal load.

## Error isolation

A subscriber must never be able to take down the publisher or its peers. Each
handler is invoked inside its own `try/catch`, and returned promises are
`.catch`‑guarded, so:

- a throwing subscriber is recorded (error count + last error) and the publish
  call still returns normally;
- an async subscriber that rejects is caught on the microtask queue and tallied;
- other subscribers always run.

`bus.subscriberStatuses()` exposes per‑subscriber `events`, `errors`,
`lastError`, and `avgMs` — the raw material the Diagnostics report and the
Inspector's "Subscriber Status" panel are built from.

## Replay

The bus keeps a bounded ring buffer of the most recent events (default 500). A
late subscriber can pass `{ replay: true }` to receive the buffer (oldest→newest,
respecting its type filter) on attach, and `api.replay({ types, limit })` returns
a filtered slice on demand. This is what powers the Inspector's "Replay" control
and lets a feature that starts mid‑session catch up on what it missed.

> Replay serves the *live* in‑memory buffer. For history beyond the buffer,
> consumers query the **Timeline** (see `timeline-schema.md`).

## Producers

Producers translate domain signals into Platform Events. They are pure functions
(`apps/desktop/src/main/platform/producers.ts`) so they can be unit‑tested
without the services that feed them. The composition root wires them:

- **Streaming sources** (`supervisor`, `packageService`, `pluginHost`,
  `authService` — all `EventEmitter`s) are subscribed in `initPlatform`'s
  `wireProducers(...)`, and their emissions are mapped (`runtime.*`,
  `download.*`, `plugin.crashed`, `user.signed_in/out`).
- **Discrete actions** are published from the secure IPC handlers on success
  (`application.installed/updated/removed`, `permission.granted/revoked`,
  `plugin.installed/enabled/disabled/removed`, `update.available`) via the
  `build.*` builders.
- **UI‑origin events** (`workspace.opened/closed`) arrive through the guarded
  `platform:emit` channel, which only accepts UI‑emittable types.

This keeps the services themselves untouched: they emit what they always did;
producers adapt those signals into the platform vocabulary.

## Subscribers

Subscribers hold all the reactions. Each does one job and is independently
testable; side effects (persist/audit/notify/broadcast) are injected.

| Subscriber | Responsibility |
| --- | --- |
| Timeline | Durably records events (skips ephemeral `download.progress`). |
| Audit | Writes security‑relevant events to the audit log. |
| Analytics | Rolling in‑memory counts by type and category. |
| Diagnostics collector | Per‑category liveness + crash/failure counters. |
| Notifications | Native notification for `high`/`critical` events. |
| Forwarder | Mirrors every event to the renderer (`platform:event`). |
| Domain projections ×6 | Bounded recent‑activity view per domain (runtime, application, download, permission, plugin, update). |

`registerSubscribers(bus, deps)` wires them all and returns handles
(`analytics`, `diagnostics`, `projections`, `disposeAll`).

## Public Event API

`PlatformEventApi` (`apps/desktop/src/main/platform/eventApi.ts`) is the stable
interface every other module depends on instead of the bus/timeline internals:

```ts
api.publish(input)               // emit a typed event
api.subscribe(handler, opts?)    // react to events (optionally filtered)
api.on(types, handler)           // react to specific types
api.replay({ types, limit })     // catch up on the live buffer
api.query(timelineQuery)         // read durable history
api.stats()                      // timeline stats
```

When the Connector Framework (Phase 4) arrives, a connector publishes
`connector.*` events and subscribes to the ones it cares about — without the
core knowing the connector exists. The same is true for AI Memory, Automation,
and Analytics. This API is the seam.

## IPC surface

The renderer reaches the platform only through the secure bridge. Channels added
in this pass (all on the shared allowlists, so the preload permits them
automatically):

| Channel | Direction | Purpose |
| --- | --- | --- |
| `platform:event` | main → renderer | Live unified event stream (the Forwarder). |
| `platform:emit` | renderer → main | Publish a UI‑origin event (workspace open/close). |
| `timeline:query` | renderer → main | Query durable history (filters/search/pagination). |
| `timeline:stats` | renderer → main | Timeline counts. |
| `timeline:export` | renderer → main | Full JSONL export (audited). |
| `diagnostics:get` | renderer → main | A diagnostics snapshot. |

The renderer client exposes these as `ipc.platform.*`, `ipc.timeline.*`, and
`ipc.diagnostics.*`.

## Performance characteristics

- **Low‑latency publishing.** Dispatch is synchronous and allocation‑light; the
  publisher is never blocked on a subscriber, and slow/throwing subscribers are
  isolated rather than serialized into the hot path.
- **Batched persistence.** The Timeline never writes per event; it buffers and
  flushes on an interval or batch‑size threshold, turning a burst into a handful
  of appends. (Details in `timeline-schema.md`.)
- **Minimal UI‑thread impact.** All of this runs in the main process. The
  renderer only receives a forwarded stream it can filter, and pulls history on
  demand.
- **Bounded memory.** Both the replay buffer and the Timeline query window are
  ring buffers with hard caps, so memory does not grow with session length.
- **Graceful degradation.** Under heavy volume the worst case is buffer
  eviction (oldest live events roll off the replay buffer; durable history is
  unaffected) and dropped‑event accounting surfaced in diagnostics — never a
  crash or a wedged publisher.

## Where the code lives

```
packages/shared/src/types/platform.ts     Event + timeline + diagnostics types
packages/shared/src/ipc/channels.ts        Channel names + allowlists
packages/shared/src/ipc/contracts.ts       Zod request schemas

apps/desktop/src/main/platform/
  eventBus.ts          Pure typed pub/sub (priorities, isolation, replay, metrics)
  timelineService.ts   Pure event store (batched JSONL, query/search/export)
  subscribers.ts       Timeline/Audit/Analytics/Diagnostics/Notifications/Forwarder/Projections
  producers.ts         Pure translators + discrete builders
  eventApi.ts          Public Event API facade
  diagnostics.ts       Diagnostics aggregator (bus/timeline checks + service probes)
  index.ts             initPlatform composition root (the only Electron-touching file)
  *.test.ts            Unit / subscriber / replay / persistence / integration / failure-recovery
```
