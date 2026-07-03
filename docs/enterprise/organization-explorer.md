# Organization Explorer

> Interactive enterprise explorer. Source:
> `apps/desktop/src/renderer/src/enterprise/OrganizationExplorerPanel.tsx`.

Browse the whole organization two ways — as a chart and as a relationship graph —
both driven by the Stage 1 org runtime and the organization graph projection.

## Counts

A header strip counts people, AI workers, units, projects, customers, documents,
and connectors, taken straight from `graph.counts.byNodeKind`.

## Org Chart

A recursive tree of the org hierarchy: business units → departments → teams, each
showing its kind, its lead, and its direct members (people and AI workers).
Selecting any unit or member loads its neighborhood and shows it in the detail
pane.

## Relationship Graph

A radial visualization: the focus node centered, its neighbors arranged around it
with labeled edges (`member_of`, `leads`, `operates`, `owns`, `works_on`,
`engages`, …). Click any node to re-center the graph on it. Neighbors come from
`ipc.enterprise.graphNeighbors(nodeId)`.

## Data source

- Hierarchy + members: the org bundle (`organization`, `units`, `roles`,
  `users`) from `ipc.enterprise.org`.
- Nodes, edges, counts, neighbors: the organization graph — a projection that
  weaves the org chart, the AI workforce, connectors, and business entities
  (projects, customers, documents) into one view. It is computed on demand, never
  a second source of truth.
