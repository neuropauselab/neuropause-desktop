import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createProductionPlatform } from '@neuropause/production';
import { createDeploymentFoundation } from './platform';

describe('E5, E12, E13, E15 — infrastructure, storage, network, release', () => {
  it('infrastructure REPRESENTS providers as infrastructure-pending — never created', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const df = createDeploymentFoundation(rt, { clock });
    expect(df.infrastructure().providers().length).toBe(7);
    expect(df.infrastructure().templates().length).toBe(7);
    const rep = await df.infrastructure().represent('aws');
    expect(rep.templatePath).toBe('iac/aws/main.tf');
    expect(rep.note).toMatch(/no resource is created/);
  });

  it('storage adapters and network features are read from real assets', () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const df = createDeploymentFoundation(rt, { clock });
    expect(df.storage().adapters()).toEqual(expect.arrayContaining(['aws-s3', 'azure-blob', 'google-storage', 'minio']));
    expect(df.network().hasEdgeConfig()).toBe(true);
    expect(df.network().features()).toEqual(expect.arrayContaining(['tls', 'https-redirect', 'rate-limiting', 'reverse-proxy', 'hsts']));
  });

  it('release management validates semver and REUSES the production upgrade assistant', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const prod = createProductionPlatform(rt, { clock });
    const df = createDeploymentFoundation(rt, { clock, production: prod });
    await expect(df.releases().registerVersion({ version: 'nope' })).rejects.toThrow(/invalid semantic version/);
    const reg = await df.releases().registerVersion({ version: '1.0.0' });
    expect(reg.reusedProduction).toBe(true);
    const compat = await df.releases().compatibility('1.9.0', '2.0.0');
    expect(compat.breakingChange).toBe(true);
    expect(compat.reusedProduction).toBe(true);
  });
});
