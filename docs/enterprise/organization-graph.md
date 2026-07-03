# Organization Graph

> One relationship graph over the whole organization. Source:
> `apps/desktop/src/main/enterprise/graph/orgGraph.ts`. **Pure projection.**

## What it connects

Node kinds: `organization`, `unit`, `user`, `worker`, `project`, `customer`,
`document`, `connector`.

Edge kinds: `contains` (org→unit, unit→unit), `member_of` (user→unit), `leads`
(user→unit), `operates` (worker→org), `connected` (org→connector), `owns`
(org→project), `engages` (org→customer), `authored` (org→document).

## Sources

- Org root, units, and members come from the Organization Runtime.
- `worker` nodes are the `ai_worker` members.
- `connector` nodes come from the Connector Framework.
- `project` / `customer` / `document` nodes are projected from the Unified Data
  Model: `project` ← project entities; `document` ← document/file entities;
  `customer` ← organization/contact entities. Capped per kind (default 40) so the
  graph stays bounded.

## Why a projection

The graph is **recomputed on demand** from the runtime + stores — it is never a
separately persisted source of truth, so it cannot drift. `buildOrgGraph(input)`
returns nodes, edges, and `counts.byNodeKind`. `orgGraphNeighbors(graph, id)`
answers an adjacency query (the graph is small enough to scan).

## Honesty

Edges assert only what is known. Person-level authorship/ownership is not
fabricated: the org's projects, customers, and documents attach to the
organization node, and connectors attach to the org — both true. Worker→org
`operates` edges are true (workers are governed under the org).

## Channels

- `enterprise:graph` → `OrgGraph`
- `enterprise:graph.neighbors` `{ id }` → `OrgGraphNeighbors | null`
