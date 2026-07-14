/**
 * P6.2 — the Azure DomainCollectors: ARM + Microsoft Graph JSON parsing, nextLink / @odata.nextLink pagination,
 * run-scoped incremental cursor, sub-resource enumeration (subnets inline; SQL databases per-server), the
 * kind-driven resource type (function_app vs app_service), relationship mapping, and the Resource Graph
 * projection. Pure-node; the bearer transport is faked (canned Azure responses), so the mapping logic is fully
 * covered without a live tenant.
 */
import { describe, expect, it } from 'vitest';
import {
  buildResourceGraph,
  makeResource,
  makeResourceId,
  toDiscoveryCursor,
  type DiscoveryContext,
  type DiscoveryHttp,
  type DiscoveryRequest,
} from '@neuropause/shared';
import { AZURE_COLLECTORS } from './azureCollectors';

const NOW = '2026-07-13T00:00:00.000Z';
const collector = (id: string) => AZURE_COLLECTORS.find((c) => c.id === id)!;

/** A fake bearer transport routing canned responses by request URL. */
function fakeAzure(router: (req: DiscoveryRequest) => { status?: number; body: string }): DiscoveryHttp {
  return {
    getJson: async () => ({ data: {}, status: 200, headers: {} }),
    send: async (req) => {
      const r = router(req);
      if (r.status && r.status >= 400) throw Object.assign(new Error('http'), { status: r.status });
      return { status: r.status ?? 200, headers: {}, text: r.body };
    },
  };
}
const ctx = (http: DiscoveryHttp, cursor: string | null = null): DiscoveryContext =>
  ({ platformId: 'azure', accountId: 'sub-1', region: null, cursor, now: NOW, http });

const SUB = '/subscriptions/sub-1/resourceGroups/rg/providers';

describe('Azure compute (ARM) — mapping, health, relationships, run-scoped pagination', () => {
  const vmId = `${SUB}/Microsoft.Compute/virtualMachines/vm1`;
  const nicId = `${SUB}/Microsoft.Network/networkInterfaces/nic1`;
  const page1 = JSON.stringify({
    value: [{ id: vmId, name: 'vm1', location: 'eastus', properties: { provisioningState: 'Succeeded', hardwareProfile: { vmSize: 'Standard_D2s_v3' }, networkProfile: { networkInterfaces: [{ id: nicId }] } } }],
    nextLink: 'https://management.azure.com/next?token=2',
  });
  const page2 = JSON.stringify({ value: [{ id: `${SUB}/Microsoft.Compute/virtualMachines/vm2`, name: 'vm2', location: 'westus', properties: { provisioningState: 'Failed' } }] });

  it('maps a VM with health + connected_to NIC and pages via nextLink', async () => {
    const http = fakeAzure((req) => ({ body: req.url.includes('token=2') ? page2 : page1 }));
    const p1 = await collector('azure_virtual_machines').collect(ctx(http));
    expect(p1.resources).toHaveLength(1);
    const vm = p1.resources[0];
    expect(vm.id).toBe(makeResourceId('azure', 'sub-1', 'virtual_machine', vmId));
    expect(vm.name).toBe('vm1');
    expect(vm.region).toBe('eastus');
    expect(vm.health).toBe('healthy');
    expect(vm.attributes.vmSize).toBe('Standard_D2s_v3');
    expect(vm.relationships).toEqual([{ type: 'connected_to', targetId: nicId }]);
    expect(p1.hasMore).toBe(true);
    expect(JSON.parse(p1.cursor as string)).toEqual({ token: 'https://management.azure.com/next?token=2', runAt: NOW });

    const p2 = await collector('azure_virtual_machines').collect(ctx(http, p1.cursor));
    expect(p2.resources[0].name).toBe('vm2');
    expect(p2.resources[0].health).toBe('critical'); // Failed
    expect(p2.hasMore).toBe(false);
    expect(p2.cursor).toBeNull();
  });

  it('drops a STALE cross-run cursor (a fresh run restarts the snapshot)', async () => {
    let sawNext = false;
    const http = fakeAzure((req) => {
      if (req.url.includes('token=2')) sawNext = true;
      return { body: page1 };
    });
    await collector('azure_virtual_machines').collect(ctx(http, toDiscoveryCursor({ token: 'https://management.azure.com/next?token=2', runAt: '2020-01-01T00:00:00.000Z' })));
    expect(sawNext).toBe(false);
  });
});

