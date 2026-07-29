import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createOperationsPlatform } from '@neuropause/operations';
import { createDeploymentFoundation } from './platform';
import { NO_DEPLOY_DATA } from './constants';

describe('E3, E4, E6, E8, E9, E10 — k8s, helm, pipeline, config, observability, monitoring', () => {
  it('kubernetes represents manifests only — no cluster claimed', () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const df = createDeploymentFoundation(rt, { clock });
    expect(df.kubernetes().resourceKinds()).toEqual(expect.arrayContaining(['Deployment', 'StatefulSet', 'DaemonSet', 'Ingress', 'CronJob', 'NetworkPolicy']));
    expect(df.kubernetes().note()).toMatch(/no cluster is claimed/);
  });

  it('helm chart + values environments + pipeline workflows are read from real assets', () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const df = createDeploymentFoundation(rt, { clock });
    expect(df.helm().chartVersion()).toBe('0.1.0');
    expect(df.helm().valuesEnvironments()).toEqual(expect.arrayContaining(['production', 'staging', 'development']));
    expect(df.pipeline().workflows()).toEqual(expect.arrayContaining(['ci.yml', 'release.yml', 'rollback.yml']));
  });

  it('configuration reads real per-environment JSON', () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const df = createDeploymentFoundation(rt, { clock });
    expect(df.config().environments()).toEqual(expect.arrayContaining(['production', 'staging', 'qa', 'development']));
    const prod = df.config().config('production') as { security: { mfaRequired: boolean } };
    expect(prod.security.mfaRequired).toBe(true);
  });

  it('observability REUSES operations health; monitoring never claims a running server', () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });

    const solo = createDeploymentFoundation(rt, { clock });
    expect(solo.observability().serviceHealth().status).toBe(NO_DEPLOY_DATA);
    expect(solo.observability().healthEndpoints()).toEqual(['/health/live', '/health/ready', '/health/startup']);

    const ops = createOperationsPlatform(rt);
    const df = createDeploymentFoundation(rt, { clock, operations: ops });
    expect(df.observability().serviceHealth().source).toMatch(/operations health/);
    expect(df.monitoring().note()).toMatch(/no running/i);
    expect(df.monitoring().components().length).toBeGreaterThanOrEqual(5);
  });
});
