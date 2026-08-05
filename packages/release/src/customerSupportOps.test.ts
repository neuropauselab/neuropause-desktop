import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createCommercialPlatform } from '@neuropause/commercial';
import { createOperationsPlatform } from '@neuropause/operations';
import { createCustomerDeploymentPlatform } from '@neuropause/customer-deployment';
import { createReleasePlatform } from './platform';

describe('E6 / E7 — customer operations + support operations', () => {
  it('reports deployment + license inventory from the reused platforms', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const commercial = createCommercialPlatform(rt, { clock });
    const customerDeployment = createCustomerDeploymentPlatform(rt, { clock, commercial });
    const release = createReleasePlatform(rt, { clock, commercial, customerDeployment });

    // create a real deployment + license through the reused platforms
    const customer = await customerDeployment.runtime().registerCustomer({ name: 'Acme' });
    const tenant = await customerDeployment.runtime().createTenant({ customerId: customer.id, name: 'acme' });
    const env = await customerDeployment.runtime().createEnvironment({ tenantId: tenant.id, tier: 'pilot' });
    await customerDeployment.runtime().createDeployment({ customerId: customer.id, tenantId: tenant.id, environmentId: env.id });
    await commercial.licenses().issue({ tenantId: 'acme', type: 'seat', seats: 10 });

    await release.customerOperations().registerCustomer({ name: 'Acme', tenantId: 'acme' });
    const deployInv = release.customerOperations().deploymentInventory();
    expect(deployInv.reusedCustomerDeployment).toBe(true);
    expect(deployInv.count).toBe(1);
    const licInv = release.customerOperations().licenseInventory();
    expect(licInv.reusedCommercial).toBe(true);
    expect(licInv.count).toBe(1);
    // usage/renewal require real production data — reported pending, not fabricated
    expect(release.customerOperations().usageOverview().live).toBe(false);
  });

  it('escalates a support ticket into a REAL operations incident and records RCA', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ops = createOperationsPlatform(rt, { clock });
    const release = createReleasePlatform(rt, { clock, operations: ops });

    const ticket = await release.support().openTicket({ subject: 'cannot log in', severity: 'sev2' });
    const escalated = await release.support().escalate(ticket.id);
    expect(escalated.reusedOperations).toBe(true);
    expect(escalated.operationsIncidentId).toBeTruthy();
    const resolved = await release.support().resolve(ticket.id, 'expired cert rotated');
    expect(resolved.rootCause).toBe('expired cert rotated');
    expect(release.support().resolvedCount()).toBe(1);
  });
});
