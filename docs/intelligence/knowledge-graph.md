# Enterprise Knowledge Graph — Architecture

> Phase 5 · Module 1. The central graph the rest of the intelligence layer reads.

## What it is

The Enterprise Knowledge Graph (EKG) is a typed, directed graph **projected
deterministically from the Unified Data Model (UDM)**. UDM entities become
**nodes**; their containment relationships and semantic fields become **edges**.
Every edge carries *provenance* — a reference back to the exact UDM record that
justifies it — and the graph maintains a **relationship history** so you can see
how the organization's structure changed over time.

The EKG reads **only** the UDM and platform services (connector list, installed
applications). It never talks to a connector. This is the architectural
contract for all of Phase 5:

```
Connectors → Unified Data Model → Enterprise Knowledge Graph → Timeline → Intelligence → …
```

Because it is a pure projection, the graph is **derived, not authored**: it can
be rebuilt from the UDM at any time and always converges to the same result.

## Node model

18 node types: `person`, `organization`, `team`, `department`, `project`,
`task`, `document`, `file`, `meeting`, `calendar_event`, `conversation`,
`message`, `customer`, `vendor`, `policy`, `ai_worker`, `connector`,
`application`.

Each node:

| field | meaning |
|---|---|
| `id` | stable id — the UDM unified id for entity-derived nodes, a synthesized id otherwise |
| `type` | one of the 18 node types |
| `label` | display name |
| `sourceKind` | the UDM kind, or `derived` / `platform` |
| `sourceId` | the UDM unified id when the node mirrors an entity |
| `connectorId` | owning connector, when known |
| `createdAt` / `updatedAt` | first seen / last refreshed in the graph |
| `metadata` | small primitive bag (status, url, kind, connector) |

### How UDM kinds map to node types

| UDM kind | node type |
|---|---|
| `project` | `project` |
| `task` | `task` |
| `document` | `document` |
| `file`, `attachment` | `file` |
| `calendar_event` *(with attendees > 0)* | `meeting` |
| `calendar_event` *(no attendees)* | `calendar_event` |
| `event` | `meeting` |
| `conversation` | `conversation` |
| `message` | `message` |
| `contact`, `account` | `person` |
| `organization` | `organization` |
| `workspace` | `team` |
| `notification`, `label`, `activity` | *(not nodes — these are timeline signals)* |

### Derived and provenance nodes

- **People** are derived from `author` and `metadata.assignee`. A person id is
  `person:{connectorId}:{slug(handle)}`.
- **Connectors** become one `connector:{id}` node each (from the connector list).
- **Applications** become one `app:{slug}` node each (from the installed registry).

## Edge model

10 relationship types: `assigned_to`, `created_by`, `depends_on`, `belongs_to`,
`references`, `participated_in`, `discussed_in`, `generated_by`, `approved_by`,
`linked_to`.

Each edge has a deterministic id `` `${from}|${type}|${to}` ``, `createdAt` /
`updatedAt` timestamps, optional `label`/`metadata`, and an `evidence` pointer
`{ kind, id }` to the UDM record that produced it.

### Projection rules (what the projector derives today)

| signal in the UDM | edge produced |
|---|---|
| `entity.containerId` → container node | `entity —belongs_to→ container` |
| `entity.parentId` (≠ container) → parent node | `entity —belongs_to→ parent` |
| `task.author` | `task —assigned_to→ person` |
| `document`/`message`/`project`/`meeting` `.author` | `entity —created_by→ person` |
| `message.author` + conversation container | `person —participated_in→ conversation` |
| `meeting.author` (organizer) | `person —participated_in→ meeting` |
| `task.metadata.assignee` | `task —assigned_to→ person` |

Every derived edge sets `evidence` to the originating entity, so any downstream
claim ("this task is assigned to X") can be traced to its source record.

## Relationship history

The graph is rebuilt by **`apply(nodes, edges, at)`**, which *diffs* the new
projection against the current graph:

- An edge present in the new set but not the old is recorded as
  `{ change: 'added', at, … }`.
- An edge present in the old set but not the new is recorded as
  `{ change: 'removed', at, … }` and dropped.
- Existing edges keep their original `createdAt` and refresh `updatedAt`.

The result is an append-only **relationship-history log** (capped at 5,000
events) you can query per node via `historyFor`. Reassigning a task, moving a
document, or a person leaving a conversation all show up as add/remove pairs
with timestamps — without any extra bookkeeping at the call site.

## Query API

Exposed over the secure IPC bridge (renderer: `ipc.graph.*`):

| call | returns |
|---|---|
| `counts()` | totals + breakdown by node type and edge type + `lastBuiltAt` |
| `node(id)` | a single node |
| `nodes({ type?, connectorId?, text?, limit? })` | filtered node list (by type, connector, label substring) |
| `neighbors({ id, direction?, edgeTypes?, limit? })` | immediate neighborhood, optionally filtered by direction (`out`/`in`/`both`) and edge type |
| `subgraph({ id, depth?, limit? })` | BFS ego network around a node, bounded by depth and a node cap |
| `path({ from, to, maxDepth? })` | shortest undirected path between two nodes (BFS) with the nodes and edges traversed |
| `history({ id, limit? })` | the relationship history touching a node, most recent first |
| `rebuild()` | force a re-projection now and return fresh counts |

`graph:event` is broadcast (with a counts snapshot) whenever the graph changes,
so a live dashboard can refresh without polling.

### Internals

- **Adjacency indexes** (`out`/`in` maps of `nodeId → edgeId set`) make
  neighbor, subgraph, and path queries traverse only incident edges.
- **Persistence** is a single JSON file (`graph.json`) written atomically
  (temp + rename, `0o600`); adjacency is rebuilt on load. The store class is
  electron-free and unit-tested on a temp file; the `userData` singleton lives
  in a separate composition file.
- **Rebuild cadence**: debounced (~750 ms) on every UDM change, plus once at
  startup. Bursts of sync writes coalesce into a single projection.

## Honest boundaries (what's empty by design today)

The model defines all 18 node types and all 10 edge types, but a projection can
only produce what the connected data supports:

- **`customer` / `vendor`** — no CRM/procurement connector exists yet, so these
  stay empty until one lands. The types are ready.
- **`policy` / `approved_by`** — populated by **Governance Trace™** (Drop 4),
  not by the UDM. Empty until governance records exist.
- **`ai_worker` / `generated_by`** — populated by the **AI Workforce Platform**
  (Phase 6). Empty until AI workers run.
- **`department`** — no reliable org-hierarchy source today; `team` is derived
  from workspaces where available.
- **`depends_on` / `discussed_in` / `references`** — these need richer signals
  (dependency links, cross-references) than the current adapters emit. The edge
  types exist; the projector will populate them as adapters surface the signals.
- **Person identity is per-connector.** The same human in GitHub and Slack
  produces two `person` nodes today; cross-connector identity resolution is a
  deliberate future enhancement, not silently faked.

Nothing here is fabricated: every node and edge traces to a real UDM record or a
real platform object, and absent data yields an absent node — never a guess.

## Verification

`graphStore.test.ts` and `projector.test.ts` cover apply/diff, lookup, neighbor
direction + edge-type filtering, shortest path (including trivial and
unreachable), bounded subgraph, the add/remove relationship history, persistence
across reloads, and the UDM→node-type + edge derivation rules — run under the
project's real `tsc` + `vitest`.
