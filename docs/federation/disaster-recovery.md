# Disaster Recovery

Enterprise resilience: backups, multi-region replication, recovery validation,
high availability, and business continuity. The defining property is that
**recovery procedures can be tested without affecting production data**.

## Backups

A backup is a metadata record — id, scope (`full` | `incremental`), status,
region, size, object count, and duration. Full and incremental backups can be
created on demand. Backups are **metadata, not physical data dumps** (the honest
seam); they model the backup catalog a real DR backend would maintain.

## Multi-region replication

Each region has a replica state — status (`in_sync` | `lagging` | `failed`),
lag in seconds, and last-replicated timestamp. Seeded with US-East and EU-West
in sync and AP-South lagging. `checkReplication` converges lagging replicas
toward in-sync (modeled), so the operator can watch a lagging region recover.

## Recovery validation (sandbox)

`runValidation` validates recovery from a backup **in a sandbox** — it verifies
the backup's integrity and computes RPO and RTO against their targets, then
records a validation marked `sandbox: true`. It **never touches production
data**: the original backups are untouched, no store is overwritten, and the run
is a dry-run against the backup manifest. This is the mechanism that lets you
rehearse recovery safely.

The RPO/RTO math and the integrity guarantee are real; what is modeled is the
physical restore (there is no second cluster to restore into in this milestone).

## High availability & business continuity

The continuity posture carries `haEnabled`, `multiRegion`, the RPO/RTO targets,
the last drill timestamp, and a computed **continuity score** (replica health
40%, HA 25%, multi-region 15%, last validation 20%). The score updates as
replicas converge and validations pass, giving a single number for continuity
readiness.

## IPC

`fed:dr.*` — `backups`, `replicas`, `validations`, `continuity`, `summary`, plus
audited `createBackup`, `runValidation`, and `checkReplication`.
