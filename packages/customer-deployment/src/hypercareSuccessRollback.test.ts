import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createOperationsPlatform } from '@neuropause/operations';
import { createReliabilityPlatform } from '@neuropause/reliability';
import { createProductionPlatform } from '@neuropause/production';
import { createCustomerDeploymentPlatform, type CustomerDeploymentPlatform } from './platform';

async function newDeployment(cd: CustomerDeploymentPlatform): Promise<string> {
  const customer = await cd.runtime().registerCustomer({ name: 'Acme' });
  const tenant = await cd.runtime().createTenant({ customerId: customer.id, name: 'acme' });
  const env = await cd.runtime().createEnvironment({ tenantId: tenant.id, tier: 'pilot' });
  return (await cd.runtime().createDeployment({ customerId: customer.id, tenantId: tenant.id, environmentId: env.id })).id;
}

describe('E12 / E13 / E14 / E18 — monitoring, hypercare, customer success, rollback', () => {
  it('reports health from the reused operations overview and tracks hypercare incidents', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ops = createOperationsPlatform(rt, { clock });
    const cd = createCustomerDeploymentPlatform(rt, { clock, operations: ops });
    const deploymentId = await newDeployment(cd);

    await cd.monitoring().configure({ deploymentId });
    expect(cd.monitoring().health().available).toBe(true); // reused operations overview

    const issue = await cd.hypercare().openIssue({ deploymentId, title: 'login latency', severity: 'sev3' });
    expect(issue.reusedOperations).toBe(true);
    expect(issue.operationsIncidentId).toBeTruthy();
    await cd.hypercare().acknowledge(issue.id, 'oncall@acme');
    await cd.hypercare().resolve(issue.id, 'scaled the auth service');
    expect(cd.hypercare().resolvedCount()).toBe(1);
  });

  it('scores customer success from REAL usage and returns null with no data', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const cd = createCustomerDeploymentPlatform(rt, { clock });
    const deploymentId = await newDeployment(cd);

    const noData = await cd.customerSuccess().score({ deploymentId });
    expect(noData.hasData).toBe(false);
    expect(noData.adoptionScore).toBeNull(); // customer behavior never fabricated

    const scored = await cd.customerSuccess().score({ deploymentId, usage: { activeUsers: 80, provisionedUsers: 100, featuresUsed: 8, featuresAvailable: 10, milestonesHit: 4, milestonesTotal: 5 } });
    expect(scored.adoptionScore).toBe(80);
    expect(scored.hasData).toBe(true);
    expect(typeof scored.healthScore).toBe('number');
  });

  it('executes a rollback as a REAL state transition, verified via the reused recovery engine', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const prod = createProductionPlatform(rt, { clock });
    const reliability = createReliabilityPlatform(rt, { clock, production: prod });
    const cd = createCustomerDeploymentPlatform(rt, { clock, reliability });
    const deploymentId = await newDeployment(cd);

    // advance to a rollback-eligible state
    await cd.runtime().transition(deploymentId, 'onboarding');
    await cd.runtime().transition(deploymentId, 'configuring');
    await cd.runtime().transition(deploymentId, 'validating');
    await cd.runtime().transition(deploymentId, 'ready');

    const result = await cd.rollback().execute({ deploymentId, scope: 'tenant' });
    expect(result.reusedReliability).toBe(true);
    expect(result.recoveryVerified).toBe(true); // reused Sprint-4 recovery validation
    expect(result.status).toBe('rolled-back');
    expect(cd.runtime().deployment(deploymentId)!.status).toBe('rolled-back');
  });
});
