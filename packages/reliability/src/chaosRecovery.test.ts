import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createProductionPlatform } from '@neuropause/production';
import { createReliabilityPlatform } from './platform';

describe('E5 / E6 — chaos engineering (sandbox only) + recovery validation', () => {
  it('injects a fault into an in-process SANDBOX and measures recovery', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const rel = createReliabilityPlatform(rt, { clock });

    let observed = false;
    const exp = await rel.chaos().run({
      kind: 'error-injection',
      hypothesis: 'the sandbox tolerates injected errors and returns to steady state',
      target: (fault) => {
        if (fault.active) observed = true; // the sandbox reacts to the fault, then recovers
      },
    });
    expect(exp.blastRadius).toBe('in-process-sandbox');
    expect(exp.steadyBefore).toBe(true);
    expect(exp.steadyAfter).toBe(true);
    expect(exp.recovered).toBe(true);
    expect(observed).toBe(true);
  });

  it('resource-pressure allocates a REAL buffer and reports a measured heap delta', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const rel = createReliabilityPlatform(rt, { clock });
    const exp = await rel.chaos().run({ kind: 'resource-pressure', hypothesis: 'heap pressure stays bounded', target: () => undefined });
    expect(exp.heapDeltaBytes).toBeGreaterThanOrEqual(0);
    expect(exp.recovered).toBe(true);
  });

  it('recovery validation REUSES production backups (real record-integrity validation)', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const prod = createProductionPlatform(rt, { clock });
    const rel = createReliabilityPlatform(rt, { clock, production: prod });
    const drill = await rel.recovery().validate({ kind: 'backup-restore', targetId: 'tenant-1' });
    expect(drill.reusedProduction).toBe(true);
    expect(drill.recovered).toBe(true); // production validated the snapshot's record integrity
    expect(drill.evidenceId).toBeTruthy();
  });

  it('runs a REAL in-process recovery drill measuring a broken→healthy transition', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const rel = createReliabilityPlatform(rt, { clock });
    const ok = await rel.recovery().validate({ kind: 'service-restart', targetId: 'svc', recover: () => true });
    expect(ok.reusedProduction).toBe(false);
    expect(ok.recovered).toBe(true);
    const bad = await rel.recovery().validate({ kind: 'rollback', targetId: 'svc2', recover: () => false });
    expect(bad.recovered).toBe(false);
  });
});
