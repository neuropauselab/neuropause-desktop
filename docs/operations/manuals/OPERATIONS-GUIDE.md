# NEMS Operations Guide

The entry point for running NEMS in production — what the system is, where the
operational surfaces are, and the routine duties. It orients; the detailed
procedures live in the linked documents.

## The system in one paragraph

NEMS is a stateless backend (`nems-backend`, 2 replicas) behind a Cilium gateway
at `https://api.neuropause033.com`, on DOKS `nems-prod-cluster` (nyc3). It
depends on managed PostgreSQL (primary data), managed Valkey (cache /
rate-limit), and in-cluster Qdrant (vectors). Full inventory and invariants are
in the [Production Manual](./PRODUCTION-MANUAL.md).

## Operational surfaces

| Surface | Where | Use it to |
|---------|-------|-----------|
| Dashboards | Grafana (`monitoring`), dashboards in `deploy/observability/dashboards/` | see backend, SLO, k8s, and dependency health |
| Alerts | Prometheus rules `deploy/observability/prometheusrules-*.yaml` → Alertmanager | get paged/ticketed with a runbook link |
| Runbooks | [`../runbooks/`](../runbooks/) | respond to a specific failure |
| SLOs | [`../slo/SLO.md`](../slo/SLO.md) | know the targets and error-budget policy |
| Incident process | [`../incident/`](../incident/) | run and review an incident |
| DR | [`../dr/`](../dr/) | recover from data/cluster loss |
| Capacity | [`../capacity/CAPACITY-PLAN.md`](../capacity/CAPACITY-PLAN.md) | decide when to scale |
| Maintenance | [`../maintenance/MAINTENANCE.md`](../maintenance/MAINTENANCE.md) | upgrades, rotation, routine care |
| Backups | `deploy/backup/` | back up and restore data |

## Golden signals to watch

- **Edge availability** — `probe_success{tier="edge"}` (a failing `/health`
  probe = the service or a dependency is down).
- **Error ratio** — 5xx over total (`neuropause_http_requests_total`).
- **Latency** — `probe_http_duration_seconds` (whole-service; per-route is a
  documented gap).
- **Dependencies** — `neuropause_pg_pool_connections`,
  `neuropause_ratelimit_fallback_total`, `neuropause_health_alerts_total`.
- **Saturation** — CPU/memory of backend pods and nodes.

## When something is wrong

1. Acknowledge the page; read the alert's `runbook_url`.
2. Open the matching [runbook](../runbooks/) and work Detection → Diagnosis →
   Recovery → Validation.
3. If impact is user-facing or growing, declare an incident
   ([`../incident/`](../incident/)) and set a severity.
4. Prefer the smallest fix that restores service (roll back before you rebuild).
5. Validate with the runbook's Validation section before closing.

## Routine duties

| Cadence | Duty |
|---------|------|
| Daily | confirm backups (`verify-backup.sh --deep`); glance at dashboards/alerts |
| Weekly | review alert noise (alert-to-incident ratio); triage SEV3/4 |
| Monthly | PostgreSQL restore-test; capacity review; SLO attainment review |
| Quarterly | DR game-day; cert-renewal check; Alertmanager delivery test |

## Change & release

Spec changes go through Git (`phase-2`, reviewed) and roll out with
maxUnavailable=0. Back out with `../runbooks/deployment-rollback.md`. Respect the
error-budget freeze policy in `../slo/SLO.md`.

## Honesty note

Phase 5 provides the capability and documentation above. The live validations
(scraping, alert delivery, backup/restore, DR) are operator actions listed in the
Phase 5 completion report; do not report them as done until they are executed and
recorded.
