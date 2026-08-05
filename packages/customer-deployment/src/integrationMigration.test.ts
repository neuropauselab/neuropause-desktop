import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createIntegrationPlatform } from '@neuropause/integration-platform';
import { createCustomerDeploymentPlatform, type CustomerDeploymentPlatform } from './platform';

async function newDeployment(cd: CustomerDeploymentPlatform): Promise<string> {
  const customer = await cd.runtime().registerCustomer({ name: 'Acme' });
  const tenant = await cd.runtime().createTenant({ customerId: customer.id, name: 'acme' });
  const env = await cd.runtime().createEnvironment({ tenantId: tenant.id, tier: 'pilot' });
  return (await cd.runtime().createDeployment({ customerId: customer.id, tenantId: tenant.id, environmentId: env.id })).id;
}

describe('E5 / E6 — integration activation + data migration', () => {
  it('activates an integration only with BOTH credentials and verification', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ip = createIntegrationPlatform(rt, { clock });
    const cd = createCustomerDeploymentPlatform(rt, { clock, integrationPlatform: ip });
    const deploymentId = await newDeployment(cd);

    const represented = await cd.integrationActivation().activate({ deploymentId, category: 'erp', system: 'SAP S/4HANA' });
    expect(represented.status).toBe('represented');
    expect(represented.reusedIntegrationPlatform).toBe(true);

    const configured = await cd.integrationActivation().activate({ deploymentId, category: 'crm', system: 'Salesforce', credentialRef: 'vault:acme/sfdc' });
    expect(configured.status).toBe('configured'); // creds but no verification → not active

    const active = await cd.integrationActivation().activate({ deploymentId, category: 'manufacturing', system: 'MES', credentialRef: 'vault:acme/mes', verified: true });
    expect(active.status).toBe('active');
    expect(active.credentialRef).toBe('vault:acme/mes'); // a reference, never a secret value
    expect(cd.integrationActivation().activeCount()).toBe(1);
  });

  it('dry-runs a migration over REAL sample records only — never fabricating data', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const cd = createCustomerDeploymentPlatform(rt, { clock });
    const deploymentId = await newDeployment(cd);

    const plan = await cd.migration().plan({ deploymentId, source: 'legacy-erp', entities: [{ name: 'customers', sourceRecordCount: 5000 }] });
    await cd.migration().defineMapping(plan.id, [{ from: 'cust_name', to: 'displayName' }]);

    const empty = await cd.migration().dryRun(plan.id);
    expect(empty.recordsProcessed).toBe(0); // no fabricated data

    const dry = await cd.migration().dryRun(plan.id, [{ cust_name: 'Acme Corp', legacy_id: 42 }]);
    expect(dry.recordsProcessed).toBe(1);
    expect(dry.transformed[0]!['displayName']).toBe('Acme Corp');
    expect(dry.unmappedFields).toContain('legacy_id');

    const roll = await cd.migration().rollbackPlan(plan.id);
    expect(roll.steps.length).toBeGreaterThan(0);
    const verify = cd.migration().verify(plan.id, dry);
    expect(verify.note).toContain('5000');
  });
});
