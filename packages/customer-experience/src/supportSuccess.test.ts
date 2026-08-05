import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createOperationsPlatform } from '@neuropause/operations';
import { createReleasePlatform } from '@neuropause/release';
import { createCustomerDeploymentPlatform } from '@neuropause/customer-deployment';
import { createCustomerExperience } from './platform';

describe('E9 / E10 — support portal + customer success', () => {
  it('opens a ticket that REUSES release support (which reuses operations incidents)', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ops = createOperationsPlatform(rt, { clock });
    const release = createReleasePlatform(rt, { clock, operations: ops });
    const cx = createCustomerExperience(rt, { clock, release });

    const ticket = await cx.support().createTicket({ subject: 'cannot sign in', severity: 'sev2' });
    expect(ticket.reusedRelease).toBe(true);
    expect(ticket.releaseTicketId).toBeTruthy();
    await cx.support().escalate(ticket.id);
    const resolved = await cx.support().resolve(ticket.id, 'cleared cache');
    expect(resolved.status).toBe('resolved');
    expect(cx.support().resolvedCount()).toBe(1);
    expect(cx.support().knowledgeSearch('install').results.length).toBeGreaterThan(0);
  });

  it('scores customer success from REAL usage and returns null with no data', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const customerDeployment = createCustomerDeploymentPlatform(rt, { clock });
    const release = createReleasePlatform(rt, { clock, customerDeployment }); // release.customerSuccess reuses customer-deployment
    const cx = createCustomerExperience(rt, { clock, release, customerDeployment });

    // create a real deployment id via the reused customer-deployment runtime
    const customer = await customerDeployment.runtime().registerCustomer({ name: 'Acme' });
    const tenant = await customerDeployment.runtime().createTenant({ customerId: customer.id, name: 'acme' });
    const env = await customerDeployment.runtime().createEnvironment({ tenantId: tenant.id, tier: 'pilot' });
    const dep = await customerDeployment.runtime().createDeployment({ customerId: customer.id, tenantId: tenant.id, environmentId: env.id });

    const noData = await cx.customerSuccess().dashboard({ deploymentId: dep.id });
    expect(noData.hasData).toBe(false);
    expect(noData.healthScore).toBeNull();
    const scored = await cx.customerSuccess().dashboard({ deploymentId: dep.id, usage: { activeUsers: 80, provisionedUsers: 100, featuresUsed: 8, featuresAvailable: 10, milestonesHit: 4, milestonesTotal: 5 } });
    expect(scored.hasData).toBe(true);
    expect(scored.adoptionScore).toBe(80);
  });
});
