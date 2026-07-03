# Enterprise Observability

A single operational view across the federated deployment, plus historical
reporting. Every subsystem metric is a **live count** rolled from the running
system — not a stored guess.

## Subsystems

Seven subsystems, each with a health status (`healthy` | `degraded` | `down`)
and a headline metric:

| Subsystem | Metric | Health derives from |
|---|---|---|
| Organizations | federated orgs | always healthy (membership) |
| AI Workers | worker count | any worker not `healthy` → degraded |
| Connectors | connector count | down/degraded counts from the connector service |
| Synchronization | sync domains | offline → down; pending changes → degraded |
| API Platform | replicas | healthy/replicas ratio + uptime |
| Federation Runtime | peers | always healthy (with trusted count) |
| Security | open events | criticals → down; warnings → degraded |

The counts come from the workforce registry, the connector service (`stats()`),
cloud sync (`summary()`), the API platform (`summary()` over real gateway
request volume), and the federation runtime summary — assembled by a pure
rollup that is unit-tested for the clean and degraded cases.

## Historical reporting

A persisted store holds a rolling **14-day usage series** (API requests, sync
ops, worker jobs, events) and a **security event log** (auth, access, integrity
categories at info / warning / critical severity). The Observability panel
renders the usage trend as a bar chart and the security log as a feed. Both can
be appended at runtime.

## IPC

`fed:obs.*` — `overview` (the rollup), `usage` (the series), and `security`
(the event log).
