import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createSecurityPlatform } from '@neuropause/security';
import { createCustomerDeploymentPlatform, type CustomerDeploymentPlatform } from './platform';

async function newDeployment(cd: CustomerDeploymentPlatform): Promise<string> {
  const customer = await cd.runtime().registerCustomer({ name: 'Acme' });
  const tenant = await cd.runtime().createTenant({ customerId: customer.id, name: 'acme' });
  const env = await cd.runtime().createEnvironment({ tenantId: tenant.id, tier: 'pilot' });
  const deployment = await cd.runtime().createDeployment({ customerId: customer.id, tenantId: tenant.id, environmentId: env.id });
  return deployment.id;
}

describe('E4 — identity federation', () => {
  it('represents all seven providers as adapter-verified until configured', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const cd = createCustomerDeploymentPlatform(rt, { clock });
    const deploymentId = await newDeployment(cd);
    expect(cd.identityFederation().providers()).toHaveLength(7);
    const conn = await cd.identityFederation().connect({ deploymentId, provider: 'Okta' });
    expect(conn.status).toBe('represented');
  });

  it('REALLY synchronizes users through the reused security identity platform', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const sec = createSecurityPlatform(rt, { clock });
    const cd = createCustomerDeploymentPlatform(rt, { clock, security: sec });
    const deploymentId = await newDeployment(cd);

    const result = await cd.identityFederation().syncUsers({
      deploymentId,
      provider: 'Microsoft Entra ID',
      users: [
        { externalId: 'aad-1', displayName: 'Alice' },
        { externalId: 'aad-2', displayName: 'Bob' },
      ],
      groups: ['engineering'],
    });
    expect(result.reusedSecurity).toBe(true);
    expect(result.syncedCount).toBe(2);
    expect(result.users.every((u) => u.identityId)).toBe(true);
    expect(result.groupsMapped).toBe(1);
    expect(cd.identityFederation().validate(result).valid).toBe(true);
  });

  it('without a security platform, users are NOT synced (never fabricated)', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const cd = createCustomerDeploymentPlatform(rt, { clock });
    const deploymentId = await newDeployment(cd);
    const result = await cd.identityFederation().syncUsers({ deploymentId, provider: 'LDAP', users: [{ externalId: 'x', displayName: 'X' }] });
    expect(result.reusedSecurity).toBe(false);
    expect(result.syncedCount).toBe(0);
    expect(cd.identityFederation().validate(result).valid).toBe(false);
  });
});
