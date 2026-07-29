import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createSecurityPlatform } from '@neuropause/security';
import { createOperationsPlatform } from '@neuropause/operations';
import { createAiRuntime } from '@neuropause/ai-runtime';
import { createReliabilityPlatform } from '@neuropause/reliability';
import { createCustomerDeploymentPlatform, type CustomerDeploymentPlatform } from './platform';
import { READINESS_DIMENSIONS } from './constants';

async function newDeployment(cd: CustomerDeploymentPlatform): Promise<string> {
  const customer = await cd.runtime().registerCustomer({ name: 'Acme' });
  const tenant = await cd.runtime().createTenant({ customerId: customer.id, name: 'acme' });
  const env = await cd.runtime().createEnvironment({ tenantId: tenant.id, tier: 'pilot' });
  return (await cd.runtime().createDeployment({ customerId: customer.id, tenantId: tenant.id, environmentId: env.id })).id;
}

describe('E10 / E11 / E19 — operational acceptance, UAT, production readiness gate', () => {
  it('runs operational acceptance by REUSING the Sprint-4 end-to-end validation', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const sec = createSecurityPlatform(rt, { clock });
    const ops = createOperationsPlatform(rt, { clock });
    const ai = createAiRuntime(rt);
    const reliability = createReliabilityPlatform(rt, { clock, security: sec, operations: ops, aiRuntime: ai });
    const cd = createCustomerDeploymentPlatform(rt, { clock, reliability, business: undefined, security: sec, operations: ops });
    const deploymentId = await newDeployment(cd);

    const report = await cd.acceptance().runAcceptance({ deploymentId });
    expect(report.reusedReliability).toBe(true);
    expect(report.executed).toBeGreaterThanOrEqual(3);
    const identity = report.workflows.find((w) => w.area === 'identity')!;
    expect(identity.status).toBe('passed'); // real end-to-end identity registration
  });

  it('refuses UAT sign-off without a real approver or all cases passing', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const cd = createCustomerDeploymentPlatform(rt, { clock });
    const deploymentId = await newDeployment(cd);

    const plan = await cd.uat().createPlan({ deploymentId, scenarios: [{ scenario: 'login', acceptanceCriteria: 'user can log in' }] });
    const caseId = plan.cases[0]!.id;

    const noApprover = await cd.uat().signOff(plan.id, '   ');
    expect(noApprover.signed).toBe(false); // approval never fabricated

    // case not yet passed → refused
    const notPassed = await cd.uat().signOff(plan.id, 'cco@acme.example');
    expect(notPassed.signed).toBe(false);

    await cd.uat().recordResult(plan.id, caseId, true);
    const signed = await cd.uat().signOff(plan.id, 'cco@acme.example');
    expect(signed.signed).toBe(true);
    expect(cd.uat().get(plan.id)!.signedOffBy).toBe('cco@acme.example');
  });

  it('produces an evidence-based Go/No-Go that NEVER declares GA', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const sec = createSecurityPlatform(rt, { clock });
    const ops = createOperationsPlatform(rt, { clock });
    const reliability = createReliabilityPlatform(rt, { clock, security: sec, operations: ops });
    const cd = createCustomerDeploymentPlatform(rt, { clock, reliability });
    const deploymentId = await newDeployment(cd);

    const allPass = READINESS_DIMENSIONS.map((d) => ({ dimension: d, passed: true }));
    const go = await cd.readinessGate().evaluate({ deploymentId, signals: allPass });
    expect(go.decision).toBe('go');
    expect(go.ga).toBe(false);
    expect(go.reusedReliability).toBe(true);
    expect(go.readinessScore).not.toBeNull();

    const oneFails = READINESS_DIMENSIONS.map((d) => ({ dimension: d, passed: d !== 'security' }));
    const noGo = await cd.readinessGate().evaluate({ deploymentId, signals: oneFails });
    expect(noGo.decision).toBe('no-go');
    expect(noGo.ga).toBe(false);
  });
});
