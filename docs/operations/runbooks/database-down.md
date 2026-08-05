# Runbook — PostgreSQL unavailable or pool saturated

**Scenario:** The managed PostgreSQL `nems-prod-pg` is unreachable, erroring, or the app's connection pool is saturated.
**Fires as:** SEV1 (unavailable) to SEV2 (pool saturated)
**Owner:** platform-oncall
**Backing alerts:** DatabaseUnavailable, DatabasePoolSaturated

> Operational runbook. It describes how to respond; it records no incident.
> Commands assume `kubectl` context on `nems-prod-cluster` and, where noted,
> `doctl` authenticated to the DigitalOcean account.

## Detection

- Pager: `DatabaseUnavailable` (derived from `neuropause_health_alerts_total{component="database"}` down-transitions) or `DatabasePoolSaturated` (`neuropause_pg_pool_connections{state="waiting"} > 0`).
- Backend 5xx rising; `/health` failing while `/live` is up.

## Diagnosis

- Reachability vs. data: is the instance down, or is it up but the app can't connect?
- Instance health: `doctl databases get 406985e0-bb6d-49b2-bcae-6d996acd5843` (managed PostgreSQL `nems-prod-pg`, private `10.20.0.6:25060`, pooler `:25061`).
- Trusted sources: confirm the cluster is still authorized (`doctl databases firewalls list 406985e0-…`) — a lost trusted-source rule blocks all pods. **No `0.0.0.0/0` should ever appear here.**
- Pool: `neuropause_pg_pool_connections{state=total|idle|waiting}` — sustained `waiting>0` with high `total` is a leak or slow queries, not an outage.
- Logs: `kubectl -n nems-prod logs deploy/nems-backend | grep -i -E 'econn|timeout|ssl|password'` (the rc.5 line addressed a TLS `pingDatabase` issue — watch for TLS errors).

## Recovery

- **Connectivity** (trusted source / networking) → restore the firewall rule / VPC path; do not restore data.
- **Instance down** → let DO fail over, or restart/restore the managed instance from the console/`doctl`.
- **Pool saturated** → find and kill slow queries; if a leak, `kubectl -n nems-prod rollout restart deployment/nems-backend` to reset pools; consider adding replicas only if load-driven.
- **Data corruption / loss** → this is a disaster: `../dr/DR-PLAN.md` §2. Restore into a **scratch** DB first (`deploy/backup/pg-restore-job.yaml`), validate, then restore to prod **only** on Incident-Commander authorization (managed PITR gives the tightest RPO).

## Validation

- `/health` returns 200; `neuropause_pg_pool_connections{state="waiting"}` back to 0.
- An authenticated read path (e.g. `/organizations`) returns expected data.
- `DatabaseUnavailable` / `DatabasePoolSaturated` cleared.

## Escalation

- Managed-instance fault you cannot clear → DigitalOcean support with database id `406985e0-…`.
- Any data restore → Incident Commander + `../dr/DR-PLAN.md`; a restore to production is never done without explicit authorization.

## Related

`backend-down.md`, `../dr/DR-PLAN.md`, `../../deploy/backup/README.md`
