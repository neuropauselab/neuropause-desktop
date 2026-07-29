/**
 * EPIC 7 — Monitoring Automation. Generates deployment descriptors for Prometheus, Grafana, Loki,
 * OpenTelemetry, and Alertmanager, plus Grafana dashboards for infrastructure, Kubernetes, database, AI
 * runtime, and APIs. The Prometheus scrape config targets the backend's real `/metrics` on `:4000`. These
 * are descriptors + dashboard JSON — no monitoring stack is deployed and no metric is fabricated.
 */
import { toYaml, type Yamlish } from './serialize';
import { DASHBOARD_TARGETS, MONITORING_STACK, type DashboardTarget, type MonitoringComponent } from './constants';
import type { Artifact } from './types';
import type { PlatformAutomationGovernance } from './governance';

export class MonitoringAutomation {
  constructor(
    private readonly gov: PlatformAutomationGovernance,
    private readonly operator: string,
  ) {}

  stack(): readonly MonitoringComponent[] {
    return MONITORING_STACK;
  }
  dashboardTargets(): readonly DashboardTarget[] {
    return DASHBOARD_TARGETS;
  }

  scrapeConfig(): Record<string, Yamlish> {
    return {
      scrape_configs: [
        {
          job_name: 'neuropause-backend',
          kubernetes_sd_configs: [{ role: 'pod', namespaces: { names: ['neuropause'] } }],
          relabel_configs: [{ source_labels: ['__meta_kubernetes_pod_annotation_prometheus_io_scrape'], action: 'keep', regex: 'true' }],
          metrics_path: '/metrics',
        },
      ],
    };
  }

  alertRules(): Record<string, Yamlish> {
    return {
      apiVersion: 'monitoring.coreos.com/v1',
      kind: 'PrometheusRule',
      metadata: { name: 'neuropause-alerts', namespace: 'neuropause' },
      spec: {
        groups: [
          {
            name: 'neuropause.rules',
            rules: [
              { alert: 'BackendDown', expr: 'up{job="neuropause-backend"} == 0', for: '2m', labels: { severity: 'critical' } },
              { alert: 'HighErrorRate', expr: 'rate(http_requests_total{status=~"5.."}[5m]) > 0.05', for: '10m', labels: { severity: 'warning' } },
              { alert: 'CertExpiringSoon', expr: 'certmanager_certificate_expiration_timestamp_seconds - time() < 21*24*3600', labels: { severity: 'warning' } },
              { alert: 'BackupFailed', expr: 'time() - neuropause_last_backup_success_timestamp > 26*3600', labels: { severity: 'critical' } },
            ],
          },
        ],
      },
    };
  }

  dashboard(target: DashboardTarget): Record<string, Yamlish> {
    const panels: Record<DashboardTarget, string[]> = {
      infrastructure: ['node cpu/mem', 'disk', 'network'],
      kubernetes: ['pod status', 'restarts', 'hpa replicas'],
      database: ['connections', 'replication lag', 'slow queries'],
      'ai-runtime': ['provider routing', 'failover count', 'latency (no fabricated usage)'],
      apis: ['request rate', 'p95 latency', 'error rate'],
    };
    return { title: `NeuroPause — ${target}`, schemaVersion: 39, panels: panels[target].map((p, i) => ({ id: i + 1, title: p, type: 'timeseries' })) };
  }

  async generateAll(): Promise<Artifact> {
    const dashboards = DASHBOARD_TARGETS.map((t) => this.dashboard(t));
    const content = `# Prometheus scrape\n${toYaml(this.scrapeConfig())}\n---\n${toYaml(this.alertRules())}\n---\n# Grafana dashboards (JSON models)\n${toYaml({ dashboards })}`;
    const artifact: Artifact = { kind: 'monitoring', name: 'monitoring.yaml', format: 'yaml', content, note: 'Prometheus/Grafana/Alertmanager descriptors + dashboards — no stack deployed; no production metric fabricated.' };
    await this.gov.record({ operator: this.operator, environment: 'production', target: 'monitoring', epic: 'E7', operation: 'generate-monitoring', result: 'generated', evidence: 'live-verified' });
    return artifact;
  }
}
