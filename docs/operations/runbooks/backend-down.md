# Runbook — Backend unavailable

**Scenario:** The `nems-backend` workload has no healthy replicas, its Prometheus target is down, or it is crash-looping.
**Fires as:** SEV1 (no replicas / edge down) to SEV2 (degraded)
**Owner:** platform-oncall
**Backing alerts:** BackendNoHealthyReplicas, BackendTargetDown, BackendCrashLooping, EdgeDown, SLOAvailabilityFastBurn

> Operational runbook. It describes how to respond; it records no incident.
> Commands assume `kubectl` context on `nems-prod-cluster` and, where noted,
> `doctl` authenticated to the DigitalOcean account.

## Detection

- Pager: `BackendNoHealthyReplicas`, `BackendTargetDown`, or `BackendCrashLooping`.
- `EdgeDown` and/or `SLOAvailabilityFastBurn` firing at the same time.
- External check fails: `curl -sS -o /dev/null -w '%{http_code}\n' https://api.neuropause033.com/health` is not 200.

## Diagnosis

- Pod state: `kubectl -n nems-prod get pods -l app.kubernetes.io/name=nems-backend -o wide`.
- Why not ready: `kubectl -n nems-prod describe pod <pod>` (events: image pull, OOMKilled, probe failures) and `kubectl -n nems-prod logs <pod> --previous`.
- Recent change: `kubectl -n nems-prod rollout history deployment/nems-backend`; compare the running image to the last known-good digest `sha256:997f8737…d00bbe6` (tag `backend-v0.1.0-rc.4`).
- Dependency vs. app: is `/live` up but `/health` down? `/health` is 200 only when PostgreSQL **and** Valkey answer, so a failing `/health` with a live process points at a dependency — check `neuropause_health_alerts_total` and the DB/Redis runbooks.
- Resource: `BackendOOMKilled` / restarts → see `memory-exhaustion.md`.

## Recovery

- **Bad deploy** → roll back per `deployment-rollback.md` (`kubectl -n nems-prod rollout undo deployment/nems-backend`, or pin digest `997f8737…`). RollingUpdate is `maxUnavailable=0`, so a good replacement comes up before the bad one leaves.
- **Dependency down** → follow `database-down.md` / `redis-down.md`; do not thrash the backend.
- **Node problem** → `node-failure.md`.
- **Nothing obviously wrong** → `kubectl -n nems-prod rollout restart deployment/nems-backend` and watch.

## Validation

- `kubectl -n nems-prod rollout status deployment/nems-backend` returns success (2/2 available).
- External `https://api.neuropause033.com/health` returns 200; `/live` returns 200.
- Prometheus target `nems-backend` is UP; 5xx ratio and probe success back to normal; SLO burn alerts cleared.

## Escalation

- Not restored within the SEV1 target, or repeated crashloop after rollback → page the secondary and raise to the Incident Commander.
- Suspected data loss/corruption → declare a disaster and open `../dr/DR-PLAN.md`.

## Related

`deployment-rollback.md`, `database-down.md`, `redis-down.md`, `memory-exhaustion.md`, `../dr/DR-PLAN.md`
