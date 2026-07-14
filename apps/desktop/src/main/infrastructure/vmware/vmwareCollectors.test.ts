/**
 * P6.6 — the VMware DomainCollectors: the VM per-host fan-out (the large-vCenter over-cap → per-host enumeration,
 * with runs_on), the per-resource-pool inversion (member_of), the per-VM detail edges (connected_to network,
 * backed_by datastore resolved from the `[datastore-name]` disk backing), host→cluster membership, datastore
 * utilization health, the simple list collectors, content-library storage backing, and the Resource Graph
 * projection. Pure-node; the session transport is faked with taxonomy-accurate errors (so the over-cap 400 is a
 * real HttpError the collector recognizes).
 */
import { describe, expect, it } from 'vitest';
import {
  buildResourceGraph,
  makeResourceId,
  type DiscoveryContext,
  type DiscoveryHttp,
  type DiscoveryRequest,
} from '@neuropause/shared';
import { VMWARE_COLLECTORS } from './vmwareCollectors';
import { errorFor } from './vmwareClient';
import { AuthError } from '../../unified/sync/http';

const NOW = '2026-07-13T00:00:00.000Z';
const collector = (id: string) => VMWARE_COLLECTORS.find((c) => c.id === id)!;

function fakeVmware(router: (req: DiscoveryRequest) => { status?: number; text?: string } | undefined): DiscoveryHttp {
  return {
    getJson: async () => ({ data: {}, status: 200, headers: {} }),
    send: async (req) => {
      const r = router(req) ?? { text: '[]' };
      if (r.status && r.status >= 400) throw errorFor(r.status, {}, r.text ?? '');
      return { status: r.status ?? 200, headers: {}, text: r.text ?? '' };
    },
  };
}
const ctx = (http: DiscoveryHttp): DiscoveryContext => ({ platformId: 'vmware', accountId: 'vc1', region: null, cursor: null, now: NOW, http });
const j = (v: unknown) => JSON.stringify(v);
const TOO_MANY = j({ messages: [{ default_message: 'Too many virtual machines. Add more filter criteria.' }] });

describe('VMware Virtual Machines — large-vCenter fan-out + relationships', () => {
  const router = (req: DiscoveryRequest) => {
    const u = req.url;
    if (u === '/api/vcenter/datastore') return { text: j([{ datastore: 'datastore-1', name: 'ds1', capacity: 100, free_space: 60 }]) };
    if (u === '/api/vcenter/vm') return { status: 400, text: TOO_MANY }; // unfiltered list is over the ~1000 cap
    if (u === '/api/vcenter/host') return { text: j([{ host: 'host-1' }, { host: 'host-2' }]) };
    if (u === '/api/vcenter/vm?hosts=host-1') return { text: j([{ vm: 'vm-1', name: 'web01', power_state: 'POWERED_ON', cpu_count: 2, memory_size_MiB: 4096 }]) };
    if (u === '/api/vcenter/vm?hosts=host-2') return { text: j([{ vm: 'vm-2', name: 'db01', power_state: 'POWERED_OFF' }]) };
    if (u === '/api/vcenter/resource-pool') return { text: j([{ resource_pool: 'resgroup-1' }]) };
    if (u === '/api/vcenter/vm?resource_pools=resgroup-1') return { text: j([{ vm: 'vm-1', name: 'web01' }]) };
    if (u === '/api/vcenter/vm/vm-1') return { text: j({ nics: { '4000': { backing: { network: 'network-1' } } }, disks: { '2000': { backing: { vmdk_file: '[ds1] web01/web01.vmdk' } } } }) };
    if (u === '/api/vcenter/vm/vm-2') return { text: j({ nics: {}, disks: {} }) };
    return undefined;
  };

  it('falls back to per-host enumeration when the unfiltered VM list is over the cap, stamping runs_on', async () => {
    const p = await collector('vmware_vms').collect(ctx(fakeVmware(router)));
    const byId = Object.fromEntries(p.resources.map((r) => [r.nativeId, r]));
    expect(Object.keys(byId).sort()).toEqual(['vm-1', 'vm-2']);
    expect(byId['vm-1'].id).toBe(makeResourceId('vmware', 'vc1', 'virtual_machine', 'vm-1'));
    expect(byId['vm-1'].health).toBe('healthy'); // POWERED_ON
    expect(byId['vm-2'].health).toBe('unknown'); // POWERED_OFF
    expect(byId['vm-1'].relationships.map((r) => `${r.type}:${r.targetId}`).sort()).toEqual([
      'backed_by:datastore-1', // resolved from the disk's `[ds1]` backing via the datastore name index
      'connected_to:network-1', // from the VM detail nics backing
      'member_of:resgroup-1', // from the resource-pool inversion
      'runs_on:host-1', // from the per-host fan-out
    ].sort());
    expect(byId['vm-2'].relationships.map((r) => `${r.type}:${r.targetId}`)).toEqual(['runs_on:host-2']);
    expect(p.cursor).toBeNull();
  });

  it('uses the unfiltered list directly on a modest vCenter (fast path)', async () => {
    const small = (req: DiscoveryRequest) => {
      if (req.url === '/api/vcenter/datastore') return { text: '[]' };
      if (req.url === '/api/vcenter/vm') return { text: j([{ vm: 'vm-9', name: 'solo', power_state: 'SUSPENDED' }]) };
      return { text: '[]' };
    };
    const p = await collector('vmware_vms').collect(ctx(fakeVmware(small)));
    expect(p.resources).toHaveLength(1);
    expect(p.resources[0].nativeId).toBe('vm-9');
    expect(p.resources[0].health).toBe('degraded'); // SUSPENDED
  });
});

