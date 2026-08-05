import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { PerformanceMonitor } from './performance';
import { DeploymentManager } from './deployment';

describe('Performance Platform (Phase 7)', () => {
  it('measures latency percentiles with clock-driven work', async () => {
    const clock = new ManualClock(0);
    const perf = new PerformanceMonitor(clock);
    const summary = await perf.measure((i) => {
      clock.advance(i + 1);
    }, 4);
    expect(summary.count).toBe(4);
    expect(summary.min).toBe(1);
    expect(summary.max).toBe(4);
    expect(summary.mean).toBe(2.5);
  });

  it('runs a load test, counting throughput and errors', async () => {
    const clock = new ManualClock(0);
    const perf = new PerformanceMonitor(clock);
    const result = await perf.loadTest('op', (i) => {
      clock.advance(10);
      if (i === 2) throw new Error('boom');
    }, { iterations: 4, concurrency: 1 });
    expect(result.iterations).toBe(4);
    expect(result.errors).toBe(1);
    expect(result.durationMs).toBe(40);
    expect(result.throughputPerSec).toBe(100);
    expect(result.latency.count).toBe(4);
  });

  it('detects a regression against a baseline and forecasts capacity', async () => {
    const clock = new ManualClock(0);
    const perf = new PerformanceMonitor(clock);
    const base = await perf.loadTest('svc', () => clock.advance(10), { iterations: 4 });
    perf.setBaseline(base);
    const slow = await perf.loadTest('svc', () => clock.advance(30), { iterations: 4 });
    expect(perf.detectRegression(slow).regressed).toBe(true);

    const forecast = perf.forecastCapacity({ currentThroughputPerSec: 100, utilization: 0.5 });
    expect(forecast.projectedMaxThroughputPerSec).toBe(200);
    expect(forecast.headroomFactor).toBe(2);
    expect(forecast.saturated).toBe(false);
  });

  it('samples REAL memory and finds a stress breaking point', async () => {
    const clock = new ManualClock(0);
    const perf = new PerformanceMonitor(clock);
    const mem = perf.memory();
    expect(mem.rssBytes).toBeGreaterThan(0);
    expect(mem.heapUsedBytes).toBeGreaterThan(0);

    const soak = await perf.soakTest('loop', () => undefined, { iterations: 20, sampleEvery: 5 });
    expect(soak.samples.length).toBeGreaterThanOrEqual(2);
    expect(soak.leakSuspected).toBe(false);

    const stress = await perf.stressTest('s', () => clock.advance(100), { maxConcurrency: 3, iterationsPerLevel: 1, latencyThresholdMs: 50 });
    expect(stress.breakingPoint).toBe(1); // p95 100ms > 50ms threshold at the first level
  });
});

describe('Deployment Platform (Phase 8)', () => {
  it('promotes a healthy canary and keeps the previous version for rollback', async () => {
    const clock = new ManualClock(0);
    let healthy = true;
    const dm = new DeploymentManager(clock, { healthGate: () => ({ ready: healthy, status: healthy ? 'ok' : 'down' }), initialVersion: '1.0.0' });
    const dep = await dm.deploy({ version: '1.1.0', strategy: 'canary' });
    expect(dep.state).toBe('succeeded');
    expect(dep.previousVersion).toBe('1.0.0');
    expect(dm.current()).toBe('1.1.0');

    healthy = false;
    const dep2 = await dm.deploy({ version: '1.2.0', strategy: 'canary' });
    expect(dep2.state).toBe('rolled-back');
    expect(dm.current()).toBe('1.1.0'); // safe rollback — never promoted
  });

  it('rolls back when release validation fails mid-rollout', async () => {
    const dm = new DeploymentManager(new ManualClock(0), { initialVersion: '1.0.0' });
    const dep = await dm.deploy({ version: '2.0.0', strategy: 'rolling', verify: ({ percent }) => percent < 50 });
    expect(dep.state).toBe('rolled-back');
    expect(dep.steps.some((s) => !s.ok)).toBe(true);
  });

  it('resolves feature flags deterministically and checks version compatibility', () => {
    const dm = new DeploymentManager(new ManualClock(0));
    dm.featureFlags.set('beta', { rolloutPct: 50 });
    const first = dm.featureFlags.isEnabled('beta', 'user-1');
    expect(dm.featureFlags.isEnabled('beta', 'user-1')).toBe(first); // deterministic per subject
    dm.featureFlags.enable('ga');
    expect(dm.featureFlags.isEnabled('ga')).toBe(true);
    expect(dm.featureFlags.isEnabled('missing')).toBe(false);

    expect(dm.versionCompatible('1.4.2', '1.2.0')).toBe(true);
    expect(dm.versionCompatible('2.0.0', '1.9.0')).toBe(false);
    expect(dm.versionCompatible('1.1.0', '1.2.0')).toBe(false);
  });

  it('coordinates a migration with a paired rollback', async () => {
    const dm = new DeploymentManager(new ManualClock(0));
    let down = false;
    const good = await dm.coordinateMigration({ name: 'm1', up: async () => undefined, down: async () => { down = true; } });
    expect(good.applied).toBe(true);
    expect(down).toBe(false);
    const bad = await dm.coordinateMigration({ name: 'm2', up: async () => { throw new Error('fail'); }, down: async () => { down = true; } });
    expect(bad.applied).toBe(false);
    expect(bad.rolledBack).toBe(true);
    expect(down).toBe(true);
  });
});
