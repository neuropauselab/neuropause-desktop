# NEMS Operations Guide

Day-2 operations compose on the Wave 12 operations plane and the Wave 14 production observability.

## Health endpoints
- `/health/live` — liveness (process up)
- `/health/ready` — readiness (dependencies reachable)
- `/health/startup` — startup gate

## Observability
- Metrics → Prometheus (`monitoring/prometheus.yml`)
- Logs → Loki (`monitoring/loki-config.yml`)
- Traces → OpenTelemetry collector (OTLP endpoint from config)
- Dashboards → Grafana (`monitoring/grafana-dashboard.json`)
- Alerts → Alertmanager (`monitoring/alertmanager.yml`)

## Runbooks
- **High error rate**: check the API dashboard, recent releases, and `kubectl logs`; roll back via
  `rollback.yml` if a release regressed.
- **Pod crashloop**: `kubectl describe pod`; check readiness/liveness and secret injection.
- **DB saturation**: check `postgres-exporter` metrics; scale reads / increase pool.

No telemetry is fabricated — dashboards read 0 until real environments emit metrics.
