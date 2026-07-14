/**
 * VMware vSphere DomainCollectors (P6.6). Each collector discovers ONE vSphere object type via the P6.0
 * `DomainCollector` contract — it lists the objects through the session transport, maps each into a
 * `CloudResource` with its typed relationships, and returns a `DiscoveryPage`. The Discovery Engine degrades a
 * domain on 403 (unauthorized) / 404 (a service not present → unprovisioned) and sinks the resources into the
 * Resource Store + Graph.
 *
 * vSphere specifics: the vCenter IS the account (`accountId` = vCenter). The Automation REST API has NO
 * pagination — a list endpoint returns a full array — but it CAPS a list at ~1000 objects and returns a 400
 * ("too many matches") rather than paging. So the VM collector NEVER issues an unfiltered `GET /api/vcenter/vm`
 * (which would hit the cap on a large vCenter); it fans out PER HOST (`?hosts=<id>`), which bounds every request
 * and yields the `runs_on` edge for free — the same aggregate→per-container pattern GCP uses for regions. Objects
 * reference each other by managed-object id (MOID: `vm-42`, `host-12`, `datastore-15`, `network-18`), and every
 * resource's `nativeId` is that MOID, so the graph resolves runs_on / member_of / connected_to / backed_by edges.
 *
 * Relationship note: `/api/vcenter/vm` summaries carry no host/pool/network/datastore, and the VM-list FilterSpec
 * has no datastore/network filter — so VM→network and VM→datastore come from the per-VM detail
 * (`nics[].backing.network` is a MOID; `disks[].backing.vmdk_file` is `"[datastore-name] …"`, resolved to a MOID
 * via the datastore name index). Detail is one GET per VM, so it is BOUNDED (`MAX_VM_DETAIL`); beyond the bound a
 * VM still carries its runs_on / member_of edges, just not its storage/network edges.
 */
import {
  makeResource,
  type DomainCollector,
  type DiscoveryContext,
  type DiscoveryPage,
  type InfrastructureDomain,
  type ResourceAttributes,
  type ResourceHealth,
  type ResourceRelationship,
} from '@neuropause/shared';
import { isTooManyMatches, vmwareGet, vmwareList } from './vmwareClient';
import { AuthError, NetworkError } from '../../unified/sync/http';

/** A systemic transport failure (session dead / vCenter offline) — must degrade the domain, never be swallowed. */
const isSystemic = (err: unknown): boolean => err instanceof AuthError || err instanceof NetworkError;

/** Bound the per-VM detail fan-out (network/datastore edges). Beyond it, VMs keep runs_on/member_of only. */
export const MAX_VM_DETAIL = 500;

type Rec = Record<string, unknown>;
type MappedResource = {
  nativeId: string;
  name: string;
  status?: string | null;
  health?: ResourceHealth;
  tags?: Record<string, string>;
  attributes?: ResourceAttributes;
  relationships?: ResourceRelationship[];
};

/* ── shared helpers ──────────────────────────────────────────────────────────── */

const s = (v: unknown): string | null => (v == null ? null : String(v).trim() || null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const arr = <T = Rec>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const objOf = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {});
const rel = (type: ResourceRelationship['type'], targetId: string | null | undefined): ResourceRelationship[] =>
  targetId ? [{ type, targetId: String(targetId) }] : [];
const enc = encodeURIComponent;
function pget(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const k of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Rec)[k];
  }
  return cur;
}
const page = (resources: DiscoveryPage['resources']): DiscoveryPage => ({ resources, cursor: null, hasMore: false });

function build(ctx: DiscoveryContext, domain: InfrastructureDomain, resourceType: string, m: MappedResource) {
  return makeResource({
    platformId: ctx.platformId,
    provider: 'vmware',
    accountId: ctx.accountId,
    domain,
    resourceType,
    region: null, // a vCenter has no region; the vCenter IS the account scope.
    now: ctx.now,
    nativeId: m.nativeId,
    name: m.name,
    status: m.status,
    health: m.health,
    tags: m.tags,
    attributes: m.attributes,
    relationships: m.relationships,
  });
}

/* ── simple list collectors (one list request, one map) ────────────────────────── */