describe('VMware VM discovery — resilience', () => {
  it('a SYSTEMIC failure (dead session) during the per-host fan-out degrades the domain, not a silent 0', async () => {
    const router = (req: DiscoveryRequest) => {
      if (req.url === '/api/vcenter/datastore') return { text: '[]' };
      if (req.url === '/api/vcenter/vm') return { status: 400, text: TOO_MANY }; // capped → fan-out is the enumeration
      if (req.url === '/api/vcenter/host') return { text: j([{ host: 'host-1' }]) };
      if (req.url === '/api/vcenter/vm?hosts=host-1') return { status: 403, text: '{"error_type":"UNAUTHENTICATED"}' };
      return undefined;
    };
    await expect(collector('vmware_vms').collect(ctx(fakeVmware(router)))).rejects.toBeInstanceOf(AuthError);
  });

  it('a single over-full / broken host (non-systemic) is skipped; other hosts still enumerate', async () => {
    const router = (req: DiscoveryRequest) => {
      if (req.url === '/api/vcenter/datastore') return { text: '[]' };
      if (req.url === '/api/vcenter/vm') return { status: 400, text: TOO_MANY };
      if (req.url === '/api/vcenter/host') return { text: j([{ host: 'host-1' }, { host: 'host-2' }]) };
      if (req.url === '/api/vcenter/vm?hosts=host-1') return { status: 500, text: '{"error_type":"INTERNAL"}' }; // one bad host
      if (req.url === '/api/vcenter/vm?hosts=host-2') return { text: j([{ vm: 'vm-2', name: 'ok', power_state: 'POWERED_ON' }]) };
      return undefined;
    };
    const p = await collector('vmware_vms').collect(ctx(fakeVmware(router)));
    expect(p.resources.map((r) => r.nativeId)).toEqual(['vm-2']);
  });

  it('an ambiguous datastore name (two datastores share a name) yields NO backed_by edge (never a wrong one)', async () => {
    const router = (req: DiscoveryRequest) => {
      if (req.url === '/api/vcenter/datastore') return { text: j([{ datastore: 'datastore-1', name: 'dup' }, { datastore: 'datastore-2', name: 'dup' }]) };
      if (req.url === '/api/vcenter/vm') return { text: j([{ vm: 'vm-1', name: 'web', power_state: 'POWERED_ON' }]) };
      if (req.url === '/api/vcenter/vm/vm-1') return { text: j({ nics: {}, disks: { '2000': { backing: { vmdk_file: '[dup] web/web.vmdk' } } } }) };
      return { text: '[]' };
    };
    const p = await collector('vmware_vms').collect(ctx(fakeVmware(router)));
    expect(p.resources[0].relationships.filter((r) => r.type === 'backed_by')).toEqual([]);
  });
});

