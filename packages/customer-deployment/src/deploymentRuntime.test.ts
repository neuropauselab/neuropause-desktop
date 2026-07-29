import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createSecurityPlatform } from '@neuropause/security';
import { createCustomerDeploymentPlatform } from './platform';
import { RELIFE_ORTHO_PROFILE } from './constants';

describe('E1 / E2 / E3 — deployment runtime, onboarding, configuration', () => {
  it('drives the customer/tenant/deployment lifecycle and audits every step', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const cd = createCustomerDeploymentPlatform(rt, { clock });
    const events: Array<Record<string, unknown>> = [];
    rt.events().subscribe((e) => e.type === 'deployment.action', (e) => { events.push(e.payload as Record<string, unknown>); });

    const customer = await cd.runtime().registerCustomer({ name: 'Acme', profileKey: RELIFE_ORTHO_PROFILE.key });
    const tenant = await cd.runtime().createTenant({ customerId: customer.id, name: 'acme-prod' });
    const env = await cd.runtime().createEnvironment({ tenantId: tenant.id, tier: 'pilot' });
    const deployment = await cd.runtime().createDeployment({ customerId: customer.id, tenantId: tenant.id, environmentId: env.id });
    expect(deployment.status).toBe('registered');

    await cd.runtime().transition(deployment.id, 'onboarding');
    await cd.runtime().transition(deployment.id, 'configuring');
    expect(cd.runtime().history(deployment.id).length).toBe(3);
    expect(rt.audit().verify().valid).toBe(true);
    const last = events[events.length - 1]!;
    expect(last['replayId']).toBeTruthy();
    expect(last['customer']).toBe(customer.id);
  });

  it('rejects an illegal lifecycle transition — status is never silently forced', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const cd = createCustomerDeploymentPlatform(rt, { clock });
    const customer = await cd.runtime().registerCustomer({ name: 'Acme' });
    const tenant = await cd.runtime().createTenant({ customerId: customer.id, name: 't' });
    const env = await cd.runtime().createEnvironment({ tenantId: tenant.id, tier: 'sandbox' });
    const deployment = await cd.runtime().createDeployment({ customerId: customer.id, tenantId: tenant.id, environmentId: env.id });
    await expect(cd.runtime().transition(deployment.id, 'deployed')).rejects.toThrow(/illegal deployment transition/);
  });

  it('onboarding creates REAL default roles in the reused security platform', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const sec = createSecurityPlatform(rt, { clock });
    const cd = createCustomerDeploymentPlatform(rt, { clock, security: sec });
    const customer = await cd.runtime().registerCustomer({ name: 'Acme' });
    const tenant = await cd.runtime().createTenant({ customerId: customer.id, name: 'acme' });
    const env = await cd.runtime().createEnvironment({ tenantId: tenant.id, tier: 'pilot' });
    const deployment = await cd.runtime().createDeployment({ customerId: customer.id, tenantId: tenant.id, environmentId: env.id });

    const config = await cd.onboarding().onboard({ deploymentId: deployment.id, domain: 'acme.example', profile: RELIFE_ORTHO_PROFILE });
    expect(config.defaultRoles).toHaveLength(4);
    expect(config.defaultRoles.every((r) => r.createdInSecurity)).toBe(true);
    // The administrator role really exists in the reused authorization engine.
    expect(sec.authorization().role(`${tenant.id}:administrator`)).toBeTruthy();
    expect(cd.onboarding().currentStatus(deployment.id)).toBe('onboarding');

    const enterprise = await cd.configuration().apply({ deploymentId: deployment.id, businessModules: ['manufacturing', 'sales'], identityProvider: 'Microsoft Entra ID' });
    expect(enterprise.businessModules).toContain('manufacturing');
    expect(cd.runtime().deployment(deployment.id)!.status).toBe('configuring');
  });
});