interface SimpleSpec {
  id: string;
  domain: InfrastructureDomain;
  label: string;
  resourceType: string;
  path: string;
  map: (item: Rec) => MappedResource;
}
function simpleCollector(spec: SimpleSpec): DomainCollector {
  return {
    id: spec.id,
    domain: spec.domain,
    label: spec.label,
    resourceTypes: [spec.resourceType],
    collect: async (ctx) => {
      const items = await vmwareList(ctx.http, spec.path);
      const resources = items
        .map(spec.map)
        .filter((m) => m.nativeId)
        .map((m) => build(ctx, spec.domain, spec.resourceType, m));
      return page(resources);
    },
  };
}

const vmPowerHealth = (state: string | null): ResourceHealth => (state === 'POWERED_ON' ? 'healthy' : state === 'SUSPENDED' ? 'degraded' : 'unknown');

const SIMPLE: SimpleSpec[] = [
  {
    id: 'vmware_clusters', domain: 'compute', label: 'Clusters', resourceType: 'cluster', path: '/api/vcenter/cluster',
    map: (c) => ({ nativeId: s(c.cluster) ?? '', name: s(c.name) || 'cluster', status: c.drs_enabled ? 'drs' : 'manual', health: 'healthy', attributes: { drsEnabled: c.drs_enabled === true, haEnabled: c.ha_enabled === true } }),
  },
  {
    id: 'vmware_resource_pools', domain: 'compute', label: 'Resource Pools', resourceType: 'resource_pool', path: '/api/vcenter/resource-pool',
    map: (r) => ({ nativeId: s(r.resource_pool) ?? '', name: s(r.name) || 'resource-pool', health: 'healthy' }),
  },
  {
    id: 'vmware_folders', domain: 'compute', label: 'Folders', resourceType: 'folder', path: '/api/vcenter/folder',
    map: (f) => ({ nativeId: s(f.folder) ?? '', name: s(f.name) || 'folder', status: s(f.type), health: 'healthy', attributes: { type: s(f.type) } }),
  },
  {
    id: 'vmware_datacenters', domain: 'compute', label: 'Datacenters', resourceType: 'datacenter', path: '/api/vcenter/datacenter',
    map: (d) => ({ nativeId: s(d.datacenter) ?? '', name: s(d.name) || 'datacenter', health: 'healthy' }),
  },
  {
    id: 'vmware_datastores', domain: 'storage', label: 'Datastores', resourceType: 'datastore', path: '/api/vcenter/datastore',
    map: (d) => {
      const cap = num(d.capacity) ?? 0;
      const free = num(d.free_space) ?? 0;
      const ratio = cap > 0 ? free / cap : 1;
      return {
        nativeId: s(d.datastore) ?? '', name: s(d.name) || 'datastore', status: s(d.type),
        health: cap <= 0 ? 'unknown' : ratio < 0.05 ? 'critical' : ratio < 0.15 ? 'degraded' : 'healthy',
        attributes: { type: s(d.type), capacity: cap || null, freeSpace: free || null, usedPercent: cap > 0 ? Math.round((1 - ratio) * 100) : null },
      };
    },
  },
  {
    id: 'vmware_networks', domain: 'networking', label: 'Networks', resourceType: 'network', path: '/api/vcenter/network',
    map: (n) => ({ nativeId: s(n.network) ?? '', name: s(n.name) || 'network', status: s(n.type), health: 'healthy', attributes: { type: s(n.type) } }),
  },
];

/* ── custom collectors (multi-request: fan-out / inversion / id→detail) ─────────── */

interface VmAcc {
  summary: Rec;
  host?: string;
  resourcePools: Set<string>;
  networks: Set<string>;
  datastores: Set<string>;
}
function upsertVm(map: Map<string, VmAcc>, summary: Rec): VmAcc | null {
  const id = s(summary.vm);
  if (!id) return null;
  let acc = map.get(id);
  if (!acc) {
    acc = { summary, resourcePools: new Set(), networks: new Set(), datastores: new Set() };
    map.set(id, acc);
  } else {
    acc.summary = { ...acc.summary, ...summary };
  }
  return acc;
}

/** Virtual Machines — per-host fan-out (cap-safe + runs_on), per-pool inversion (member_of), bounded detail
 *  (connected_to network + backed_by datastore). */