describe('Azure identity (Microsoft Graph)', () => {
  it('discovers Entra users against graph.microsoft.com with @odata.nextLink', async () => {
    let host = '';
    const http = fakeAzure((req) => {
      host = new URL(req.url).hostname;
      return { body: JSON.stringify({ value: [{ id: 'u1', displayName: 'Alice', userPrincipalName: 'alice@x.com', accountEnabled: true }, { id: 'u2', displayName: 'Bob', accountEnabled: false }], '@odata.nextLink': null }) };
    });
    const p = await collector('azure_entra_users').collect(ctx(http));
    expect(host).toBe('graph.microsoft.com');
    expect(p.resources.map((r) => r.name)).toEqual(['Alice', 'Bob']);
    expect(p.resources[0].id).toBe(makeResourceId('azure', 'sub-1', 'entra_user', 'u1'));
    expect(p.resources[1].health).toBe('degraded'); // disabled account
    expect(p.hasMore).toBe(false);
  });
});

describe('Azure networking — subnets expanded inline from the VNet list', () => {
  it('emits subnet resources with member_of/protected_by/uses from the VNet response', async () => {
    const vnetId = `${SUB}/Microsoft.Network/virtualNetworks/vnet1`;
    const body = JSON.stringify({
      value: [{
        id: vnetId, name: 'vnet1', location: 'eastus',
        properties: { provisioningState: 'Succeeded', subnets: [{ id: `${vnetId}/subnets/sub1`, name: 'sub1', properties: { addressPrefix: '10.0.1.0/24', networkSecurityGroup: { id: `${SUB}/Microsoft.Network/networkSecurityGroups/nsg1` }, routeTable: { id: `${SUB}/Microsoft.Network/routeTables/rt1` } } }] },
      }],
    });
    const http = fakeAzure(() => ({ body }));
    const p = await collector('azure_subnets').collect(ctx(http));
    expect(p.resources).toHaveLength(1);
    const sn = p.resources[0];
    expect(sn.nativeId).toBe(`${vnetId}/subnets/sub1`);
    expect(sn.relationships.map((r) => `${r.type}:${r.targetId.split('/').pop()}`).sort()).toEqual(['member_of:vnet1', 'protected_by:nsg1', 'uses:rt1']);
  });
});

describe('Azure sub-resource enumeration + kind-driven type', () => {
  it('enumerates SQL databases per server with hosted_by', async () => {
    const srvId = `${SUB}/Microsoft.Sql/servers/srv1`;
    const http = fakeAzure((req) => {
      if (req.url.includes('Microsoft.Sql/servers?')) return { body: JSON.stringify({ value: [{ id: srvId, name: 'srv1', location: 'eastus', properties: { state: 'Ready' } }] }) };
      if (req.url.includes('/servers/srv1/databases')) return { body: JSON.stringify({ value: [{ id: `${srvId}/databases/db1`, name: 'db1', location: 'eastus', properties: { status: 'Online' } }] }) };
      return { body: JSON.stringify({ value: [] }) };
    });
    const p = await collector('azure_sql_databases').collect(ctx(http));
    expect(p.resources.map((r) => r.name)).toEqual(['db1']);
    expect(p.resources[0].health).toBe('healthy');
    expect(p.resources[0].relationships).toEqual([{ type: 'hosted_by', targetId: srvId }]);
    expect(p.hasMore).toBe(false);
  });

  it('maps Web sites to function_app vs app_service by kind', async () => {
    const http = fakeAzure(() => ({ body: JSON.stringify({ value: [
      { id: `${SUB}/Microsoft.Web/sites/fn1`, name: 'fn1', location: 'eastus', kind: 'functionapp,linux', properties: { state: 'Running' } },
      { id: `${SUB}/Microsoft.Web/sites/web1`, name: 'web1', location: 'eastus', kind: 'app', properties: { state: 'Running' } },
    ] }) }));
    const p = await collector('azure_web_sites').collect(ctx(http));
    const byName = Object.fromEntries(p.resources.map((r) => [r.name, r.resourceType]));
    expect(byName.fn1).toBe('function_app');
    expect(byName.web1).toBe('app_service');
  });
});

