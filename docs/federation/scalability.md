# Performance & Scalability

A documented account of the architecture's validated capacity, the headroom
against current load, the known limits, and exactly where the design extends to
a larger deployment.

## Capacity dimensions

Six dimensions, each reported as current load vs. tested point vs. design limit,
with computed headroom:

| Dimension | Tested | Limit | Note |
|---|---|---|---|
| Federated organizations | 50 | 500 | Bounded by trust-relationship fan-out |
| Tenants | 200 | 5,000 | Namespace-isolated, indexed by id + region |
| Event throughput | 2,000/s | 10,000/s | In-process bus validated to 2k/s |
| Knowledge graph nodes | 5,000 | 100,000 | Projection + query < 20ms at 5k entities |
| Concurrent AI workers | 9 | 64 | Orchestrator runs branches in parallel |
| Cloud regions | 6 | 12 | Per-region replication with independent lag |

The "current" figures are read live (tenants from cloud tenancy, orgs from the
federation runtime, graph nodes from the knowledge graph, workers from the
registry, regions from the cloud region table). Limits are the **honest
in-process ceilings** of the single-node design — not aspirational numbers.

## Engine benchmarks

Measured over 5,000 entities against a 20ms budget (the deterministic, no-LLM
intelligence engines from Phase 5):

| Operation | Measured | Budget |
|---|---|---|
| `graph.project` | 8.67 ms | 20 ms |
| `search.query` | 2.62 ms | 20 ms |
| `memory.recall` | 1.80 ms | 20 ms |
| `briefing.generate` | 4.34 ms | 20 ms |

All four are comfortably inside budget, which is why the graph dimension is
validated to 5k entities with headroom to 100k.

## Extension points

The named seams where the architecture grows to a distributed deployment without
rewriting the engines or IPC:

- **Persistence** — each store is an `EventEmitter` over an atomic JSON file;
  swap the adapter for Postgres/Redis behind the same interface.
- **Synchronization** — the sync engine runs against an in-process mirror; point
  it at a real CRDT/replication backend behind the same state machine.
- **Identity** — the federation engine validates assertion structure; drop in a
  SAML signature / OIDC JWKS validator.
- **Knowledge graph** — back the in-memory projector with a graph database for
  multi-million-node graphs.
- **AI Workforce** — distribute workers across a queue + worker nodes for higher
  concurrency.
- **Observability** — forward historical series to a time-series store for
  long-horizon retention.

## IPC

`fed:scalability.report` returns the full report (dimensions, extension points,
benchmarks).