const vmCollector: DomainCollector = {
  id: 'vmware_vms',
  domain: 'compute',
  label: 'Virtual Machines',
  resourceTypes: ['virtual_machine'],
  collect: async (ctx) => {
    const http = ctx.http;
    // 1. datastore name → MOID (a disk backing names its datastore as `[name]`, not a MOID). A duplicated name
    //    across datacenters is marked AMBIGUOUS (null) so we never emit a confidently-wrong backed_by edge.
    const dsByName = new Map<string, string | null>();
    for (const ds of await vmwareList(http, '/api/vcenter/datastore')) {
      const id = s(ds.datastore);
      const name = s(ds.name);
      if (!id || !name) continue;
      if (!dsByName.has(name)) dsByName.set(name, id);
      else if (dsByName.get(name) !== id) dsByName.set(name, null); // collision → ambiguous, resolve to no edge
    }
    const vmMap = new Map<string, VmAcc>();
    // 2a. Fast path — a modest vCenter answers the unfiltered VM list directly (and catches host-less VMs like
    //     templates). A large vCenter returns a 400 "too many matches" (the ~1000 cap, no pagination); THAT is the
    //     signal to fan out per host. A real error (auth/network) still propagates so the domain degrades cleanly.
    try {
      for (const vm of await vmwareList(http, '/api/vcenter/vm')) upsertVm(vmMap, vm);
    } catch (err) {
      if (!isTooManyMatches(err)) throw err;
    }
    // 2b. Per-host fan-out — bounds every list under the cap, stamps runs_on, and IS the enumeration when the
    //     unfiltered list was capped. The host LIST is allowed to fail only when the fast path already enumerated
    //     VMs (then it's just runs_on enrichment); if it is the sole enumeration (capped fast path), a failure
    //     degrades the domain. A single over-full host is skipped, but a SYSTEMIC failure (auth/offline) degrades.
    let hosts: Rec[] = [];
    try {
      hosts = await vmwareList(http, '/api/vcenter/host');
    } catch (err) {
      if (vmMap.size === 0) throw err; // the fan-out was the enumeration — surface the failure, don't silent-empty
    }
    for (const h of hosts) {
      const hostId = s(h.host);
      if (!hostId) continue;
      try {
        for (const vm of await vmwareList(http, `/api/vcenter/vm?hosts=${enc(hostId)}`)) {
          const acc = upsertVm(vmMap, vm);
          if (acc) acc.host = hostId;
        }
      } catch (err) {
        if (isSystemic(err)) throw err; // a dead session mid-fan-out degrades, rather than returning a silent 0
        // else one over-full / odd host — skip it
      }
    }
    // 3. Per-resource-pool inversion — member_of resource_pool (pure enrichment; VMs are already enumerated).
    try {
      for (const rp of await vmwareList(http, '/api/vcenter/resource-pool')) {
        const rpId = s(rp.resource_pool);
        if (!rpId) continue;
        try {
          for (const vm of await vmwareList(http, `/api/vcenter/vm?resource_pools=${enc(rpId)}`)) {
            upsertVm(vmMap, vm)?.resourcePools.add(rpId);
          }
        } catch (err) {
          if (isSystemic(err)) throw err;
        }
      }
    } catch (err) {
      if (isSystemic(err)) throw err; // a dead session degrades; a non-systemic pool-list failure just skips member_of
    }
    // 4. Bounded per-VM detail — the only source for connected_to(network) + backed_by(datastore).
    let detailed = 0;
    for (const [vmId, acc] of vmMap) {
      if (detailed >= MAX_VM_DETAIL) break;
      detailed += 1;
      try {
        const info = await vmwareGet(http, `/api/vcenter/vm/${enc(vmId)}`);
        for (const nic of Object.values(objOf(info.nics))) {
          const net = s(pget(nic, 'backing.network'));
          if (net) acc.networks.add(net);
        }
        for (const disk of Object.values(objOf(info.disks))) {
          const vmdk = s(pget(disk, 'backing.vmdk_file'));
          const dsName = vmdk ? /^\[([^\]]+)\]/.exec(vmdk)?.[1] : null;
          const dsId = dsName ? dsByName.get(dsName) : null;
          if (dsId) acc.datastores.add(dsId);
        }
      } catch {
        /* a VM removed mid-scan is skipped, not fatal */
      }
    }
    // 5. Build resources.
    const resources = [...vmMap.values()].map((acc) => {
      const power = s(acc.summary.power_state);
      return build(ctx, 'compute', 'virtual_machine', {
        nativeId: s(acc.summary.vm) ?? '',
        name: s(acc.summary.name) || s(acc.summary.vm) || 'vm',
        status: power,
        health: vmPowerHealth(power),
        attributes: { powerState: power, cpuCount: num(acc.summary.cpu_count), memoryMiB: num(acc.summary.memory_size_MiB), host: acc.host ?? null },
        relationships: [
          ...rel('runs_on', acc.host),
          ...[...acc.resourcePools].flatMap((r) => rel('member_of', r)),
          ...[...acc.networks].flatMap((n) => rel('connected_to', n)),
          ...[...acc.datastores].flatMap((d) => rel('backed_by', d)),
        ],
      });
    });
    return page(resources);
  },
};

