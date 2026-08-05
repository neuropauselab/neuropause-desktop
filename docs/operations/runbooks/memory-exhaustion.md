# Runbook — Backend memory exhaustion / OOMKill

**Scenario:** The backend container is approaching or hitting its memory limit and may be OOMKilled.
**Fires as:** SEV2 (approaching) to SEV1 (repeated OOM)
**Owner:** platform-oncall
**Backing alerts:** BackendHighMemory, BackendOOMKilled

> Operational runbook. It describes how to respond; it records no incident.
> Commands assume `kubectl` context on `nems-prod-cluster` and, where noted,
> `doctl` authenticated to the DigitalOcean account.

## Detection

- `BackendHighMemory` (working set > 90% of the 512Mi limit) or `BackendOOMKilled`; rising restart count.

## Diagnosis

- Working set vs limit: `max by (pod)(container_memory_working_set_bytes{namespace="nems-prod",container="backend"})` against the 512Mi limit (requests are 256Mi).
- App view: `neuropause_backend_resident_memory_bytes` and `neuropause_backend_heap_used_bytes` trend — steady climb (leak) vs. load-correlated spike.
- Restarts: `kube_pod_container_status_restarts_total{namespace="nems-prod",container="backend"}`.
- Correlate with a recent deploy (possible leak introduced) or a traffic spike.

## Recovery

- Immediate relief: `kubectl -n nems-prod rollout restart deployment/nems-backend` (maxUnavailable=0 keeps service up); scale out to spread load.
- Legitimate growth → raise the memory limit on the Deployment (a deliberate spec change from 512Mi) and re-apply.
- Suspected leak from a release → `deployment-rollback.md` and hand to engineering.

## Validation

- Working set stable well below the limit; no new OOMKills; restart count flat; latency normal.

## Escalation

- Recurring OOM after restart/scale → SEV2, Incident Commander, and engineering for a heap investigation; capacity review.

## Related

`backend-down.md`, `deployment-rollback.md`, `high-latency.md`, `../capacity/CAPACITY-PLAN.md`
