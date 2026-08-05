# Runbook — High latency / latency SLO at risk

**Scenario:** Edge request latency is elevated and the latency SLO (99% ≤ 0.5s) is burning.
**Fires as:** SEV2/SEV3
**Owner:** platform-oncall
**Backing alerts:** HighLatency, HighLatencyCritical, SLOLatencyBudgetBurn

> Operational runbook. It describes how to respond; it records no incident.
> Commands assume `kubectl` context on `nems-prod-cluster` and, where noted,
> `doctl` authenticated to the DigitalOcean account.

## Detection

- `HighLatency` (avg `probe_duration_seconds` > 1s) or `HighLatencyCritical` (> 3s); `SLOLatencyBudgetBurn`.

## Diagnosis

- Scope: the edge probe is **whole-service** (there is no per-route histogram — a documented instrumentation gap), so latency is measured across the service, not per endpoint.
- Backend CPU: `sum by (pod)(rate(container_cpu_usage_seconds_total{namespace="nems-prod",container="backend"}[5m]))` — saturation?
- Memory/GC pressure: `neuropause_backend_heap_used_bytes` vs limit; frequent GC.
- Dependency latency: `neuropause_pg_pool_connections{state="waiting"}>0` (slow DB) or `neuropause_ratelimit_fallback_total` rising (Valkey degraded).
- Node saturation: `1 - avg by (instance)(rate(node_cpu_seconds_total{mode="idle"}[5m]))`.
- Change correlation: did latency rise right after a deploy?

## Recovery

- Load-driven → scale replicas up (`kubectl -n nems-prod scale deployment/nems-backend --replicas=N`).
- Dependency-driven → address `database-down.md` / `redis-down.md`.
- Regression from a deploy → `deployment-rollback.md`.
- Node CPU saturation → `node-failure.md` / add capacity.

## Validation

- `probe_duration_seconds` back under target; `nems:slo_edge_latency:ratio_rate30m` recovers ≥ 0.99; burn alert clears.

## Escalation

- Sustained burn threatening the SLO → SEV2 and Incident Commander; open capacity review (`../capacity/`).

## Related

`database-down.md`, `redis-down.md`, `deployment-rollback.md`, `memory-exhaustion.md`
