import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createDeploymentOrchestrator } from './platform';

describe('E1 / E4 — deployment orchestrator + enterprise rollout', () => {
  it('advances a deployment registered → validated → approved → rollout-ready, deny-by-default', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const orch = createDeploymentOrchestrator(rt, { clock });

    await orch.deployments().registerEnvironment({ name: 'acme-staging', type: 'staging' });
    const tpl = await orch.deployments().registerTemplate({ name: 'standard', mode: 'single-tenant', description: 'standard single-tenant' });
    const dep = await orch.deployments().register({ organization: 'Acme', environment: 'acme-staging', version: '1.0.0', templateId: tpl.id });
    expect(dep.status).toBe('registered');

    const { result } = await orch.deployments().validate(dep.id);
    expect(result.valid).toBe(true);
    expect(orch.deployments().deployment(dep.id)!.status).toBe('validated');

    const approved = await orch.deployments().approve(dep.id, 'release-manager');
    expect(approved.status).toBe('approved');
    const ready = await orch.deployments().markRolloutReady(dep.id);
    expect(ready.status).toBe('rollout-ready'); // readiness, NOT a real deployment
  });

  it('refuses approval of a deployment that has not validated', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const orch = createDeploymentOrchestrator(rt, { clock });
    const dep = await orch.deployments().register({ organization: 'Acme', environment: 'x', version: '1.0.0' }); // no template → invalid
    const { result } = await orch.deployments().validate(dep.id);
    expect(result.valid).toBe(false); // missing template
    const notApproved = await orch.deployments().approve(dep.id, 'rm');
    expect(notApproved.status).not.toBe('approved');
  });

  it('plans rollout waves and advances controlled releases in the plan only', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const orch = createDeploymentOrchestrator(rt, { clock });
    const dep = await orch.deployments().register({ organization: 'Acme', environment: 'x', version: '1.0.0' });
    const rollout = await orch.rollout().planRollout({ deploymentId: dep.id, mode: 'regional', regions: ['us', 'eu'] });
    await orch.rollout().addWave({ rolloutId: rollout.id, name: 'canary', targetPercentage: 5 });
    await orch.rollout().addWave({ rolloutId: rollout.id, name: 'ga', targetPercentage: 100 });

    const first = await orch.rollout().controlledRelease(rollout.id);
    expect(first.released!.name).toBe('canary');
    expect(orch.rollout().status(rollout.id).releasedWaves).toBe(1); // plan only, no real traffic
  });
});
