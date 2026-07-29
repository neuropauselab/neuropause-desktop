import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { DisasterRecovery, MemoryBackupTarget } from './dr';
import { Tracer } from './tracing';

describe('Disaster Recovery drills (Phase 5)', () => {
  it('runs a backup → loss → restore → validate drill and recovers', async () => {
    const clock = new ManualClock(0);
    const target = new MemoryBackupTarget();
    target.set('a', 1);
    target.set('b', 2);
    const dr = new DisasterRecovery(target, clock, { rpoMs: 10_000, rtoMs: 10_000 });
    const snapshot = await dr.takeSnapshot();

    const report = await dr.drill({ simulateLoss: () => target.wipe(), snapshot });
    expect(report.backupVerified).toBe(true);
    expect(report.recovered).toBe(true);
    expect(report.dataLoss).toBe(false); // nothing written after the snapshot
    expect(report.ok).toBe(true);
    expect(target.current()).toEqual({ a: 1, b: 2 }); // state genuinely restored
  });

  it('measures the RPO window and detects data loss for post-snapshot writes', async () => {
    const clock = new ManualClock(0);
    const target = new MemoryBackupTarget();
    target.set('x', 1);
    const dr = new DisasterRecovery(target, clock, { rpoMs: 5000, rtoMs: 5000 });
    const snapshot = await dr.takeSnapshot(); // at t=0
    clock.advance(3000);
    target.set('y', 2); // written after the snapshot ⇒ would be lost

    const report = await dr.drill({ simulateLoss: () => target.wipe(), snapshot });
    expect(report.dataLoss).toBe(true);
    expect(report.rpoMs).toBe(3000);
    expect(report.withinRpo).toBe(true);
    expect(report.recovered).toBe(true); // restored to the snapshot's state
    expect(target.current()).toEqual({ x: 1 });
    expect(dr.lastReport()?.drillId).toBe(report.drillId);
  });

  it('does snapshot-granularity point-in-time recovery', async () => {
    const clock = new ManualClock(0);
    const target = new MemoryBackupTarget();
    target.set('v', 1);
    const dr = new DisasterRecovery(target, clock);
    const s1 = await dr.takeSnapshot(); // t=0
    clock.advance(1000);
    target.set('v', 2);
    const s2 = await dr.takeSnapshot(); // t=1000
    clock.advance(1000);

    const pit = await dr.pointInTimeRecovery(1500); // latest snapshot at/before 1500 ⇒ s2
    expect(pit.snapshotId).toBe(s2.id);
    expect(pit.at).toBe(1000);
    const early = await dr.pointInTimeRecovery(500); // ⇒ s1
    expect(early.snapshotId).toBe(s1.id);
    expect(target.current()).toEqual({ v: 1 });
  });
});

describe('Distributed tracing (Phase 6)', () => {
  it('builds correlation-linked spans, latency, and a service dependency graph', () => {
    const clock = new ManualClock(0);
    const tracer = new Tracer(clock);
    const root = tracer.startTrace('request', { service: 'gateway' });
    clock.advance(5);
    const child = tracer.startSpan('db-query', { traceId: root.traceId, parentId: root.spanId, service: 'db' });
    clock.advance(10);
    tracer.end(child.spanId, 'ok');
    tracer.end(root.spanId, 'ok');

    expect(tracer.correlationId(child)).toBe(root.traceId);
    const spans = tracer.trace(root.traceId);
    expect(spans).toHaveLength(2);
    expect(spans.find((s) => s.name === 'db-query')?.durationMs).toBe(10);
    expect(tracer.dependencyGraph()).toContainEqual({ from: 'gateway', to: 'db', calls: 1 });
  });
});
