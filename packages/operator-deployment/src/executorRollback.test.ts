import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createPlatformAutomation } from '@neuropause/platform-automation';
import { createEnvironmentProvisioning } from '@neuropause/environment-provisioning';
import { createOperatorDeployment } from './platform';
import type { OperatorInputs } from './types';

function wire() {
  const clock = new ManualClock(1000);
  const rt = createEnterpriseRuntime({ clock });
  const platformAutomation = createPlatformAutomation(rt, { clock });
  const environmentProvisioning = createEnvironmentProvisioning(rt, { clock, platformAutomation });
  const od = createOperatorDeployment(rt, { clock, environmentProvisioning });
  return { od };
}

const FULL_INPUTS: OperatorInputs = {
  cloudProvider: 'aws',
  cloudCredentialsRef: 'vault:aws/creds',
  domain: 'api.acme.com',
  containerRegistryRef: 'ecr:acme',
  dnsZoneRef: 'route53:z1',
  tlsAuthorityRef: 'letsencrypt',
  secretsManagerRef: 'aws-secrets-manager',
};

describe('items 3 & 5 — deployment executor + automatic rollback', () => {
  it('executor is BLOCKED without approval and without validation, and never deploys', async () => {
    const { od } = wire();
    const noApproval = await od.executor().execute({ inputs: FULL_INPUTS, approval: { operator: 'op', approved: false }, validationPassed: true });
    expect(noApproval.status).toBe('blocked');
    expect(noApproval.deployed).toBe(false);

    const noValidation = await od.executor().execute({ inputs: FULL_INPUTS, approval: { operator: 'op', approved: true }, validationPassed: false });
    expect(noValidation.status).toBe('blocked');
    expect(noValidation.reason).toContain('validation');
  });

  it('executor PREPARES commands with approval + validation but executes nothing', async () => {
    const { od } = wire();
    const result = await od.executor().execute({ inputs: FULL_INPUTS, approval: { operator: 'ops-lead', approved: true }, validationPassed: true });
    expect(result.status).toBe('prepared');
    expect(result.executed).toBe(false);
    expect(result.deployed).toBe(false); // never fabricates a deployment
    expect(result.commands.some((c) => c.startsWith('helm upgrade') || c.startsWith('kubectl apply'))).toBe(true);
  });

  it('rollback triggers automatically on failure conditions and only plans', async () => {
    const { od } = wire();
    expect(od.rollback().shouldRollback({})).toBe(false);
    expect(od.rollback().shouldRollback({ 'failed-pods': true })).toBe(true);
    const outcome = await od.rollback().autoRollback({ 'unhealthy-api': true, 'failed-migrations': true });
    expect(outcome.triggered).toBe(true);
    expect(outcome.reasons).toContain('unhealthy-api');
    expect(outcome.plan!.executed).toBe(false); // plan only
    expect(outcome.plan!.steps.length).toBeGreaterThan(0);
  });
});
