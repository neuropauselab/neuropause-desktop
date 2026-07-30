#!/usr/bin/env python3
# Generates NEMS Grafana dashboards as JSON. Every panel query targets a metric
# that actually exists (app /metrics, node-exporter, kube-state-metrics,
# cAdvisor, or blackbox). Panels that would need un-instrumented metrics are
# omitted, not mocked. Datasource is a dashboard variable so it stays portable.
import json
import os

DS = "${datasource}"
OUT = os.path.dirname(os.path.abspath(__file__)) + "/dashboards"


def target(expr, legend="", fmt="time_series"):
    return {"datasource": {"type": "prometheus", "uid": DS}, "expr": expr,
            "legendFormat": legend, "format": fmt, "range": True}


def panel(pid, title, x, y, w, h, exprs, ptype="timeseries", unit="short",
          desc=""):
    p = {
        "id": pid, "title": title, "type": ptype, "description": desc,
        "datasource": {"type": "prometheus", "uid": DS},
        "gridPos": {"h": h, "w": w, "x": x, "y": y},
        "targets": [target(e[0], e[1]) for e in exprs],
        "fieldConfig": {"defaults": {"unit": unit, "custom": {}}, "overrides": []},
        "options": {},
    }
    if ptype == "stat":
        p["options"] = {"reduceOptions": {"calcs": ["lastNotNull"]},
                        "colorMode": "value", "graphMode": "area"}
    return p


def dashboard(uid, title, tags, panels):
    return {
        "uid": uid, "title": title, "tags": tags, "schemaVersion": 39,
        "version": 1, "editable": True, "refresh": "30s",
        "time": {"from": "now-6h", "to": "now"},
        "templating": {"list": [{
            "name": "datasource", "type": "datasource", "query": "prometheus",
            "current": {}, "hide": 0, "label": "Data source",
        }]},
        "panels": panels,
    }


# --------------------------------------------------------------- backend overview
backend = dashboard("nems-backend-overview", "NEMS — Backend Overview",
                    ["nems", "backend"], [
    panel(1, "Backend target up", 0, 0, 4, 4,
          [("up{job=\"nems-backend\"}", "{{pod}}")], "stat", "bool",
          "1 = Prometheus is scraping the backend pod."),
    panel(2, "Available replicas", 4, 0, 4, 4,
          [("kube_deployment_status_replicas_available{namespace=\"nems-prod\",deployment=\"nems-backend\"}", "available")],
          "stat", "short"),
    panel(3, "Uptime", 8, 0, 4, 4,
          [("max(neuropause_backend_uptime_seconds)", "uptime")], "stat", "s"),
    panel(4, "Edge availability (/health probe)", 12, 0, 6, 4,
          [("min(probe_success{tier=\"edge\",instance=\"https://api.neuropause033.com/health\"})", "healthy")],
          "stat", "bool", "/health returns 200 only when DB AND Redis are up, so this is a composite dependency-up signal."),
    panel(5, "TLS cert days remaining", 18, 0, 6, 4,
          [("(min(probe_ssl_earliest_cert_expiry{tier=\"edge\"}) - time()) / 86400", "days")],
          "stat", "d"),
    panel(10, "HTTP request rate by status", 0, 4, 12, 8,
          [("sum by (status) (rate(neuropause_http_requests_total[5m]))", "{{status}}")],
          "timeseries", "reqps"),
    panel(11, "5xx error ratio", 12, 4, 12, 8,
          [("(sum(rate(neuropause_http_requests_total{status=~\"5..\"}[5m])) or vector(0)) / clamp_min(sum(rate(neuropause_http_requests_total[5m])),0.001)", "5xx ratio")],
          "timeseries", "percentunit"),
    panel(12, "Memory: RSS & heap", 0, 12, 12, 8,
          [("max(neuropause_backend_resident_memory_bytes)", "rss"),
           ("max(neuropause_backend_heap_used_bytes)", "heap used")],
          "timeseries", "bytes"),
    panel(13, "Working set vs 512Mi limit", 12, 12, 12, 8,
          [("max by (pod) (container_memory_working_set_bytes{namespace=\"nems-prod\",container=\"backend\"}) / on(pod) group_left max by (pod)(kube_pod_container_resource_limits{namespace=\"nems-prod\",container=\"backend\",resource=\"memory\"})", "{{pod}}")],
          "timeseries", "percentunit"),
    panel(14, "Rate-limit fallback (Redis degraded)", 0, 20, 12, 6,
          [("sum by (bucket) (rate(neuropause_ratelimit_fallback_total[5m]))", "{{bucket}}")],
          "timeseries", "short",
          "Nonzero means Valkey was unavailable and per-instance fallback engaged."),
    panel(15, "PG pool connections", 12, 20, 12, 6,
          [("sum by (state) (neuropause_pg_pool_connections)", "{{state}}")],
          "timeseries", "short"),
])

