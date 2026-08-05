import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { OperationsObservability } from './observability';
import { createOperationsPlatform, type OperationsPlatform } from './platform';

describe('Observability Expansion (Phase 6) — unified dashboard over the one registry', () => {
  it('groups the one metrics registry by subsystem and adds operational dimensions', () => {
    const clock = new ManualClock(0);
    const runtime = createEnterpriseRuntime({ clock });
    const obs = new OperationsObservability(runtime, clock);
    runtime.observability().metrics.inc('security.auth.failure');
    runtime.observability().metrics.inc('provider.calls', 3);
    obs.recordLatency('api', 10);
    obs.recordLatency('api', 30);
    obs.recordError('db');
    obs.recordThroughput('api', 5);
    obs.recordQueueDepth('jobs', 7);
    obs.recordWorker('w1', 2);

    const d = obs.dashboard();
    expect(d.subsystems.security?.['security.auth.failure']).toBe(1);
    expect(d.subsystems.provider?.['provider.calls']).toBe(3);
    expect(d.subsystems.ops?.['ops.error.db']).toBe(1);
    expect(d.latency.api?.count).toBe(2);
    expect(d.errors.db).toBe(1);
    expect(d.throughput.api).toBe(5);
    expect(d.queues.jobs).toBe(7);
    expect(d.workers.w1).toEqual({ active: 2 });
  });
});

describe('Operations Platform composition (Phase 11)', () => {
  const API_NAMES = ['operations', 'health', 'reliability', 'incidents', 'metrics', 'tracing', 'performance', 'deployments', 'disasterRecovery', 'capacity'] as const;

  it('exposes all ten operations APIs and an overview', () => {
    const clock = new ManualClock(0);
    const ops: OperationsPlatform = createOperationsPlatform(createEnterpriseRuntime({ clock }), { clock });
    for (const api of API_NAMES) expect(typeof (ops as unknown as Record<string, unknown>)[api]).toBe('function');
    expect(ops.version).toBeTruthy();
    ops.health().registerService('api', () => ({ status: 'ok', ready: true }));
    expect(ops.operations().overview().health.ready).toBe(true);
  });

  it('shares ONE scheduler, ONE metrics registry, and ONE audit chain', async () => {
    const clock = new ManualClock(0);
    const runtime = createEnterpriseRuntime({ clock });
    const ops = createOperationsPlatform(runtime, { clock });

    // job drain registered on the existing scheduler (not a new one)
    expect(runtime.scheduler().names()).toContain('ops.jobs.drain');

    // reliability metrics land in the one registry
    ops.reliability().define('svc', { retry: false, breaker: false });
    await ops.reliability().execute('svc', async () => 'ok');
    expect(runtime.observability().metrics.snapshot().counters['ops.reliability.svc.success']).toBe(1);

    // incident + deployment events land on the one audit chain, which stays valid
    ops.incidents().open({ title: 'blip', severity: 'sev4' });
    ops.health().registerService('api', () => ({ status: 'ok', ready: true }));
    await ops.deployments().deploy({ version: '1.0.0' });
    expect(runtime.audit().list().length).toBeGreaterThan(0);
    expect(runtime.audit().verify().valid).toBe(true);
  });

  it('always provides disaster recovery and capacity forecasting', async () => {
    const clock = new ManualClock(0);
    const ops = createOperationsPlatform(createEnterpriseRuntime({ clock }), { clock });
    const snap = await ops.disasterRecovery().takeSnapshot();
    expect(snap.id).toBeTruthy();
    const forecast = ops.capacity().forecast({ currentThroughputPerSec: 50, utilization: 0.25 });
    expect(forecast.projectedMaxThroughputPerSec).toBe(200);
    expect(ops.readiness().total).toBe(ops.matrix().length);
  });
});
