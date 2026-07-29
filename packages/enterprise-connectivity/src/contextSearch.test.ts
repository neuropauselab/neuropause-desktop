import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createIntegrationPlatform } from '@neuropause/integration-platform';
import { createEnterpriseConnectivity } from './platform';

async function activate(ec: ReturnType<typeof createEnterpriseConnectivity>, category: 'crm' | 'erp' | 'storage', system: string): Promise<void> {
  const conn = await ec.connectors().register({ name: `acme-${category}`, category, system });
  await ec.connectors().configure(conn.id, `vault:acme/${category}`);
  await ec.connectors().verify(conn.id, { verified: true, evidenceRef: 'proof' });
}

describe('E11 / E12 — workspace context + enterprise search', () => {
  it('assembles workspace context ONLY from active connectors', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ip = createIntegrationPlatform(rt, { clock });
    const ec = createEnterpriseConnectivity(rt, { clock, integrationPlatform: ip });

    const empty = await ec.workspaceContext().assemble();
    expect(empty.availableCount).toBe(0); // nothing active yet

    await activate(ec, 'crm', 'Salesforce');
    await activate(ec, 'erp', 'SAP');
    const ctx = await ec.workspaceContext().assemble();
    expect(ctx.slices.find((s) => s.source === 'crm')!.available).toBe(true);
    expect(ctx.slices.find((s) => s.source === 'crm')!.connectorSystem).toBe('Salesforce');
    expect(ctx.slices.find((s) => s.source === 'tasks')!.available).toBe(false); // no connector backs it
  });

  it('searches represented metadata for ACTIVE connectors only', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ip = createIntegrationPlatform(rt, { clock });
    const ec = createEnterpriseConnectivity(rt, { clock, integrationPlatform: ip });

    // a registered-but-inactive connector is not searchable
    await ec.connectors().register({ name: 'acme-crm', category: 'crm', system: 'Salesforce' });
    expect((await ec.search().search({ query: 'account' })).searchedConnectors).toBe(0);

    await activate(ec, 'storage', 'Google Drive');
    const res = await ec.search().search({ query: 'file' });
    expect(res.searchedConnectors).toBe(1);
    expect(res.hits.some((h) => h.connectorSystem === 'Google Drive')).toBe(true);
    expect(ec.search().permissions().searchableConnectors).toBe(1);
  });
});
