# NEMS Disaster Recovery

Disaster recovery for the NEMS production environment on DigitalOcean
(`nems-prod-cluster`, DOKS nyc3). This directory defines **what** we recover,
**how fast** we intend to, and the **procedures** to do it. Numbers marked
*(target — unvalidated)* become validated only when a real drill measures them
and the result is recorded in a filled copy of
[`recovery-evidence-TEMPLATE.md`](./recovery-evidence-TEMPLATE.md).

## Contents

- [`DR-PLAN.md`](./DR-PLAN.md) — objectives, disaster scenarios, and the recovery
  procedure + validation for each.
- [`cluster-rebuild.md`](./cluster-rebuild.md) — rebuild the entire cluster and
  application from Git + backups, from nothing.
- [`recovery-evidence-TEMPLATE.md`](./recovery-evidence-TEMPLATE.md) — the form a
  drill or a real incident fills in; nothing here is pre-filled.

Single-deployment rollback (a bad release, not a disaster) lives in
[`../runbooks/deployment-rollback.md`](../runbooks/deployment-rollback.md).

## Recovery objectives at a glance

RPO = maximum acceptable data loss. RTO = maximum acceptable time to restore
service. These are the **objectives**; the *measured* column is filled by drills.

| Component | RPO objective | RTO objective | Measured |
|-----------|---------------|---------------|----------|
| PostgreSQL (primary data) | ≤ 24h from repo logical backups; ~minutes where DO managed PITR is available | ≤ 1h *(target — unvalidated)* | restore-test **12 s** / 36 tables (2026-07-30, [drill record](./recovery-evidence-2026-07-30-pg-restore-drill.md)) |
| Qdrant (vector store) | ≤ 24h (daily snapshot) | ≤ 1h *(target — unvalidated)* | TBD (drill) |
| Valkey (cache / rate-limit) | best-effort; loss tolerated (cold cache self-heals) | ≤ 30m *(target — unvalidated)* | TBD (drill) |
| Backend workload (stateless) | n/a (image in DOCR + manifests in Git) | ≤ 30m *(target — unvalidated)* | TBD (drill) |
| Full cluster rebuild | as per each store above | ≤ 4h *(target — unvalidated)* | TBD (drill) |

The PostgreSQL RPO the repo can *guarantee on its own* is 24h (the daily logical
dump). DigitalOcean's managed PITR narrows it to minutes inside the managed
retention window, but that is a second, platform-owned layer — the plan does not
assume it is always available.

## Drill cadence

| Drill | Frequency | Proves |
|-------|-----------|--------|
| PostgreSQL restore-test into scratch DB | monthly | backup is restorable; measures restore RTO input |
| `verify-backup.sh --deep` | daily (CI/cron) | freshest backup exists, is non-empty, parses |
| Qdrant snapshot restore into scratch | quarterly | snapshot is restorable |
| Full cluster-rebuild game-day | quarterly | `cluster-rebuild.md` is accurate end-to-end |
| Backend rollback drill | per release train | `deployment-rollback.md` works |

## Honesty boundary

No disaster has occurred and no drill result is recorded here. Every RTO is a
target until a dated, filled `recovery-evidence-*.md` proves it. Do not cite an
RTO/RPO as *achieved* without that record.