describe('Azure Resource Graph projection', () => {
  it('projects VNet + subnet + NIC + VM and resolves every edge (+ blast radius)', async () => {
    const vnetId = `${SUB}/Microsoft.Network/virtualNetworks/vnet1`;
    const subnetId = `${vnetId}/subnets/sub1`;
    const nicId = `${SUB}/Microsoft.Network/networkInterfaces/nic1`;
    const vmId = `${SUB}/Microsoft.Compute/virtualMachines/vm1`;
    const http = fakeAzure((req) => {
      if (req.url.includes('Microsoft.Network/virtualNetworks')) return { body: JSON.stringify({ value: [{ id: vnetId, name: 'vnet1', location: 'eastus', properties: { provisioningState: 'Succeeded', subnets: [{ id: subnetId, name: 'sub1', properties: { addressPrefix: '10.0.1.0/24' } }] } }] }) };
      if (req.url.includes('Microsoft.Network/networkInterfaces')) return { body: JSON.stringify({ value: [{ id: nicId, name: 'nic1', location: 'eastus', properties: { provisioningState: 'Succeeded', ipConfigurations: [{ properties: { subnet: { id: subnetId } } }] } }] }) };
      if (req.url.includes('Microsoft.Compute/virtualMachines')) return { body: JSON.stringify({ value: [{ id: vmId, name: 'vm1', location: 'eastus', properties: { provisioningState: 'Succeeded', networkProfile: { networkInterfaces: [{ id: nicId }] } } }] }) };
      return { body: JSON.stringify({ value: [] }) };
    });
    const resources = [
      ...(await collector('azure_virtual_networks').collect(ctx(http))).resources,
      ...(await collector('azure_subnets').collect(ctx(http))).resources,
      ...(await collector('azure_network_interfaces').collect(ctx(http))).resources,
      ...(await collector('azure_virtual_machines').collect(ctx(http))).resources,
    ];
    const model = buildResourceGraph({ resources }, Date.parse(NOW));
    expect(model.resources).toHaveLength(4);
    // subnet member_of vnet; nic member_of subnet; vm connected_to nic = 3 resolved edges.
    expect(model.edges).toHaveLength(3);
    expect(model.edges.map((e) => e.type).sort()).toEqual(['connected_to', 'member_of', 'member_of']);
    // The VNet is the deepest dependency — the whole chain transitively depends on it.
    const vnetResId = makeResourceId('azure', 'sub-1', 'virtual_network', vnetId);
    expect(model.insights.topBlastRadius.some((r) => r.resourceId === vnetResId)).toBe(true);
  });

  it('resolves a cross-resource edge despite Azure ARM id case differences', () => {
    // Azure returns the resourceGroups segment with inconsistent casing across APIs: the NIC reports its subnet
    // id with `resourceGroups/RG` while the subnet's own id says `resourceGroups/rg`. The edge must still resolve.
    const subnetCanonical = `${SUB}/Microsoft.Network/virtualNetworks/vnet1/subnets/sub1`;
    const subnetAsSeenByNic = subnetCanonical.replace('/resourceGroups/rg/', '/resourceGroups/RG/');
    const nic = makeResource({ platformId: 'azure', provider: 'azure', accountId: 'sub-1', domain: 'networking', resourceType: 'network_interface', nativeId: `${SUB}/Microsoft.Network/networkInterfaces/nic1`, name: 'nic1', now: NOW, relationships: [{ type: 'member_of', targetId: subnetAsSeenByNic }] });
    const subnet = makeResource({ platformId: 'azure', provider: 'azure', accountId: 'sub-1', domain: 'networking', resourceType: 'subnet', nativeId: subnetCanonical, name: 'sub1', now: NOW });
    const model = buildResourceGraph({ resources: [nic, subnet] }, Date.parse(NOW));
    expect(model.edges).toHaveLength(1);
    expect(model.edges[0].type).toBe('member_of');
  });
});

describe('Azure platform — one adapter, all domains', () => {
  it('the collectors span the Azure infrastructure domains', () => {
    const domains = new Set(AZURE_COLLECTORS.map((c) => c.domain));
    for (const d of ['identity', 'compute', 'networking', 'storage', 'databases', 'containers', 'serverless', 'monitoring', 'secrets', 'certificates', 'dns'] as const) {
      expect(domains.has(d)).toBe(true);
    }
    expect(AZURE_COLLECTORS.length).toBeGreaterThanOrEqual(20);
  });
});