describe('VMware Hosts / Datastores', () => {
  it('maps a host with member_of(cluster) from the per-cluster inversion', async () => {
    const router = (req: DiscoveryRequest) => {
      if (req.url === '/api/vcenter/cluster') return { text: j([{ cluster: 'domain-c7', name: 'Cluster1' }]) };
      if (req.url === '/api/vcenter/host?clusters=domain-c7') return { text: j([{ host: 'host-1' }]) };
      if (req.url === '/api/vcenter/host') return { text: j([{ host: 'host-1', name: 'esxi1', connection_state: 'CONNECTED', power_state: 'POWERED_ON' }, { host: 'host-2', name: 'esxi2', connection_state: 'NOT_RESPONDING' }]) };
      return undefined;
    };
    const p = await collector('vmware_hosts').collect(ctx(fakeVmware(router)));
    const byId = Object.fromEntries(p.resources.map((r) => [r.nativeId, r]));
    expect(byId['host-1'].health).toBe('healthy');
    expect(byId['host-1'].relationships).toEqual([{ type: 'member_of', targetId: 'domain-c7' }]);
    expect(byId['host-2'].health).toBe('critical'); // NOT_RESPONDING
    expect(byId['host-2'].relationships).toEqual([]); // standalone (no cluster)
  });

  it('datastore health reflects utilization (a nearly-full datastore is critical)', async () => {
    const router = () => ({ text: j([
      { datastore: 'datastore-1', name: 'healthy-ds', type: 'VMFS', capacity: 100, free_space: 60 },
      { datastore: 'datastore-2', name: 'full-ds', type: 'VMFS', capacity: 100, free_space: 2 },
    ]) });
    const p = await collector('vmware_datastores').collect(ctx(fakeVmware(router)));
    const byId = Object.fromEntries(p.resources.map((r) => [r.nativeId, r]));
    expect(byId['datastore-1'].health).toBe('healthy');
    expect(byId['datastore-1'].attributes.usedPercent).toBe(40);
    expect(byId['datastore-2'].health).toBe('critical'); // 2% free
  });
});

describe('VMware simple + id-detail collectors', () => {
  it('maps clusters, networks, and folders', async () => {
    const cl = await collector('vmware_clusters').collect(ctx(fakeVmware(() => ({ text: j([{ cluster: 'domain-c7', name: 'Prod', drs_enabled: true, ha_enabled: true }]) }))));
    expect(cl.resources[0].nativeId).toBe('domain-c7');
    expect(cl.resources[0].attributes).toMatchObject({ drsEnabled: true, haEnabled: true });
    const net = await collector('vmware_networks').collect(ctx(fakeVmware(() => ({ text: j([{ network: 'network-1', name: 'VM Network', type: 'DISTRIBUTED_PORTGROUP' }]) }))));
    expect(net.resources[0].attributes.type).toBe('DISTRIBUTED_PORTGROUP');
    const fd = await collector('vmware_folders').collect(ctx(fakeVmware(() => ({ text: j([{ folder: 'group-v3', name: 'vm', type: 'VIRTUAL_MACHINE' }]) }))));
    expect(fd.resources[0].nativeId).toBe('group-v3');
  });

  it('content library resolves backed_by(datastore) from its storage backing', async () => {
    const router = (req: DiscoveryRequest) => {
      if (req.url === '/api/content/library') return { text: j(['lib-1']) };
      if (req.url === '/api/content/library/lib-1') return { text: j({ id: 'lib-1', name: 'Prod Library', type: 'LOCAL', storage_backings: [{ type: 'DATASTORE', datastore_id: 'datastore-1' }] }) };
      return undefined;
    };
    const p = await collector('vmware_content_libraries').collect(ctx(fakeVmware(router)));
    expect(p.resources[0].nativeId).toBe('lib-1');
    expect(p.resources[0].relationships).toEqual([{ type: 'backed_by', targetId: 'datastore-1' }]);
  });

  it('tags resolve name + category (id-then-detail)', async () => {
    const router = (req: DiscoveryRequest) => {
      if (req.url === '/api/cis/tagging/tag') return { text: j(['tag-1']) };
      if (req.url === '/api/cis/tagging/tag/tag-1') return { text: j({ id: 'tag-1', name: 'prod', category_id: 'cat-9', description: 'production' }) };
      return undefined;
    };
    const p = await collector('vmware_tags').collect(ctx(fakeVmware(router)));
    expect(p.resources[0].nativeId).toBe('tag-1');
    expect(p.resources[0].name).toBe('prod');
    expect(p.resources[0].attributes.category).toBe('cat-9');
  });
});

