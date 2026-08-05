import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createFederationPlatform } from '@neuropause/federation';
import { createWorkplacePlatform } from '@neuropause/workplace';
import { createWorkforcePlatform } from '@neuropause/workforce';
import { createIndustryPlatform } from '@neuropause/industry';
import { createCommercialPlatform } from './platform';

describe('M1–M3 — commercial runtime, multi-tenant, onboarding', () => {
  it('registers customers and provisions tenants with real isolated storage', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const cm = createCommercialPlatform(rt, { clock });

    const customer = await cm.runtime().registerCustomer({ name: 'Acme Inc' });
    const tenant = await cm.runtime().provisionTenant({ customerId: customer.id, name: 'Acme Prod', region: 'us-east' });
    expect(tenant.state).toBe('provisioning');
    expect(tenant.isolatedStorageKey).toContain(tenant.id); // real per-tenant namespace
    await cm.runtime().setTenantState(tenant.id, 'active');

    const ctx = cm.runtime().context(customer.id);
    expect(ctx.tenants).toBe(1);
    expect(ctx.active).toBe(1);
    expect(cm.tenants().isolation(tenant.id, tenant.isolatedStorageKey).isolated).toBe(true);
  });

  it('multi-tenant REUSES the Wave 6 federation for regions and org records', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const fed = createFederationPlatform(rt, { clock });
    const cm = createCommercialPlatform(rt, { clock, federation: fed });

    const region = await cm.tenants().registerRegion({ name: 'eu-west', provider: 'aws' });
    expect(region.reusedFederation).toBe(true);
    expect(fed.regions().count()).toBeGreaterThan(0); // the reused federation actually recorded it

    const link = await cm.tenants().linkOrganization({ tenantId: 't1', name: 'Acme', orgId: 'o1' });
    expect(link.reusedFederation).toBe(true);
    expect(link.federationOrgId).toBeTruthy();
  });

  it('onboarding REUSES workplace, workforce, and industry when connected', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const wp = createWorkplacePlatform(rt, { clock });
    const wf = createWorkforcePlatform(rt, { clock });
    const ind = createIndustryPlatform(rt, { clock });
    const cm = createCommercialPlatform(rt, { clock, workplace: wp, workforce: wf, industry: ind });

    const industryKey = ind.industries()[0]!.key;
    const result = await cm.onboarding().runWizard({ customerName: 'Acme', orgId: 'o1', tenantId: 't1', industryKey, subdomain: 'acme', provisionWorkers: [{ name: 'CRM Bot', role: 'CRM Manager' }], branding: { primaryColor: '#4f46e5' } });
    expect(result.reusedWorkplace).toBe(true);
    expect(result.workspaceId).toBeTruthy();
    expect(result.reusedWorkforce).toBe(true);
    expect(result.aiWorkerIds).toHaveLength(1);
    expect(result.reusedIndustry).toBe(true);
    expect(result.industrySelected).toBe(industryKey);
    expect(result.domain).toBe('acme.nems.app');
  });

  it('onboarding honestly reports what is not provisioned when nothing is connected', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const cm = createCommercialPlatform(rt, { clock });
    const result = await cm.onboarding().runWizard({ customerName: 'Solo', orgId: 'o2', tenantId: 't2' });
    expect(result.reusedWorkplace).toBe(false);
    expect(result.workspaceId).toBeNull();
    expect(result.reusedWorkforce).toBe(false);
    expect(result.aiWorkerIds).toHaveLength(0);
  });
});
