# NEMS Operational Runbooks

One runbook per failure scenario. Each follows the same shape — **Detection,
Diagnosis, Recovery, Validation, Escalation** — and is grounded in the real
production inventory (namespace `nems-prod`, Deployment `nems-backend`, Gateway
`nems-gateway` on `134.199.250.188` / `api.neuropause033.com`, managed PostgreSQL
`nems-prod-pg`, managed Valkey `nems-prod-cache`, in-cluster Qdrant).

These describe how to respond; they record no incidents. The alert rules in
`deploy/observability/prometheusrules-*.yaml` link to these files by
`runbook_url`, so a page lands the responder on the matching runbook.

| Runbook | Responds to |
|---------|-------------|
| [backend-down.md](./backend-down.md) | no healthy replicas, target down, crashloop, availability burn |
| [database-down.md](./database-down.md) | PostgreSQL unavailable or connection pool saturated |
| [redis-down.md](./redis-down.md) | Valkey unavailable / rate-limit fallback engaged |
| [gateway-failure.md](./gateway-failure.md) | edge down while backend healthy; denylist leak |
| [certificate-expiry.md](./certificate-expiry.md) | TLS cert expiring / handshake failing |
| [high-latency.md](./high-latency.md) | elevated latency / latency SLO burn |
| [deployment-rollback.md](./deployment-rollback.md) | roll back a regressing release |
| [disk-full.md](./disk-full.md) | node or PersistentVolume disk pressure |
| [memory-exhaustion.md](./memory-exhaustion.md) | backend near memory limit / OOMKill |
| [node-failure.md](./node-failure.md) | a node NotReady, pods rescheduling |
| [cluster-failure.md](./cluster-failure.md) | API unreachable / cluster lost |
| [oauth-outage.md](./oauth-outage.md) | login / OAuth failing |

Disaster-scale recovery (whole-environment) lives in [`../dr/`](../dr/);
incident process and severities in [`../incident/`](../incident/).
