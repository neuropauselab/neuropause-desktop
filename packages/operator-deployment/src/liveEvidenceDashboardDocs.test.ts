import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createPlatformAutomation } from '@neuropause/platform-automation';
import { createEnvironmentProvisioning } from '@neuropause/environment-provisioning';
import { createOperatorDeployment } from './platform';

function wire() {
  const clock = new ManualClock(1000);
  const rt = createEnterpriseRuntime({ clock });
  const platformAutomation = createPlatformAutomation(rt, { clock });
  const environmentProvisioning = createEnvironmentProvisioning(rt, { clock, platformAutomation });
  return { od: createOperatorDeployment(rt, { clock, environmentProvisioning }) };
}

describe('items 4, 6, 7, 8 — live validation, evidence, dashboard, documentation', () => {
  it('live validation reuses the 1C acceptance validator; every check pending', async () => {
    const { od } = wire();
    const result = await od.liveValidation().run();
    expect(result.reused).toBe(true);
    expect(result.allPending).toBe(true);
    expect(result.checks.length).toBe(9);
  });

  it('evidence package opens items pending and never auto-promotes', async () => {
    const { od } = wire();
    const pkg = await od.evidencePackage().build();
    expect(pkg.items).toHaveLength(7);
    expect(pkg.items.every((i) => i.status === 'pending')).toBe(true);
    expect(pkg.promoted).toBe(false);
    expect(pkg.reusedEnvironmentProvisioning).toBe(true);
  });

  it('operator dashboard shows no succeeded/verified and no simulated data', () => {
    const { od } = wire();
    const snap = od.dashboard().snapshot([{ status: 'pending' }, { status: 'prepared' }, { status: 'failed' }]);
    expect(snap.pending).toBe(1);
    expect(snap.running).toBe(1);
    expect(snap.failed).toBe(1);
    expect(snap.succeeded).toBe(0);
    expect(snap.verified).toBe(0);
    expect(snap.productionData).toBe('No production deployment data available');
  });

  it('documentation generates all six operator guides', async () => {
    const { od } = wire();
    const guides = await od.documentation().generateAll();
    expect(guides).toHaveLength(6);
    expect(guides.find((g) => g.guide === 'Rollback Guide')!.sections.length).toBeGreaterThan(0);
  });
});
