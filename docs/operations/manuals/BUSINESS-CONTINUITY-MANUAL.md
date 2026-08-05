# NEMS Business Continuity Manual

How NEMS keeps its essential service available through disruption. This is the
business-level view: critical functions, the dependencies they rest on, single
points of failure, and continuity strategy. The technical recovery procedures it
relies on are in [Disaster Recovery](./DISASTER-RECOVERY-MANUAL.md) and
[`../dr/`](../dr/).

## Critical business functions

| Function | Depends on | Continuity requirement |
|----------|-----------|------------------------|
| Authenticated API access | gateway, backend, PostgreSQL | highest — this is the service |
| Login / OAuth | backend, Google Identity, TLS cert | high — no login = no access |
| Vector / semantic features | Qdrant | medium — degrades, not total outage |
| Rate limiting / caching | Valkey | low — degrades gracefully to fallback |

## Recovery objectives (summary)

Full definitions and the measured-vs-target status are in
[`../dr/README.md`](../dr/README.md). Summary:

| Component | RPO objective | RTO objective (unvalidated) |
|-----------|---------------|-----------------------------|
| PostgreSQL | ≤ 24h (logical) / ~minutes (managed PITR) | ≤ 1h |
| Qdrant | ≤ 24h | ≤ 1h |
| Valkey | loss tolerated | ≤ 30m |
| Backend | n/a (stateless) | ≤ 30m |
| Full cluster | per store | ≤ 4h |

Every RTO is a **target** until a dated drill measures it.

## External dependencies (and what happens if they fail)

| Dependency | Role | If it's down |
|------------|------|--------------|
| DigitalOcean nyc3 (compute, LB, managed DBs, Spaces) | hosts everything | regional event affects most of the stack; DR game-day covers rebuild; cross-region is **not** in place today (a known limitation) |
| Google Identity (OAuth) | user login | logins fail; [oauth-outage](../runbooks/oauth-outage.md); no local fix for a provider outage |
| Let's Encrypt (ACME) | TLS issuance | renewal blocked; [certificate-expiry](../runbooks/certificate-expiry.md) |
| Container registry (DOCR) | image source | running pods unaffected (digest-pinned); redeploys blocked until restored |

## Single points of failure (honest register)

| SPOF | Impact | Current mitigation | Residual risk |
|------|--------|--------------------|---------------|
| Single region (nyc3) | regional outage takes NEMS down | rebuild from Git + backups | no hot standby / multi-region — worst-case RTO is the rebuild time |
| Single PostgreSQL primary | DB outage = API outage | managed HA/PITR + own logical backups | failover time depends on DO |
| In-cluster Qdrant | lost with the cluster | daily snapshot to Spaces | 24h RPO; restore unvalidated until drilled |
| OAuth provider | login outage | none (external) | dependent on Google |

Recording these honestly is the point — they are the backlog for continuity
investment, not hidden.

## Continuity strategies

- **Prevention** — SLOs + error-budget policy (`../slo/SLO.md`), alerting,
  capacity thresholds (`../capacity/`), maintenance discipline (`../maintenance/`).
- **Detection** — the observability stack (`deploy/observability/`).
- **Response** — runbooks (`../runbooks/`) and the incident process
  (`../incident/`).
- **Recovery** — backups (`deploy/backup/`) and DR (`../dr/`), including full
  cluster rebuild.
- **Data protection** — two backup layers for PostgreSQL (DO managed + own
  logical dumps), daily Qdrant snapshots, private-only data stores.

## Activation

A continuity event is any disruption expected to exceed a critical function's
RTO. The Incident Commander activates the relevant plan (usually a SEV1
incident + the matching DR scenario), owns stakeholder comms, and authorizes
destructive recovery. Roles mirror the incident roles in [`../incident/`](../incident/).

## Review

Review this manual quarterly alongside the DR game-day, and after any incident
that exercised a continuity path. Update the SPOF register and objectives with
what the drill/incident measured.

## Honesty boundary

No continuity event has occurred. Multi-region resilience is **not** implemented;
the plan of record for a regional loss is rebuild-from-backup, with an
unvalidated ≤ 4h target. Do not represent continuity capabilities beyond what is
built and drilled.