/** Hosts — the full list (incl. standalone hosts) + a per-cluster inversion for the member_of(cluster) edge. */
const hostCollector: DomainCollector = {
  id: 'vmware_hosts',
  domain: 'compute',
  label: 'Hosts',
  resourceTypes: ['host'],
  collect: async (ctx) => {
    const http = ctx.http;
    const clusterOf = new Map<string, string>();
    for (const c of await vmwareList(http, '/api/vcenter/cluster')) {
      const cId = s(c.cluster);
      if (!cId) continue;
      try {
        for (const h of await vmwareList(http, `/api/vcenter/host?clusters=${enc(cId)}`)) {
          const hId = s(h.host);
          if (hId) clusterOf.set(hId, cId);
        }
      } catch {
        /* best-effort */
      }
    }
    const hosts = await vmwareList(http, '/api/vcenter/host');
    const resources = hosts
      .map((h) => {
        const hostId = s(h.host);
        if (!hostId) return null;
        const cs = s(h.connection_state);
        const cluster = clusterOf.get(hostId);
        return build(ctx, 'compute', 'host', {
          nativeId: hostId,
          name: s(h.name) || 'host',
          status: cs,
          health: cs === 'CONNECTED' ? 'healthy' : cs === 'NOT_RESPONDING' ? 'critical' : cs === 'DISCONNECTED' ? 'degraded' : 'unknown',
          attributes: { connectionState: cs, powerState: s(h.power_state), cluster: cluster ?? null },
          relationships: rel('member_of', cluster),
        });
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    return page(resources);
  },
};

/** Content Libraries — the ids list, then a per-id detail for name/type + the backed_by(datastore) edge. */
const contentLibraryCollector: DomainCollector = {
  id: 'vmware_content_libraries',
  domain: 'storage',
  label: 'Content Libraries',
  resourceTypes: ['content_library'],
  collect: async (ctx) => {
    const ids = await vmwareList<unknown>(ctx.http, '/api/content/library');
    const resources: DiscoveryPage['resources'] = [];
    for (const raw of ids) {
      const id = typeof raw === 'string' ? raw : s((raw as Rec)?.id);
      if (!id) continue;
      try {
        const lib = await vmwareGet<Rec>(ctx.http, `/api/content/library/${enc(id)}`);
        const backings = arr(lib.storage_backings).flatMap((b) => rel('backed_by', s((b as Rec).datastore_id)));
        resources.push(build(ctx, 'storage', 'content_library', {
          nativeId: id,
          name: s(lib.name) || 'library',
          status: s(lib.type),
          health: 'healthy',
          attributes: { type: s(lib.type), published: pget(lib, 'publish_info.published') === true },
          relationships: backings,
        }));
      } catch {
        /* a library removed mid-scan is skipped */
      }
    }
    return page(resources);
  },
};

/** Tags — the vAPI tagging ids list, then a per-id detail for name + category (category kept as an attribute). */
const tagCollector: DomainCollector = {
  id: 'vmware_tags',
  domain: 'compute',
  label: 'Tags',
  resourceTypes: ['tag'],
  collect: async (ctx) => {
    const ids = await vmwareList<unknown>(ctx.http, '/api/cis/tagging/tag');
    const resources: DiscoveryPage['resources'] = [];
    for (const raw of ids) {
      const id = typeof raw === 'string' ? raw : s((raw as Rec)?.id);
      if (!id) continue;
      try {
        const t = await vmwareGet<Rec>(ctx.http, `/api/cis/tagging/tag/${enc(id)}`);
        resources.push(build(ctx, 'compute', 'tag', {
          nativeId: id,
          name: s(t.name) || 'tag',
          health: 'healthy',
          attributes: { category: s(t.category_id), description: s(t.description) },
        }));
      } catch {
        /* a tag removed mid-scan is skipped */
      }
    }
    return page(resources);
  },
};

/** Every VMware collector, across the three vSphere infrastructure domains (compute / storage / networking). */
export const VMWARE_COLLECTORS: DomainCollector[] = [
  vmCollector,
  hostCollector,
  ...SIMPLE.map(simpleCollector),
  contentLibraryCollector,
  tagCollector,
];
