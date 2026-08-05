import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createEnvironmentProvisioning } from './platform';

describe('E9-E11 — acceptance, evidence promotion, dashboard', () => {
  it('produces a machine-readable acceptance report with every check pending', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ep = createEnvironmentProvisioning(rt, { clock });
    const report = await ep.acceptance().report();
    expect(report.appliedToInfrastructure).toBe(false);
    expect(report.checks).toHaveLength(9);
    expect(report.checks.every((c) => c.status === 'pending')).toBe(true); // no pass fabricated
    expect(JSON.parse(report.json).appliedToInfrastructure).toBe(false);
  });

  it('opens evidence records per area, none promoted', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ep = createEnvironmentProvisioning(rt, { clock });
    const records = await ep.evidencePromotion().openAll();
    expect(records.length).toBeGreaterThan(0);
    expect(records.every((r) => r.result === 'pending' && r.promoted === false)).toBe(true);
    const collected = await ep.evidencePromotion().collect('terraform-apply', { operator: 'op', command: 'terraform apply', artifact: 'tf.out' });
    expect(collected.promoted).toBe(false); // collecting evidence never promotes
    expect(collected.auditId).toBeTruthy();
  });

  it('dashboard reports pending/provisioning with zero verified and no simulated data', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ep = createEnvironmentProvisioning(rt, { clock });
    const steps = await ep.provisioner().previewAll({});
    const snap = ep.dashboard().snapshot(steps);
    expect(snap.total).toBe(7);
    expect(snap.verified).toBe(0); // only real evidence promotes to Verified
    expect(snap.productionData).toBe('No production provisioning data available');
  });
});
