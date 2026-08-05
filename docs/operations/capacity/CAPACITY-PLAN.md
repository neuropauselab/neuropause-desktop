# NEMS Capacity Plan

How much headroom the production environment has, how to **measure** it (rather
than guess), and the thresholds at which to add capacity. Provisioned figures
below are read from the running specs and are real. Current *utilisation* is not
printed here — it is a live number the observability stack measures; this plan
gives the queries and the act-on thresholds.

## Method

Capacity is managed by measurement, not assertion. For every resource there is
(1) what is provisioned, (2) a PromQL/console query to read current use, and
(3) a threshold that triggers action. Do not record a utilisation number here
without a dated measurement behind it.

## Provisioned resources (from the running specs)

| Resource | Provisioned | Notes |
|----------|-------------|-------|
| Backend replicas | 2 | Deployment `nems-backend`, RollingUpdate maxUnavailable=0/maxSurge=1 |
| Backend CPU | request 100m, limit 1 (per pod) | stateless; scales horizontally |
| Backend memory | request 256Mi, limit 512Mi (per pod) | OOM/limit behaviour in `../runbooks/memory-exhaustion.md` |
| Nodes | 3 × pool `nems-prod-pool-1` | node size set at cluster creation |
| Prometheus storage | 50Gi PVC, `retentionSize=40GB`, 30d | retentionSize caps growth below the PVC |
| Grafana storage | 5Gi PVC | |
| Alertmanager storage | 5Gi PVC | |
| Qdrant storage | in-cluster PVC | grows with vector count |
| PostgreSQL | managed `nems-prod-pg` (pg18) | sized/scaled in the DO console |
| Valkey | managed `nems-prod-cache` (valkey8) | sized/scaled in the DO console |

## Compute headroom

**Measure** node allocatable vs. the sum of pod requests:

```promql
# CPU requested vs allocatable, per node
sum by (node) (kube_pod_container_resource_requests{resource="cpu"})
  / on(node) kube_node_status_allocatable{resource="cpu"}

# Memory requested vs allocatable, per node
sum by (node) (kube_pod_container_resource_requests{resource="memory"})
  / on(node) kube_node_status_allocatable{resource="memory"}

# Actual backend usage vs its limits
sum by (pod)(rate(container_cpu_usage_seconds_total{namespace="nems-prod",container="backend"}[5m]))
max by (pod)(container_memory_working_set_bytes{namespace="nems-prod",container="backend"})
```

Because backend requests are small (100m CPU / 256Mi), many replicas fit per
node; the practical limits are node allocatable and the per-pod 512Mi/1-CPU
ceilings. Compute "how many more backend pods fit" as
`min(free_cpu/100m, free_mem/256Mi)` per node from the queries above.

## Scaling triggers (act when…)

| Signal | Threshold | Action |
|--------|-----------|--------|
| Backend CPU (usage/limit) sustained | > 70% for 30m | add a replica (`kubectl -n nems-prod scale deploy/nems-backend --replicas=N`) |
| Backend memory working set / limit | > 80% sustained | raise the 512Mi limit (deliberate spec change) or add replicas; check for a leak first |
| Latency SLO burn with healthy deps | `SLOLatencyBudgetBurn` firing | scale out; see `../runbooks/high-latency.md` |
| Node CPU requested / allocatable | > 75% across the pool | add a node to `nems-prod-pool-1` |
| Node memory requested / allocatable | > 75% across the pool | add a node |
| Pods Pending for capacity | any sustained | add a node |

Horizontal (more replicas) is the default because the backend is stateless.
Vertical (raise per-pod limits) is for genuine per-request memory growth, and is
a deliberate Deployment change reviewed like any other.

## Storage growth

- **Prometheus:** `retentionSize=40GB` bounds the TSDB below the 50Gi PVC. Watch
  `kubelet_volume_stats_available_bytes / kubelet_volume_stats_capacity_bytes`;
  if it trends down despite the cap, investigate cardinality. Runbook:
  `../runbooks/disk-full.md`.
- **Qdrant:** grows with vectors — track the PVC free ratio and forecast from the
  measured slope; expand the PVC (DO block storage supports online expansion)
  before it crosses 15% free.
- **Managed DB storage:** shown in the DO console; expand there. Not covered by
  node/PVC alerts.
- **Spaces backups:** bounded by the 30-day lifecycle rule
  (`deploy/backup/spaces-lifecycle.json`); size ≈ daily dump size × retention.

## Data stores (managed)

Scale PostgreSQL/Valkey in the DO console (vertical resize, or read replicas for
PG). Watch: connection count vs. the plan's max (app side:
`neuropause_pg_pool_connections`), storage used, and CPU (DO metrics). Sustained
`neuropause_pg_pool_connections{state="waiting"}>0` is a sizing or query-efficiency
signal — see `../runbooks/database-down.md`.

## Cost drivers

The recurring cost is the sum of: 3 cluster nodes, managed PostgreSQL, managed
Valkey, the load balancer, block-storage PVCs (Prometheus/Grafana/Alertmanager/
Qdrant), and Spaces backup storage/egress. Pull actual amounts from DO billing;
this plan does not estimate dollar figures. Right-sizing levers, cheapest first:
tune Prometheus retention, keep replicas matched to measured load, and resize
managed databases to the observed working set.

## Review cadence

Review monthly, and whenever a scaling trigger fires or a launch is expected to
change load. Each review: record the measured utilisation (with date), compare
to the thresholds, and note any provisioning change. Forecast from the measured
trend — never from an unmeasured guess.
