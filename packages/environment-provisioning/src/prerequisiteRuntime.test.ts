import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createPlatformAutomation } from '@neuropause/platform-automation';
import { createEnvironmentProvisioning } from './platform';
import type { OperatorInputs } from './types';

const FULL: OperatorInputs = {
  cloudProvider: 'aws',
  cloudCredentialsRef: 'vault:aws/creds',
  domain: 'api.acme.com',
  containerRegistryRef: 'ecr:acme',
  dnsZoneRef: 'route53:z1',
  tlsAuthorityRef: 'letsencrypt',
  secretsManagerRef: 'aws-secrets-manager',
  approval: { operator: 'ops-lead', approved: true },
};

describe('E1 — prerequisite gate + cloud provisioning runtime', () => {
  it('STOPS at PENDING - OPERATOR INPUT REQUIRED when inputs are missing', () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ep = createEnvironmentProvisioning(rt, { clock });
    const gate = ep.prerequisites().check({});
    expect(gate.ready).toBe(false);
    expect(gate.status).toBe('PENDING - OPERATOR INPUT REQUIRED');
    expect(gate.missing).toContain('cloudProvider');
    expect(gate.missing).toContain('approval');
    expect(ep.prerequisites().check(FULL).ready).toBe(true);
  });

  it('PROVISION stops at PENDING without inputs and never provisions', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ep = createEnvironmentProvisioning(rt, { clock });
    const outcome = await ep.cloud().provision({});
    expect(outcome.status).toBe('PENDING - OPERATOR INPUT REQUIRED');
    expect(outcome.ready).toBe(false);
    expect(outcome.provisioned).toBe(false);
    expect(outcome.steps).toHaveLength(0);
  });

  it('PREVIEW generates artifacts for every phase and provisions nothing', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const platformAutomation = createPlatformAutomation(rt, { clock });
    const ep = createEnvironmentProvisioning(rt, { clock, platformAutomation });
    const preview = await ep.cloud().preview(FULL);
    expect(preview.mutated).toBe(false);
    expect(preview.steps).toHaveLength(7);
    expect(preview.steps.every((s) => s.provisioned === false)).toBe(true);
  });

  it('PROVISION with full inputs + approval PREPARES each phase but provisions nothing', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const platformAutomation = createPlatformAutomation(rt, { clock });
    const ep = createEnvironmentProvisioning(rt, { clock, platformAutomation });
    const outcome = await ep.cloud().provision(FULL);
    expect(outcome.status).toBe('prepared');
    expect(outcome.provisioned).toBe(false);
    expect(outcome.appliedToInfrastructure).toBe(false);
    expect(outcome.steps).toHaveLength(7);
    expect(outcome.steps.every((s) => s.status === 'prepared')).toBe(true);
    expect(outcome.steps.find((s) => s.phase === 'infrastructure')!.artifactName).toBeTruthy();
    expect(outcome.steps.find((s) => s.phase === 'deployment')!.applyCommands.some((c) => c.startsWith('helm upgrade'))).toBe(true);
  });

  it('ROLLBACK returns a reverse-order plan and executes nothing', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ep = createEnvironmentProvisioning(rt, { clock });
    const rb = await ep.cloud().rollback();
    expect(rb.executed).toBe(false);
    expect(rb.steps[0]).toContain('monitoring'); // reverse order — monitoring first
    expect(rb.steps.some((s) => s.includes('never delete data'))).toBe(true); // DB safety
  });
});
