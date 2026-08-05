import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { HealthRegistry, type RuntimeHealthLike } from './health';

const okRuntime = (): RuntimeHealthLike => ({ status: 'ok', ready: true, services: [{ name: 'runtime-svc', status: 'ok', ready: true }] });

describe('Runtime Health Platform (Phase 1)', () => {
  it('aggregates worst-status and folds in the runtime services (one health truth)', () => {
    const h = new HealthRegistry(new ManualClock(0), okRuntime);
    h.registerService('api', () => ({ status: 'ok', ready: true }));
    h.registerDependency('db', () => ({ status: 'ok', ready: true }), { critical: true, kind: 'database' });
    const r = h.aggregate();
    expect(r.status).toBe('ok');
    expect(r.ready).toBe(true);
    expect(r.components.map((c) => c.name)).toContain('runtime-svc'); // folded in, not duplicated
    expect(r.components.map((c) => c.name)).toEqual(expect.arrayContaining(['api', 'db', 'runtime-svc']));
  });

  it('a non-critical degraded dependency degrades status but still serves (ready)', () => {
    const h = new HealthRegistry(new ManualClock(0), okRuntime);
    h.registerService('api', () => ({ status: 'ok', ready: true }));
    h.registerDependency('cache', () => ({ status: 'degraded', ready: true }), { critical: false });
    const r = h.aggregate();
    expect(r.status).toBe('degraded');
    expect(r.ready).toBe(true);
    expect(r.degradation).toBe('degraded');
  });

  it('a down critical component fails readiness and reads offline', () => {
    const h = new HealthRegistry(new ManualClock(0), okRuntime);
    h.registerService('api', () => ({ status: 'ok', ready: true }));
    h.registerDependency('db', () => ({ status: 'down', ready: false }), { critical: true });
    const r = h.aggregate();
    expect(r.status).toBe('down');
    expect(r.ready).toBe(false);
    expect(r.degradation).toBe('offline');
    expect(h.readiness().blockers).toContain('db');
  });

  it('a throwing probe is treated as down, not a crash', () => {
    const h = new HealthRegistry(new ManualClock(0));
    h.registerService('flaky', () => {
      throw new Error('probe boom');
    });
    expect(h.status('flaky')?.status).toBe('down');
    expect(h.liveness().status).toBe('down');
  });

  it('verifies startup (all critical ready) and shutdown (nothing down)', () => {
    const h = new HealthRegistry(new ManualClock(0));
    h.registerService('api', () => ({ status: 'ok', ready: true }));
    h.registerDependency('db', () => ({ status: 'ok', ready: true }), { critical: true });
    expect(h.startupVerification().ok).toBe(true);
    expect(h.shutdownVerification().ok).toBe(true);

    h.registerDependency('queue', () => ({ status: 'ok', ready: false }), { critical: true });
    expect(h.startupVerification().ok).toBe(false); // a critical component isn't ready yet
    expect(h.shutdownVerification().ok).toBe(true); // ready:false but not down ⇒ safe to stop
  });

  it('records history and honours an operator degradation state', () => {
    const h = new HealthRegistry(new ManualClock(0), okRuntime);
    h.registerService('api', () => ({ status: 'ok', ready: true }));
    h.snapshot();
    h.snapshot();
    expect(h.history()).toHaveLength(2);
    h.setDegradation('maintenance');
    const r = h.aggregate();
    expect(r.degradation).toBe('maintenance');
    expect(r.ready).toBe(false); // maintenance gates readiness even when live
    expect(h.readiness().blockers).toContain('degradation:maintenance');
  });
});
