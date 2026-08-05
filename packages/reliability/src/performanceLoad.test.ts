import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createOperationsPlatform } from '@neuropause/operations';
import { createReliabilityPlatform } from './platform';

describe('E3 / E4 — performance engineering + load / stress / endurance (measured, never fabricated)', () => {
  it('performance REUSES the operations monitor and samples REAL memory', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ops = createOperationsPlatform(rt, { clock });
    const rel = createReliabilityPlatform(rt, { clock, operations: ops });

    expect(rel.performance().reusesOperations()).toBe(true);
    const mem = rel.performance().resources();
    expect(mem.heapUsedBytes).toBeGreaterThan(0); // a real process.memoryUsage() sample

    const load = await rel.performance().throughput('probe', () => {
      let x = 0;
      for (let i = 0; i < 20; i++) x += i;
      void x;
    }, { iterations: 100, concurrency: 4 });
    expect(load.iterations).toBe(100);
    expect(load.errors).toBe(0);
  });

  it('counts REAL errors under load, and endurance samples REAL heap; recovery is measured', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const rel = createReliabilityPlatform(rt, { clock }); // no operations → same reused class, local instance
    expect(rel.loadTesting().reusesOperations()).toBe(false);

    const load = await rel.loadTesting().load('mixed', (i) => {
      if (i % 2 === 0) throw new Error('boom');
    }, { iterations: 10, concurrency: 2 });
    expect(load.iterations).toBe(10);
    expect(load.errors).toBe(5); // measured, not assumed

    const soak = await rel.loadTesting().endurance('soak', () => undefined, { iterations: 50, sampleEvery: 10 });
    expect(soak.samples).toBeGreaterThanOrEqual(2);
    expect(soak.measured).toBe(true);
    expect(typeof soak.heapGrowthBytes).toBe('number');

    const rec = await rel.loadTesting().measureRecovery('soak', () => undefined, { iterations: 5 });
    expect(rec.recovered).toBe(true);
  });

  it('stress ramps concurrency and returns measured levels', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const rel = createReliabilityPlatform(rt, { clock });
    const stress = await rel.loadTesting().stress('ramp', () => undefined, { maxConcurrency: 4, iterationsPerLevel: 20, latencyThresholdMs: 1_000_000, step: 1 });
    expect(stress.measured).toBe(true);
    expect(stress.levels.length).toBe(4);
  });
});
