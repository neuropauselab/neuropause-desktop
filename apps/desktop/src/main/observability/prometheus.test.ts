/** P3.0 Increment 9 — Prometheus exposition tests (gateway metrics + health). */
import { describe, expect, it } from 'vitest';
import type { GatewayMetrics, SystemHealthSnapshot } from '@neuropause/shared';
import { toPrometheus } from './prometheus';

function metrics(over: Partial<GatewayMetrics> = {}): GatewayMetrics {
  return { windowDays: 7, requests: 10, allowed: 8, denied: 2, rateLimited: 1, unauthorized: 1, byStatus: { '200': 8, '403': 2 }, byVersion: { v1: 10 }, p95LatencyMs: 42, ...over };
}

function health(over: Partial<SystemHealthSnapshot> = {}): SystemHealthSnapshot {
  return {
    generatedAt: '2026-01-01T00:00:00.000Z', score: 91, level: 'degraded', uptimeMs: 7_200_000,
    subsystems: [{ id: 'runtime', label: 'Runtime', level: 'healthy' }, { id: 'backend', label: 'Backend', level: 'critical' }],
    throughput: { eventsPerMinute: 30, bufferedEvents: 2, avgDispatchMs: 3 },
    automation: { completed: 5, failed: 2, paused: 0, running: 1 },
    voice: 'idle',
    telemetry: { cpuPercent: 15, memoryUsedMb: 250, memoryTotalMb: 2000, processUptimeMs: 7_200_000, backendLatencyMs: null, backendState: 'disconnected' },
    ...over,
  };
}

describe('toPrometheus', () => {
  const text = toPrometheus(metrics(), health());

  it('emits HELP + TYPE + samples for the request counters', () => {
    expect(text).toContain('# HELP neuropause_gateway_requests_total Total gateway requests over the window.');
    expect(text).toContain('# TYPE neuropause_gateway_requests_total counter');
    expect(text).toContain('\nneuropause_gateway_requests_total 10\n');
    expect(text).toContain('neuropause_gateway_requests_denied_total 2');
    expect(text).toContain('neuropause_gateway_request_latency_p95_ms 42');
  });

  it('partitions requests by status with labels', () => {
    expect(text).toContain('neuropause_gateway_requests_by_status_total{status="200"} 8');
    expect(text).toContain('neuropause_gateway_requests_by_status_total{status="403"} 2');
  });

  it('exposes health score, uptime seconds, and per-subsystem up/down', () => {
    expect(text).toContain('neuropause_health_score 91');
    expect(text).toContain('neuropause_uptime_seconds 7200');
    expect(text).toContain('neuropause_subsystem_up{subsystem="runtime",level="healthy"} 1');
    expect(text).toContain('neuropause_subsystem_up{subsystem="backend",level="critical"} 0');
  });

  it('ends with a trailing newline and renders finite numbers only', () => {
    expect(text.endsWith('\n')).toBe(true);
    expect(text).not.toContain('NaN');
    expect(text).not.toContain('undefined');
  });
});
