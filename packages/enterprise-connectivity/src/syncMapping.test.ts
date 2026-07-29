import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createIntegrationPlatform } from '@neuropause/integration-platform';
import { createEnterpriseConnectivity } from './platform';

describe('E9 / E10 — synchronization + data mapping', () => {
  it('REFUSES sync until the connector is configured, then computes a REAL diff (reused engine)', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ip = createIntegrationPlatform(rt, { clock });
    const ec = createEnterpriseConnectivity(rt, { clock, integrationPlatform: ip });

    const conn = await ec.connectors().register({ name: 'acme-crm', category: 'crm', system: 'Salesforce' });
    const refused = await ec.synchronization().sync({ connectorId: conn.id, mode: 'full', source: [{ id: 'a' }], target: [] });
    expect(refused.refused).toBe(true); // not configured

    await ec.connectors().configure(conn.id, 'vault:acme/sfdc');
    await ec.connectors().verify(conn.id, { verified: true, evidenceRef: 'proof' });
    const outcome = await ec.synchronization().sync({ connectorId: conn.id, mode: 'incremental', source: [{ id: 'a', v: 1 }, { id: 'b', v: 1 }], target: [{ id: 'b', v: 1 }] });
    expect(outcome.refused).toBe(false);
    expect(outcome.reusedIntegration).toBe(true);
    expect(outcome.added).toContain('a'); // real diff
    expect(outcome.unchanged).toContain('b');
  });

  it('maps fields and converts JSON→CSV via the REUSED transformation engine', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ip = createIntegrationPlatform(rt, { clock });
    const ec = createEnterpriseConnectivity(rt, { clock, integrationPlatform: ip });

    const schema = await ec.dataMapping().registerSchema({ name: 'account', requiredFields: ['name'] });
    expect(schema.reusedIntegration).toBe(true);
    const mapped = ec.dataMapping().map({ first: 'ada', extra: 'x' }, [{ from: 'first', to: 'name', transform: 'upper' }]);
    expect(mapped['name']).toBe('ADA'); // real transform
    const csv = ec.dataMapping().jsonToCsv([{ name: 'ADA' }]);
    expect(csv).toContain('ADA');
    const v = await ec.dataMapping().saveVersion({ name: 'account', fields: [{ from: 'first', to: 'name' }] });
    expect(v.version).toBe(1);
  });
});
