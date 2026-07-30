# NEMS Architecture Operations Manual

The production architecture from an operator's lens: the request path, what each
hop depends on, how it fails, and what signal tells you. This **describes** the
existing Phase 1–4 architecture (which is immutable); it does not redesign it.
Inventory is in the [Production Manual](./PRODUCTION-MANUAL.md).

## Request path

```
Client (HTTPS)
   │  DNS: api.neuropause033.com -> 134.199.250.188
   ▼
DigitalOcean Load Balancer  (:443)
   ▼
Cilium Gateway  nems-gateway   listener https/443, TLS secret api-neuropause033-tls
   ▼
HTTPRoute  nems-backend   (10 path prefixes; /metrics deliberately NOT routed)
   ▼
Service  nems-backend  (:80 -> containerPort 4000)
   ▼
Pods  nems-backend  x2   (/live, /health)
   ├──► PostgreSQL  nems-prod-pg   (managed, private 10.20.0.6:25060/25061)
   ├──► Valkey      nems-prod-cache (managed, :25061)
   └──► Qdrant      (in-cluster ClusterIP, PVC)
```

Scraping is a separate, in-cluster path: Prometheus (`monitoring`) →
`nems-backend:/metrics` (ServiceMonitor) and → the edge via blackbox probes.
`/metrics` is not reachable from the internet.

## Per-hop: dependency, failure mode, signal, runbook

| Hop | Depends on | Fails when | Signal | Runbook |
|-----|-----------|------------|--------|---------|
| DNS | registrar / DO DNS | record wrong or LB IP changed | edge probe down, DNS mismatch | [gateway-failure](../runbooks/gateway-failure.md) |
| Load balancer | DO LB | LB unhealthy / IP change | `EdgeDown` with pods healthy | [gateway-failure](../runbooks/gateway-failure.md) |
| Gateway | Cilium, TLS secret | not `Programmed`, cert invalid | `EdgeDown`, TLS errors, `CertificateExpiring*` | [gateway-failure](../runbooks/gateway-failure.md), [certificate-expiry](../runbooks/certificate-expiry.md) |
| HTTPRoute | Gateway attachment | not `Accepted`/`ResolvedRefs`; `/metrics` leak | routes 404/503; `DenylistLeak` | [gateway-failure](../runbooks/gateway-failure.md) |
| Backend pods | image, node, config | crashloop, OOM, bad deploy | `Backend*` alerts, 5xx, restarts | [backend-down](../runbooks/backend-down.md), [memory-exhaustion](../runbooks/memory-exhaustion.md) |
| PostgreSQL | managed DB, trusted source | unreachable / pool saturated / corrupt | `DatabaseUnavailable`, `DatabasePoolSaturated` | [database-down](../runbooks/database-down.md) |
| Valkey | managed cache | unreachable | `RedisUnavailable`, `RedisFallbackEngaged` | [redis-down](../runbooks/redis-down.md) |
| Qdrant | in-cluster PVC | pod/PVC lost | vector ops fail | DR [§3](../dr/DR-PLAN.md) |
| Node | pool `nems-prod-pool-1` | NotReady, disk pressure | `NodeNotReady`, `NodeDiskPressure` | [node-failure](../runbooks/node-failure.md), [disk-full](../runbooks/disk-full.md) |

## Failure-domain notes

- **Managed stores are independent of the cluster.** Losing the cluster does not
  by itself lose PostgreSQL/Valkey; Qdrant, being in-cluster, is lost with it.
  This shapes DR (see [cluster-rebuild](../dr/cluster-rebuild.md)).
- **Graceful degradation on Valkey loss.** The backend falls back to per-instance
  rate limiting (`neuropause_ratelimit_fallback_total`) instead of hard-failing —
  a Valkey outage is usually degradation, not an outage.
- **`/health` is composite.** It is 200 only when PostgreSQL and Valkey both
  answer, so a single probe covers "process up + core dependencies up." `/live`
  is process-only.
- **Stateless backend.** No session affinity or local state; recovery is
  redeploy/scale, and rollback is safe except across a deliberate DB migration
  (`RUN_MIGRATIONS_ON_BOOT=false` — migrations are not automatic).

## Health-signal source of truth

| Component | Primary signal |
|-----------|----------------|
| Backend process | `/live`, `up{job="nems-backend"}` |
| Backend + core deps | `/health`, `probe_success{tier="edge",instance=".../health"}` |
| PostgreSQL | `neuropause_pg_pool_connections`, `neuropause_health_alerts_total{component="database"}` |
| Valkey | `neuropause_ratelimit_fallback_total`, `neuropause_health_alerts_total{component="redis"}` |
| Edge/TLS | `probe_success`, `probe_http_duration_seconds`, `probe_ssl_earliest_cert_expiry` |
| Nodes | node-exporter + kube-state-metrics series |

## Known instrumentation gaps (do not invent data for these)

No per-route/path metrics, no request-latency histogram, no OAuth/store/AI/queue
metrics — the backend code is immutable in this phase. Latency is whole-service
and measured at the edge. Managed-DB internals (memory, hit ratio) live in the DO
console. These are documented backlog items in `deploy/observability/README.md`,
not mocked.
