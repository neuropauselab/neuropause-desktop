# NEMS Disaster Recovery Guide

DR composes on the Wave 14 production DR platform and the Wave 7 cloud-ops backup runtime. Plans and
drills are real records; **real cross-region failover is infrastructure-pending** until DR
infrastructure is configured.

## Backups
- Nightly database backup via `k8s/80-jobs.yaml` (CronJob at 02:00), 30-day retention.
- A backup is **never** marked restorable until a real restore-integrity check passes.

## Recovery plan
1. Provision the DR region (represented in `iac/`).
2. Restore the latest validated snapshot into the DR database.
3. Point DNS/ingress at the DR cluster.
4. Validate `/health/ready` and run a smoke test.

## Objectives
- RPO: 24h (nightly) — tighten with WAL shipping once real infra is configured.
- RTO: target 1h — validated only by real drills against real infrastructure.

Run drills regularly; a drill validates plan structure, not real failover, until infra exists.
