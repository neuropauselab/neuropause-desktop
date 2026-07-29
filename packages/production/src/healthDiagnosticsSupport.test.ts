import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createAutonomousOpsPlatform } from '@neuropause/autonomous-ops';
import { createWorkforcePlatform } from '@neuropause/workforce';
import { createOperationsPlatform } from '@neuropause/operations';
import { createProductionPlatform } from './platform';

describe('M13, M14, M18 — health monitoring, diagnostics, support', () => {
  it('health monitoring REUSES Wave 12 mission control and real platform signals', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const aops = createAutonomousOpsPlatform(rt, { clock });
    const wf = createWorkforcePlatform(rt, { clock });
    await wf.agents().register({ name: 'a1', role: 'Analyst', orgId: 'o1' });
    await aops.runtime().createMission({ name: 'Launch', orgId: 'o1' });
    const prod = createProductionPlatform(rt, { clock, autonomousOps: aops, workforce: wf });

    const platform = prod.health().health('platform', 'o1');
    expect(platform.source).toMatch(/mission control/);
    expect(typeof platform.value).toBe('number'); // real operational health

    expect(prod.health().health('ai-workforce').value).toBe(1);
    expect(prod.health().health('business').value).toBe('No production data available');
  });

  it('diagnostics assemble a bundle from real runtime state', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const prod = createProductionPlatform(rt, { clock });
    await prod.runtime().registerEnvironment({ name: 'prod', org: 'o1', tier: 'production' });
    const bundle = await prod.diagnostics().createBundle({ org: 'o1' });
    expect(bundle.environmentReport.environments).toBe(1);
    expect(bundle.configSnapshot.version).toBe('0.0.0-preview.1');
  });

  it('support bundles REUSE the operations incident registry', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ops = createOperationsPlatform(rt);
    const prod = createProductionPlatform(rt, { clock, operations: ops });
    ops.incidents().open({ title: 'disk full', severity: 'sev3' });
    const bundle = await prod.support().createBundle({ org: 'o1' });
    expect(bundle.incidentPackage.openIncidents).toBe(1);
    expect(bundle.incidentPackage.source).toMatch(/operations incident registry/);
  });
});
