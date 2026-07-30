# NEMS Disaster Recovery Manual

The consolidated, executive view of disaster recovery for NEMS. It states scope,
objectives, the scenario set, the drill program, and roles, and points to the
**executable** procedures in [`../dr/`](../dr/). It duplicates none of the step
detail — the technical plan is the source of truth.

## Scope

Recovery of the NEMS production environment on DigitalOcean nyc3 — the DOKS
cluster, the `nems-backend` workload, the Cilium edge, and the three data stores.
Inventory is in the [Production Manual](./PRODUCTION-MANUAL.md).

## Objectives

| Component | RPO | RTO (target — unvalidated) |
|-----------|-----|----------------------------|
| PostgreSQL | ≤ 24h logical / ~minutes PITR | ≤ 1h |
| Qdrant | ≤ 24h | ≤ 1h |
| Valkey | loss tolerated | ≤ 30m |
| Backend | n/a | ≤ 30m |
| Full cluster | per store | ≤ 4h |

RTOs become *measured* only via a filled
[`recovery-evidence`](../dr/recovery-evidence-TEMPLATE.md) record.

## Executable procedures (the real plan)

| Document | Purpose |
|----------|---------|
| [`../dr/DR-PLAN.md`](../dr/DR-PLAN.md) | scenario-by-scenario recovery + validation |
| [`../dr/cluster-rebuild.md`](../dr/cluster-rebuild.md) | rebuild the whole environment from Git + backups |
| [`../dr/recovery-evidence-TEMPLATE.md`](../dr/recovery-evidence-TEMPLATE.md) | the record a drill/incident fills |
| [`deploy/backup/`](../../../deploy/backup/) | backup automation + verified restore |

## Scenario set

Backend down · PostgreSQL loss/corruption · Qdrant loss · Valkey loss · gateway
failure · certificate failure · node failure · **full cluster loss** · registry
loss · accidental data deletion. Each maps to a DR-PLAN section and/or a runbook.

## Decision authority

Two actions are destructive and require the Incident Commander's explicit
go/no-go, and (where possible) separate people to authorize and to execute:

1. Restoring into **production** PostgreSQL.
2. **Rebuilding/replacing** the cluster.

Restore-tests always validate into a **scratch** target first.

## Drill program

| Drill | Frequency | Proves |
|-------|-----------|--------|
| `verify-backup.sh --deep` | daily | freshest backup exists, non-empty, parses |
| PostgreSQL restore-test → scratch | monthly | backup restorable; measures restore time |
| Qdrant snapshot restore → scratch | quarterly | snapshot restorable |
| Full cluster-rebuild game-day | quarterly | `cluster-rebuild.md` is accurate; measures cluster RTO |

Each drill fills a `recovery-evidence-*.md` and updates the measured column in
[`../dr/README.md`](../dr/README.md).

## Known limitations (honest)

- **No multi-region / hot standby.** A regional loss is handled by
  rebuild-from-backup, not failover; the ≤ 4h RTO is unvalidated.
- **Qdrant RPO is 24h** (daily snapshot).
- **All RTOs are targets** until drilled; nothing here reports an achieved
  recovery.

## Roles

Mirror the incident roles ([`../incident/`](../incident/)): Incident Commander
(authorizes destructive recovery, owns comms), Recovery Operator (executes),
Scribe (fills the evidence record). See [`../dr/DR-PLAN.md`](../dr/DR-PLAN.md) for
the per-scenario detail.
