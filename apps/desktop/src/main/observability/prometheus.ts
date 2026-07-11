/**
 * Prometheus text-exposition of the platform's existing telemetry (P3.0, Increment 9).
 *
 * Reuses the Ecosystem gateway metrics (request counters + p95 latency, already
 * computed from the audit trail) and the NeuroCore system-health snapshot (score,
 * uptime, throughput, per-subsystem level). Pure formatter — it invents no metric,
 * it only renders what the runtime already measures in the `text/plain; version=0.0.4`
 * format a Prometheus scraper ingests.
 */
import type { GatewayMetrics, SystemHealthLevel, SystemHealthSnapshot } from '@neuropause/shared';

/** A subsystem is "up" (1) when healthy or degraded, "down" (0) when critical/offline. */
function levelUp(level: SystemHealthLevel): 0 | 1 {
  return level === 'healthy' || level === 'degraded' || level === 'unknown' ? 1 : 0;
}

function escapeLabel(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function renderLabels(labels?: Record<string, string>): string {
  if (!labels) return '';
  const parts = Object.entries(labels).map(([k, v]) => `${k}="${escapeLabel(v)}"`);
  return parts.length ? `{${parts.join(',')}}` : '';
}

interface Sample {
  labels?: Record<string, string>;
  value: number;
}

class Exposition {
  private lines: string[] = [];

  metric(name: string, help: string, type: 'counter' | 'gauge', samples: Sample[]): this {
    if (samples.length === 0) return this;
    this.lines.push(`# HELP ${name} ${help}`);
    this.lines.push(`# TYPE ${name} ${type}`);
    for (const s of samples) this.lines.push(`${name}${renderLabels(s.labels)} ${numeric(s.value)}`);
    return this;
  }

  single(name: string, help: string, type: 'counter' | 'gauge', value: number): this {
    return this.metric(name, help, type, [{ value }]);
  }

  toString(): string {
    return `${this.lines.join('\n')}\n`;
  }
}

/** Format a value the way Prometheus expects (finite number, or 0 as a safe default). */
function numeric(v: number): string {
  return Number.isFinite(v) ? String(v) : '0';
}

/**
 * Render the gateway metrics + health snapshot as Prometheus exposition text.
 * All series are namespaced `neuropause_`.
 */
export function toPrometheus(metrics: GatewayMetrics, health: SystemHealthSnapshot): string {
  const e = new Exposition();

  e.single('neuropause_gateway_requests_total', 'Total gateway requests over the window.', 'counter', metrics.requests);
  e.single('neuropause_gateway_requests_allowed_total', 'Requests allowed by the gateway.', 'counter', metrics.allowed);
  e.single('neuropause_gateway_requests_denied_total', 'Requests denied by the gateway.', 'counter', metrics.denied);
  e.single('neuropause_gateway_requests_rate_limited_total', 'Requests rejected for rate limiting (429).', 'counter', metrics.rateLimited);
  e.single('neuropause_gateway_requests_unauthorized_total', 'Requests rejected for auth/scope (401/403).', 'counter', metrics.unauthorized);
  e.single('neuropause_gateway_request_latency_p95_ms', 'p95 gateway request latency over the window (ms).', 'gauge', metrics.p95LatencyMs);
  e.metric(
    'neuropause_gateway_requests_by_status_total',
    'Gateway requests partitioned by HTTP status.',
    'counter',
    Object.entries(metrics.byStatus).map(([status, value]) => ({ labels: { status }, value })),
  );
  e.metric(
    'neuropause_gateway_requests_by_version_total',
    'Gateway requests partitioned by API version.',
    'counter',
    Object.entries(metrics.byVersion).map(([version, value]) => ({ labels: { version }, value })),
  );

  e.single('neuropause_health_score', 'Aggregate system-health score (0–100).', 'gauge', health.score);
  e.single('neuropause_uptime_seconds', 'Process uptime in seconds.', 'gauge', Math.round(health.uptimeMs / 1000));
  e.single('neuropause_events_per_minute', 'Platform event-bus throughput (events/min).', 'gauge', health.throughput.eventsPerMinute);
  e.single('neuropause_event_dispatch_ms', 'Average platform event dispatch time (ms).', 'gauge', health.throughput.avgDispatchMs);
  e.single('neuropause_cpu_percent', 'Process CPU utilisation (percent).', 'gauge', health.telemetry.cpuPercent);
  e.single('neuropause_memory_used_mb', 'Process memory in use (MB).', 'gauge', health.telemetry.memoryUsedMb);
  e.single('neuropause_automation_failed_total', 'Automation runs that failed.', 'counter', health.automation.failed);
  e.single('neuropause_automation_completed_total', 'Automation runs that completed.', 'counter', health.automation.completed);
  e.metric(
    'neuropause_subsystem_up',
    'Whether a subsystem is up (1) or down (0).',
    'gauge',
    health.subsystems.map((s) => ({ labels: { subsystem: s.id, level: s.level }, value: levelUp(s.level) })),
  );

  return e.toString();
}