# --------------------------------------------------------- SLO / availability
slo = dashboard("nems-slo", "NEMS — SLO / Latency / Availability",
                ["nems", "slo"], [
    panel(1, "Edge availability now", 0, 0, 6, 4,
          [("min(probe_success{tier=\"edge\"})", "up")], "stat", "bool"),
    panel(2, "Edge availability (24h)", 6, 0, 6, 4,
          [("avg_over_time(probe_success{tier=\"edge\",instance=\"https://api.neuropause033.com/health\"}[24h])", "24h")],
          "stat", "percentunit"),
    panel(3, "Latency SLI (30m, <=0.5s)", 12, 0, 6, 4,
          [("nems:slo_edge_latency:ratio_rate30m", "fast fraction")], "stat", "percentunit"),
    panel(4, "App success (1h)", 18, 0, 6, 4,
          [("1 - nems:slo_app_errors:ratio_rate1h", "non-5xx")], "stat", "percentunit"),
    panel(10, "Probe success over time", 0, 4, 12, 8,
          [("probe_success{tier=\"edge\"}", "{{instance}}")], "timeseries", "bool"),
    panel(11, "Edge HTTP duration", 12, 4, 12, 8,
          [("probe_duration_seconds{tier=\"edge\"}", "{{instance}}")],
          "timeseries", "s"),
    panel(12, "Availability error-budget burn (1h window)", 0, 12, 12, 8,
          [("nems:slo_edge_errors:ratio_rate1h / 0.001", "burn multiple (x of 0.1% budget)")],
          "timeseries", "short",
          "Value > 1 means the 99.9% budget is being consumed faster than sustainable."),
    panel(13, "App 5xx ratio (5m/1h/6h)", 12, 12, 12, 8,
          [("nems:slo_app_errors:ratio_rate5m", "5m"),
           ("nems:slo_app_errors:ratio_rate1h", "1h"),
           ("nems:slo_app_errors:ratio_rate6h", "6h")],
          "timeseries", "percentunit"),
])

# --------------------------------------------------------------- k8s resources
k8s = dashboard("nems-kubernetes", "NEMS — Kubernetes Resources",
                ["nems", "kubernetes"], [
    panel(1, "Nodes Ready", 0, 0, 6, 4,
          [("sum(kube_node_status_condition{condition=\"Ready\",status=\"true\"})", "ready")],
          "stat", "short"),
    panel(2, "Backend pod restarts (total)", 6, 0, 6, 4,
          [("sum(kube_pod_container_status_restarts_total{namespace=\"nems-prod\",container=\"backend\"})", "restarts")],
          "stat", "short"),
    panel(10, "Node CPU utilisation", 0, 4, 12, 8,
          [("1 - avg by (instance) (rate(node_cpu_seconds_total{mode=\"idle\"}[5m]))", "{{instance}}")],
          "timeseries", "percentunit"),
    panel(11, "Node memory used", 12, 4, 12, 8,
          [("1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)", "{{instance}}")],
          "timeseries", "percentunit"),
    panel(12, "Node filesystem free", 0, 12, 12, 8,
          [("node_filesystem_avail_bytes{fstype!~\"tmpfs|overlay\"} / node_filesystem_size_bytes{fstype!~\"tmpfs|overlay\"}", "{{instance}} {{mountpoint}}")],
          "timeseries", "percentunit"),
    panel(13, "Backend pod CPU", 12, 12, 12, 8,
          [("sum by (pod) (rate(container_cpu_usage_seconds_total{namespace=\"nems-prod\",container=\"backend\"}[5m]))", "{{pod}}")],
          "timeseries", "short"),
    panel(14, "Backend pod memory (working set)", 0, 20, 12, 8,
          [("max by (pod) (container_memory_working_set_bytes{namespace=\"nems-prod\",container=\"backend\"})", "{{pod}}")],
          "timeseries", "bytes"),
    panel(15, "PVC free (monitoring storage)", 12, 20, 12, 8,
          [("kubelet_volume_stats_available_bytes / kubelet_volume_stats_capacity_bytes", "{{persistentvolumeclaim}}")],
          "timeseries", "percentunit"),
])

# --------------------------------------------------------------- dependencies
deps = dashboard("nems-dependencies", "NEMS — Database & Redis",
                 ["nems", "dependencies"], [
    panel(1, "Dependencies healthy (/health 200)", 0, 0, 8, 4,
          [("min(probe_success{tier=\"edge\",instance=\"https://api.neuropause033.com/health\"})", "db&redis up")],
          "stat", "bool",
          "/health is 200 only when both PostgreSQL and Valkey answer; this is the composite up signal."),
    panel(2, "Liveness (/live 200)", 8, 0, 8, 4,
          [("min(probe_success{tier=\"edge\",instance=\"https://api.neuropause033.com/live\"})", "process up")],
          "stat", "bool"),
    panel(3, "PG pool waiting", 16, 0, 8, 4,
          [("max(neuropause_pg_pool_connections{state=\"waiting\"})", "waiting")], "stat", "short"),
    panel(10, "PostgreSQL pool connections", 0, 4, 12, 8,
          [("sum by (state) (neuropause_pg_pool_connections)", "{{state}}")],
          "timeseries", "short"),
    panel(11, "Dependency up/down transitions (1h)", 12, 4, 12, 8,
          [("sum by (component,state) (increase(neuropause_health_alerts_total[1h]))", "{{component}}/{{state}}")],
          "timeseries", "short",
          "Edge-triggered: each bump is a component flipping up<->down."),
    panel(12, "Redis fallback engagements", 0, 12, 24, 6,
          [("sum by (bucket) (increase(neuropause_ratelimit_fallback_total[15m]))", "{{bucket}}")],
          "timeseries", "short",
          "Managed Valkey internals (memory, hit ratio) are in the DigitalOcean console; this is the app-visible degradation signal."),
])

for d in (backend, slo, k8s, deps):
    open("%s/%s.json" % (OUT, d["uid"]), "w").write(json.dumps(d, indent=2))
    print("wrote", d["uid"] + ".json", "panels:", len(d["panels"]))
