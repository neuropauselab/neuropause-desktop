import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createDeploymentOrchestrator } from './platform';

describe('E2 / E3 / E9 — pilot program + government templates + government readiness', () => {
  it('runs a pilot workflow, refusing completion until success criteria are met', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const orch = createDeploymentOrchestrator(rt, { clock });

    const pilot = await orch.pilots().registerPilot({ organization: 'Relife Ortho', sponsor: 'VP Ops' });
    expect(pilot.status).toBe('represented');
    expect(pilot.contracted).toBe(false); // represented until contracted

    await orch.pilots().setSuccessCriteria(pilot.id, ['SSO working', 'data migrated']);
    const early = await orch.pilots().completePilot(pilot.id);
    expect(early.completed).toBe(false); // criteria unmet → refused

    await orch.pilots().meetCriterion(pilot.id, 'SSO working');
    await orch.pilots().meetCriterion(pilot.id, 'data migrated');
    const done = await orch.pilots().completePilot(pilot.id);
    expect(done.completed).toBe(true);
    expect(done.pilot.status).toBe('completed'); // represented completion; no real contract claimed
  });

  it('builds all 8 government deployment templates, each flagged not deployed', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const orch = createDeploymentOrchestrator(rt, { clock });
    const templates = await orch.governmentTemplates().buildAll();
    expect(templates).toHaveLength(8);
    expect(templates.every((t) => t.deployed === false)).toBe(true); // templates only
    expect(orch.governmentTemplates().template('Healthcare Authority')!.securityClassification).toContain('PHI');
  });

  it('models government departments as operational models, never adoptions', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const orch = createDeploymentOrchestrator(rt, { clock });
    const dept = await orch.governmentReadiness().modelDepartment({ name: 'Ministry of Health', profile: 'National Ministry', classification: 'restricted' });
    expect(dept.adopted).toBe(false);
    expect(orch.governmentReadiness().operationalDashboard(dept.id).live).toBe(false);
  });
});
