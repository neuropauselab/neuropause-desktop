import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createCloudOpsPlatform } from '@neuropause/cloudops';
import { createCommercialPlatform } from './platform';

describe('M7–M10 — feature flags, white-label, deployment, upgrade', () => {
  it('feature flags resolve org → env → default, with canary/beta off by default', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const cm = createCommercialPlatform(rt, { clock });
    await cm.features().define({ key: 'new-ui', stage: 'ga', defaultOn: true });
    await cm.features().define({ key: 'ai-beta', stage: 'beta' });
    expect(cm.features().isEnabled('ai-beta')).toBe(false); // beta off by default
    expect(cm.features().isEnabled('new-ui')).toBe(true);
    cm.features().setOrgOverride('new-ui', 'org1', false);
    expect(cm.features().isEnabled('new-ui', { orgId: 'org1' })).toBe(false); // org override wins
    cm.features().setEnvOverride('ai-beta', 'staging', true);
    expect(cm.features().isEnabled('ai-beta', { env: 'staging' })).toBe(true);
  });

  it('white-label stores a real per-tenant branding config', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const cm = createCommercialPlatform(rt, { clock });
    await cm.whiteLabel().configure({ tenantId: 't1', logoUrl: 'https://x/logo.png', colors: { primary: '#4f46e5' } });
    await cm.whiteLabel().configure({ tenantId: 't1', domain: 'acme.example.com' });
    const brand = cm.whiteLabel().get('t1')!;
    expect(brand.logoUrl).toBe('https://x/logo.png'); // preserved across upsert
    expect(brand.domain).toBe('acme.example.com');
  });

  it('deployment manager REUSES the Wave 7 cloud-ops plane when connected', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const cloud = createCloudOpsPlatform(rt, { clock });
    const cm = createCommercialPlatform(rt, { clock, cloudops: cloud });
    const dep = await cm.deployments().deploy({ tenantId: 't1', target: 'cloud' });
    expect(dep.reusedCloudOps).toBe(true);

    const solo = createCommercialPlatform(rt, { clock });
    const dep2 = await solo.deployments().deploy({ tenantId: 't2', target: 'on-premise' });
    expect(dep2.reusedCloudOps).toBe(false);
    expect(dep2.note).toMatch(/not provisioned here/);
  });

  it('upgrade manager really validates compatibility against the version registry', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const cm = createCommercialPlatform(rt, { clock });
    await cm.upgrades().registerVersion({ version: '1.0.0' });
    await cm.upgrades().registerVersion({ version: '1.1.0' });
    const ok = await cm.upgrades().planUpgrade({ tenantId: 't1', fromVersion: '1.0.0', toVersion: '1.1.0' });
    expect(ok.compatible).toBe(true);
    expect(ok.rollbackSteps.length).toBeGreaterThan(0);
    const bad = await cm.upgrades().planUpgrade({ tenantId: 't1', fromVersion: '1.1.0', toVersion: '1.0.0' });
    expect(bad.compatible).toBe(false); // downgrade is not a compatible upgrade
    expect(bad.steps).toHaveLength(0);
  });
});
