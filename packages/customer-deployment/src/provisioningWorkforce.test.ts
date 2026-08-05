import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createSecurityPlatform } from '@neuropause/security';
import { createCommercialPlatform } from '@neuropause/commercial';
import { createWorkforcePlatform } from '@neuropause/workforce';
import { createWorkplacePlatform } from '@neuropause/workplace';
import { createCustomerDeploymentPlatform, type CustomerDeploymentPlatform } from './platform';

async function newDeployment(cd: CustomerDeploymentPlatform): Promise<string> {
  const customer = await cd.runtime().registerCustomer({ name: 'Acme' });
  const tenant = await cd.runtime().createTenant({ customerId: customer.id, name: 'acme' });
  const env = await cd.runtime().createEnvironment({ tenantId: tenant.id, tier: 'pilot' });
  return (await cd.runtime().createDeployment({ customerId: customer.id, tenantId: tenant.id, environmentId: env.id })).id;
}

describe('E7 / E8 / E9 — provisioning, workspace activation, AI workforce activation', () => {
  it('provisions a user with a REAL identity, verified permission, and issued license', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const sec = createSecurityPlatform(rt, { clock });
    const commercial = createCommercialPlatform(rt, { clock });
    const cd = createCustomerDeploymentPlatform(rt, { clock, security: sec, commercial });
    const deploymentId = await newDeployment(cd);

    const admin = await cd.provisioning().provision({ deploymentId, role: 'administrator', displayName: 'Root Admin', assignLicense: true });
    expect(admin.identityId).toBeTruthy();
    expect(admin.permissionVerified).toBe(true); // a real authorization decision
    expect(admin.licenseId).toBeTruthy(); // a real seat license
    expect(admin.reused).toEqual({ security: true, commercial: true });
  });

  it('activates only LICENSED AI workers via the reused workforce platform', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const workforce = createWorkforcePlatform(rt, { clock });
    const cd = createCustomerDeploymentPlatform(rt, { clock, workforce });
    const deploymentId = await newDeployment(cd);

    const licensed = await cd.aiWorkforce().activate({ deploymentId, role: 'operations', licensed: true });
    expect(licensed.enabled).toBe(true);
    expect(licensed.agentId).toBeTruthy();

    const unlicensed = await cd.aiWorkforce().activate({ deploymentId, role: 'finance', licensed: false });
    expect(unlicensed.enabled).toBe(false);
    expect(unlicensed.agentId).toBeNull();
    expect(cd.aiWorkforce().enabledCount()).toBe(1);
  });

  it('activates workspace components against the reused workplace runtime', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const workplace = createWorkplacePlatform(rt, { clock });
    const cd = createCustomerDeploymentPlatform(rt, { clock, workplace });
    const deploymentId = await newDeployment(cd);
    const result = await cd.workspaceActivation().activate({ deploymentId });
    expect(result.reusedWorkplace).toBe(true);
    expect(result.workspacesRuntimeAvailable).toBe(true);
    expect(result.components.length).toBe(8);
  });
});
