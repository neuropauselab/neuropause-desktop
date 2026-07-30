# NEMS Observability Platform (Phase 5)

Production-grade observability for the running NEMS backend on
`nems-prod-cluster` (DOKS nyc3, `7750e61a-2636-4220-85ea-aec4120bae40`). Built on
**kube-prometheus-stack** — Prometheus Operator, Grafana, Alertmanager,
node-exporter and kube-state-metrics — plus a **blackbox-exporter** for external
availability and latency SLIs.

Nothing here modifies a Phase 1–4 resource. The backend is scraped as-is via a
`ServiceMonitor`; the edge is probed as-is via `Probe` objects.

## What is wired to real metrics

| Signal | Source (real metric) |
|--------|----------------------|
| Backend up / uptime / memory | `neuropause_backend_up`, `neuropause_backend_uptime_seconds`, `neuropause_backend_resident_memory_bytes`, `neuropause_backend_heap_used_bytes` |
| HTTP volume / error rate | `neuropause_http_requests_total{method,status}` |
| PostgreSQL pool | `neuropause_pg_pool_connections{state}` |
| Dependency up/down transitions | `neuropause_health_alerts_total{component,state}` |
| Redis degradation | `neuropause_ratelimit_fallback_total{bucket}` (fires when Redis is unavailable) + `neuropause_health_alerts_total{component="redis"}` |
| External availability + latency | blackbox `probe_success`, `probe_http_duration_seconds`, `probe_duration_seconds` |
| TLS certificate expiry | blackbox `probe_ssl_earliest_cert_expiry` (and cert-manager metrics if scraped) |
| Node resources | node-exporter `node_*` |
| Pod resources / restarts / status | kube-state-metrics `kube_pod_*`, `kube_deployment_*`, `kube_node_*` + cAdvisor `container_*` |

## Documented gaps (NOT mocked)

These are stated honestly rather than shown as empty/fake panels. They require
**instrumentation in the Phase 1–3 backend code, which Phase 5 must not modify**,
so they are deferred:

- **Per-route / API-endpoint latency histograms.** The backend emits no request
  duration histogram; API latency is measured externally via blackbox against
  `/health` and `/live`, which is a whole-edge SLI, not per-route. A
  `neuropause_http_request_duration_seconds` histogram would need to be added to
  `apps/backend/src/observability/metrics.ts`.
- **OAuth / Store / Business / AI-runtime / Queue metrics.** `neuropause_http_requests_total`
  carries only `method` and `status` (no path/route label), and there is no
  queue or AI-operation counter. Dedicated dashboards for those domains would
  require new counters in the backend. What *is* available (total request
  volume, error ratio, rate-limit fallback, health transitions) is dashboarded;
  the per-domain breakdowns are listed as an instrumentation backlog item.
- **Managed-database internals.** PostgreSQL and Valkey are DigitalOcean managed
  services; their internal metrics (connections, replication lag, cache hit
  ratio) are available from the DigitalOcean monitoring API/console, not from an
  in-cluster exporter. The in-cluster view is limited to the app's own pool
  gauge and dependency-health signal, plus blackbox reachability.
- **Gateway internals.** Cilium/Hubble metrics are only scraped if Cilium metrics
  are enabled on the cluster; the committed `servicemonitor-cilium.yaml` is
  provided but is a no-op until Cilium exposes `/metrics`. Edge availability is
  covered by blackbox regardless.

## Files

| File | Purpose |
|------|---------|
| `kube-prometheus-stack.values.yaml` | Helm values for the stack |
| `servicemonitor-nems-backend.yaml` | scrape the backend `/metrics` |
| `blackbox-exporter.yaml` | external prober (Deployment/Service/Config) |
| `probe-nems-endpoints.yaml` | Probe CRs for `/health`, `/live`, `/metrics`-deny |
| `prometheusrules-nems.yaml` | production alert rules |
| `prometheusrules-slo.yaml` | SLI/SLO recording + burn-rate rules |
| `alertmanager-config.yaml` | severity routing + receiver stubs |
| `dashboards/*.json` | Grafana dashboards (imported by the sidecar) |
| `dashboards-configmap.yaml` | wraps the dashboard JSON as sidecar ConfigMaps |

## Deploy

```sh
# 1. Grafana admin credential (never in git)
kubectl create ns monitoring 2>/dev/null || true
kubectl -n monitoring create secret generic grafana-admin \
  --from-literal=admin-user=admin \
  --from-literal=admin-password="$(openssl rand -base64 24)"

# 2. The stack (installs the CRDs the files below depend on)
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
helm upgrade --install kube-prometheus-stack \
  prometheus-community/kube-prometheus-stack \
  -n monitoring --create-namespace \
  -f deploy/observability/kube-prometheus-stack.values.yaml

# 3. The NEMS-specific objects
kubectl apply -f deploy/observability/blackbox-exporter.yaml
kubectl apply -f deploy/observability/servicemonitor-nems-backend.yaml
kubectl apply -f deploy/observability/probe-nems-endpoints.yaml
kubectl apply -f deploy/observability/prometheusrules-nems.yaml
kubectl apply -f deploy/observability/prometheusrules-slo.yaml
kubectl apply -f deploy/observability/alertmanager-config.yaml
kubectl apply -f deploy/observability/dashboards-configmap.yaml
```

## Validation (must be executed — not asserted here)

This directory delivers *capability*. It has not been deployed by this change,
and no dashboard data or alert history is claimed. After applying the above:

1. `kubectl -n monitoring get pods` — Prometheus, Grafana, Alertmanager,
   node-exporter (one per node), kube-state-metrics, blackbox all Running.
2. Prometheus → Status → Targets: `nems-backend` **UP** and the two Probe jobs
   **UP**. This is the moment the dashboards begin showing real data.
3. `probe_success{instance="https://api.neuropause033.com/health"} == 1`.
4. Grafana → the NEMS dashboards render with live series (not "No data").
5. Fire a synthetic alert (e.g. scale the backend to 0 in a maintenance window,
   or use `amtool`) and confirm it routes through Alertmanager to your receiver.

## Note on the deferred `/metrics` NetworkPolicy (Task 4.9)

Phase 4 recorded the in-cluster `/metrics` NetworkPolicy as deferred until a
scraper existed. That scraper is Prometheus, deployed here. A follow-up
NetworkPolicy restricting backend `:4000` ingress to the monitoring namespace +
the Cilium Gateway can now be designed against a concrete allow-source; it is
tracked in the Phase 5 completion report as a validation-time hardening item,
not applied by this change.
