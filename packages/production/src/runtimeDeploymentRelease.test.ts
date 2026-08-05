import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createCloudOpsPlatform } from '@neuropause/cloudops';
import { createProductionPlatform } from './platform';

describe('M1–M3 — production runtime, deployment, release', () => {
  it('registers environments and reports real runtime health', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const prod = createProductionPlatform(rt, { clock });
    expect(prod.runtime().runtimeHealth().status).toBe('no-environments');
    const env = await prod.runtime().registerEnvironment({ name: 'prod-eu', org: 'o1', tier: 'production' });
    expect(env.channel).toBe('stable');
    expect(prod.runtime().runtimeHealth().environments).toBe(1);
  });

  it('deployment manager REUSES the Wave 7 cloud-ops plane and records a deployment', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const cloud = createCloudOpsPlatform(rt, { clock });
    const prod = createProductionPlatform(rt, { clock, cloudops: cloud });
    const env = await prod.runtime().registerEnvironment({ name: 'prod', org: 'o1', tier: 'production' });
    const plan = await prod.deployments().deploy({ org: 'o1', environmentId: env.id, platform: 'kubernetes', version: '1.0.0' });
    expect(plan.reusedCloudOps).toBe(true);
    expect(prod.runtime().deploymentCount()).toBe(1);

    const solo = createProductionPlatform(rt, { clock });
    const plan2 = await solo.deployments().deploy({ org: 'o1', environmentId: env.id, platform: 'on-premise', version: '1.0.0' });
    expect(plan2.reusedCloudOps).toBe(false);
    expect(plan2.note).toMatch(/not provisioned here/);
  });

  it('release management validates semver and requires approval before production', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const prod = createProductionPlatform(rt, { clock });
    await expect(prod.releases().register({ version: 'not-a-version' })).rejects.toThrow(/invalid semantic version/);
    await prod.releases().register({ version: '1.2.0' });
    await expect(prod.releases().promote('1.2.0', 'production')).rejects.toThrow(/must be approved/);
    await prod.releases().approve('1.2.0', 'release-manager');
    await prod.releases().promote('1.2.0', 'production');
    expect(prod.runtime().releaseCount()).toBe(1); // promoted release recorded in the runtime
  });
});