describe('VMware Resource Graph projection', () => {
  it('projects VM + Host + Network + Datastore and resolves runs_on / connected_to / backed_by (+ blast radius)', async () => {
    const router = (req: DiscoveryRequest) => {
      const u = req.url;
      if (u === '/api/vcenter/datastore') return { text: j([{ datastore: 'datastore-1', name: 'ds1', capacity: 100, free_space: 50 }]) };
      if (u === '/api/vcenter/vm') return { text: j([{ vm: 'vm-1', name: 'web01', power_state: 'POWERED_ON' }]) };
      if (u === '/api/vcenter/host') return { text: j([{ host: 'host-1', name: 'esxi1', connection_state: 'CONNECTED' }]) };
      if (u === '/api/vcenter/vm?hosts=host-1') return { text: j([{ vm: 'vm-1', name: 'web01', power_state: 'POWERED_ON' }]) };
      if (u === '/api/vcenter/resource-pool') return { text: '[]' };
      if (u === '/api/vcenter/vm/vm-1') return { text: j({ nics: { '4000': { backing: { network: 'network-1' } } }, disks: { '2000': { backing: { vmdk_file: '[ds1] web01/web01.vmdk' } } } }) };
      if (u === '/api/vcenter/network') return { text: j([{ network: 'network-1', name: 'VM Network', type: 'STANDARD_PORTGROUP' }]) };
      if (u === '/api/vcenter/cluster') return { text: '[]' };
      return undefined;
    };
    const http = fakeVmware(router);
    const resources = [
      ...(await collector('vmware_vms').collect(ctx(http))).resources,
      ...(await collector('vmware_hosts').collect(ctx(http))).resources,
      ...(await collector('vmware_networks').collect(ctx(http))).resources,
      ...(await collector('vmware_datastores').collect(ctx(http))).resources,
    ];
    const model = buildResourceGraph({ resources }, Date.parse(NOW));
    expect(model.resources).toHaveLength(4);
    // vm runs_on host + connected_to network + backed_by datastore = 3 resolved edges.
    expect(model.edges).toHaveLength(3);
    expect(model.edges.map((e) => e.type).sort()).toEqual(['backed_by', 'connected_to', 'runs_on']);
    const hostId = makeResourceId('vmware', 'vc1', 'host', 'host-1');
    expect(model.insights.topBlastRadius.some((r) => r.resourceId === hostId)).toBe(true);
  });
});

describe('VMware platform — one adapter, the three vSphere domains', () => {
  it('the collectors span compute / storage / networking', () => {
    const domains = new Set(VMWARE_COLLECTORS.map((c) => c.domain));
    for (const d of ['compute', 'storage', 'networking'] as const) expect(domains.has(d)).toBe(true);
    expect(VMWARE_COLLECTORS).toHaveLength(10);
  });
});
