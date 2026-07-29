import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createProductionPlatform } from '@neuropause/production';
import { createReliabilityPlatform } from '@neuropause/reliability';
import { createReleasePlatform } from '@neuropause/release';
import { createPlatformOperations } from './platform';

describe('E9 / E14 — CI/CD + deployment automation', () => {
  it('runs the build pipeline by REUSING the Sprint-6 release automation', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const prod = createProductionPlatform(rt, { clock });
    const release = createReleasePlatform(rt, { clock, production: prod });
    const ops = createPlatformOperations(rt, { clock, release });

    const build = await ops.cicd().run({ kind: 'build', version: '1.0.0' });
    expect(build.reusedRelease).toBe(true);
    expect(build.status).toBe('succeeded');
    expect(build.artifacts).toBe(7); // real package artifacts
  });

  it('prepares a deployment with verified artifacts, and a rollback verified via reliability', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const prod = createProductionPlatform(rt, { clock });
    const reliability = createReliabilityPlatform(rt, { clock, production: prod });
    const release = createReleasePlatform(rt, { clock, production: prod, reliability });
    const ops = createPlatformOperations(rt, { clock, release, reliability });

    const canary = await ops.deploymentAutomation().deploy({ strategy: 'canary', version: '1.0.0' });
    expect(canary.reusedRelease).toBe(true);
    expect(canary.artifactsVerified).toBe(true);
    expect(canary.status).toBe('prepared'); // real traffic shift is infrastructure-pending

    const rollback = await ops.deploymentAutomation().deploy({ strategy: 'rollback', version: '1.0.0' });
    expect(rollback.reusedReliability).toBe(true);
    expect(rollback.rollbackVerified).toBe(true); // reused Sprint-4 recovery validation
    expect(rollback.status).toBe('rolled-back');
  });
});
