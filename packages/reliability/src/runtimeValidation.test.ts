import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createReliabilityPlatform } from './platform';

describe('E1 — production validation runtime', () => {
  it('registers a suite and records a real passed run on the one chain', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const rel = createReliabilityPlatform(rt, { clock });
    const events: Array<Record<string, unknown>> = [];
    rt.events().subscribe((e) => e.type === 'reliability.action', (e) => { events.push(e.payload as Record<string, unknown>); });

    const suite = rel.validation().register({ name: 'smoke', kind: 'end-to-end' });
    expect(suite.status).toBe('registered');

    const run = await rel.validation().run(suite.id, () => ({ passed: true, checks: [{ name: 'ok', passed: true }] }));
    expect(run.passed).toBe(true);
    expect(run.status).toBe('passed');
    expect(rel.validation().summary()).toEqual({ total: 1, passed: 1, failed: 0 });
    expect(rt.audit().verify().valid).toBe(true);

    const last = events[events.length - 1]!;
    expect(last['replayId']).toBeTruthy();
    expect(last['epic']).toBe('E1');
    expect(last['evidence']).toBe('live-verified');
  });

  it('records a FAILED run when the executor throws — nothing is assumed green', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const rel = createReliabilityPlatform(rt, { clock });
    const suite = rel.validation().register({ name: 'boom', kind: 'performance' });
    const run = await rel.validation().run(suite.id, () => {
      throw new Error('nope');
    });
    expect(run.passed).toBe(false);
    expect(run.status).toBe('failed');
    expect(run.checks[0]!.detail).toContain('nope');
    expect(rel.validation().summary()).toEqual({ total: 1, passed: 0, failed: 1 });
  });
});
