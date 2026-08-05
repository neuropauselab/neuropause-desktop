import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createOperationsPlatform } from '@neuropause/operations';
import { createProductionPlatform } from './platform';

describe('M10–M12 — compliance, performance, chaos', () => {
  it('compliance produces evidence reports but NEVER claims certification', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const prod = createProductionPlatform(rt, { clock });
    const report = await prod.compliance().runAudit({ kind: 'security', checks: [{ name: 'mfa', passed: true }, { name: 'tls', passed: false }] });
    expect(report.certified).toBe(false);
    expect(report.findings).toEqual(['tls']);
    expect(report.note).toMatch(/NOT a certification/);
  });

  it('performance shows only measured results — reused from operations, honest when absent', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });

    const solo = createProductionPlatform(rt, { clock });
    const none = await solo.performance().runTest({ kind: 'load', name: 'api' });
    expect(none.measured).toBeNull();
    expect(none.note).toMatch(/no measurement fabricated/);

    const ops = createOperationsPlatform(rt);
    const prod = createProductionPlatform(rt, { clock, operations: ops });
    const measured = await prod.performance().runTest({ kind: 'load', name: 'api', iterations: 50 });
    expect(measured.measured).not.toBeNull(); // real measured result from the reused monitor
  });

  it('chaos experiments are represented, never injected into real infrastructure', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const prod = createProductionPlatform(rt, { clock });
    const exp = await prod.chaos().run({ kind: 'node-failure', target: 'node-3', hypothesis: 'quorum survives one node loss' });
    expect(exp.injected).toBe(false);
    expect(exp.note).toMatch(/no real fault injected/);
    expect(prod.chaos().validateRecovery(exp.id).recoveryValidated).toBe(true);
  });
});
