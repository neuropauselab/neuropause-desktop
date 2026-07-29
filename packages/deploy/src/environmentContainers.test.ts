import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createProductionPlatform } from '@neuropause/production';
import { createDeploymentFoundation } from './platform';

describe('E1–E2 — environment architecture, container platform', () => {
  it('registers environments as NOT deployed — production is never faked', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const df = createDeploymentFoundation(rt, { clock });
    const prod = await df.environments().register({ name: 'prod-eu', environment: 'production', region: 'eu-west-1', cluster: 'nems-prod', version: '0.0.0-preview.1' });
    expect(prod.deploymentStatus).toBe('not-deployed');
    expect(prod.health).toBe('unknown');
    expect(df.environments().count()).toBe(1);
  });

  it('mirrors environments into the reused Wave 14 production runtime', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const prod = createProductionPlatform(rt, { clock });
    const df = createDeploymentFoundation(rt, { clock, production: prod });
    await df.environments().register({ name: 'staging', environment: 'staging', region: 'us-east-1', cluster: 'nems-staging', version: '0.0.0-preview.1' });
    expect(prod.runtime().environmentCount()).toBe(1); // reused registry actually recorded it
  });

  it('reads the real multi-stage Dockerfile targets and compose services', () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const df = createDeploymentFoundation(rt, { clock });
    expect(df.containers().dockerfileTargets()).toEqual(expect.arrayContaining(['base', 'production', 'worker', 'ai-runtime', 'migration']));
    expect(df.containers().composeServices()).toEqual(expect.arrayContaining(['postgres', 'redis', 'qdrant', 'ollama', 'api', 'workers', 'nginx']));
    expect(df.containers().composeServices('docker/docker-compose.production.yml')).toEqual(expect.arrayContaining(['api', 'workers', 'ai-runtime']));
  });
});
