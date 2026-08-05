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

describe('E2-E8 — phase provisioners reuse Program 1B and never provision', () => {
  it('marks a phase PENDING when automation is absent', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ep = createEnvironmentProvisioning(rt, { clock }); // no platformAutomation
    const step = await ep.provisioner().provision('infrastructure', FULL);
    expect(step.status).toBe('pending');
    expect(step.missing).toContain('platformAutomation');
    expect(step.provisioned).toBe(false);
  });

  it('marks a phase PENDING when a required operator input is missing', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const platformAutomation = createPlatformAutomation(rt, { clock });
    const ep = createEnvironmentProvisioning(rt, { clock, platformAutomation });
    const step = await ep.provisioner().provision('dns-tls', { ...FULL, dnsZoneRef: undefined });
    expect(step.status).toBe('pending');
    expect(step.missing).toContain('dnsZoneRef');
  });

  it('PREPARES a phase by reusing the 1B generator when inputs + approval are present', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const platformAutomation = createPlatformAutomation(rt, { clock });
    const ep = createEnvironmentProvisioning(rt, { clock, platformAutomation });

    const k8s = await ep.provisioner().provision('kubernetes', FULL);
    expect(k8s.status).toBe('prepared');
    expect(k8s.provisioned).toBe(false);
    expect(k8s.artifactName).toContain('.yaml'); // reused 1B kubernetes generator
    expect(k8s.applyCommands.some((c) => c.startsWith('kubectl apply'))).toBe(true);

    const tf = await ep.provisioner().provision('infrastructure', FULL);
    expect(tf.applyCommands.some((c) => c.startsWith('terraform plan'))).toBe(true); // plan only
    expect(tf.applyCommands.join(' ')).not.toContain('terraform apply'); // never auto-applies
  });
});
