/**
 * Docker DomainCollectors (P6.5). Each collector discovers ONE Docker Engine object type via the P6.0
 * `DomainCollector` contract — it lists the objects through the pinned engine transport, maps each into a
 * `CloudResource` with its typed relationships, and returns a `DiscoveryPage`. The Discovery Engine degrades a
 * domain on 403 (unauthorized) / 404 (a Swarm endpoint on a non-manager engine → unprovisioned) and sinks the
 * resources into the Resource Store + Graph.
 *
 * Docker specifics: the ENGINE is the account (`accountId` = engine/host). The Engine API has NO pagination —
 * every list endpoint returns a full JSON array (or `{ Volumes: [...] }`), so each collector returns a single
 * page with a null cursor. Objects reference each other by native id — a container's `ImageID` / `NetworkID` /
 * mount `Name`, a task's `NodeID` / `ServiceID`, a service's `SecretID` / `ConfigID` — and every resource's
 * `nativeId` is that same native id (the Docker `Id` / `ID` / `Name`), so the graph resolves
 * uses / connected_to / attached_to / runs_on / member_of edges. Swarm object types (nodes, services, tasks,
 * secrets, configs) simply 404-degrade `unprovisioned` on a standalone engine.
 *
 * SECURITY: a Docker Secret's value is NEVER returned by the Engine API, and a Docker Config's `Spec.Data`
 * (base64) IS returned by the list endpoint — this collector drops it and emits ONLY metadata (name, labels,
 * a byte-size count), never the payload. No secret/config material ever enters a resource, attribute, or log.
 */
import {
  makeResource,
  type DomainCollector,
  type InfrastructureDomain,
  type ResourceAttributes,
  type ResourceHealth,
  type ResourceRelationship,
} from '@neuropause/shared';
import { dockerList } from './dockerClient';

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

interface DockerCollectorSpec {
  id: string;
  domain: InfrastructureDomain;
  label: string;
  resourceType: string;
  /** The relative list path, e.g. `/containers/json?all=true`. */
  path: string;
  /** The wrapper key for endpoints that don't return a bare array (`/volumes` → `Volumes`). */
  listKey?: string;
  map: (item: Rec) => MappedResource;
}

/** Build a `DomainCollector` from a spec. The Engine API has no pagination, so this is one page, null cursor. */
function makeDockerCollector(spec: DockerCollectorSpec): DomainCollector {
  return {
    id: spec.id,
    domain: spec.domain,
    label: spec.label,
    resourceTypes: [spec.resourceType],
    collect: async (ctx) => {
      const items = await dockerList(ctx.http, spec.path, spec.listKey);
      const resources = items
        .map(spec.map)
        .filter((m) => m.nativeId)
        .map((m) =>
          makeResource({
            platformId: ctx.platformId,
            provider: 'docker',
            accountId: ctx.accountId,
            domain: spec.domain,
            resourceType: spec.resourceType,
            region: null, // a Docker engine has no region; the engine IS the account scope.
            now: ctx.now,
            nativeId: m.nativeId,
            name: m.name,
            status: m.status,
            health: m.health,
            tags: m.tags,
            attributes: m.attributes,
            relationships: m.relationships,
          }),
        );
      return { resources, cursor: null, hasMore: false };
    },
  };
}

/* ── shared helpers ──────────────────────────────────────────────────────────── */

const s = (v: unknown): string | null => (v == null ? null : String(v).trim() || null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const arr = <T = Rec>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const rel = (type: ResourceRelationship['type'], targetId: string | null | undefined): ResourceRelationship[] =>
  targetId ? [{ type, targetId: String(targetId) }] : [];
function labelsOf(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (v && typeof v === 'object') for (const [k, val] of Object.entries(v as Rec)) out[k] = val == null ? '' : String(val);
  return out;
}
function pget(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const k of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Rec)[k];
  }
  return cur;
}
const shortId = (id: string | null): string => (id ? id.replace(/^sha256:/, '').slice(0, 12) : '');

/** Container lifecycle → health. */
function containerHealth(state: string | null): ResourceHealth {
  switch (state) {
    case 'running': return 'healthy';
    case 'paused': case 'restarting': case 'removing': return 'degraded';
    case 'exited': case 'dead': return 'critical';
    default: return 'unknown';
  }
}
/** Swarm task state → health. */
function taskHealth(state: string | null): ResourceHealth {
  switch (state) {
    case 'running': case 'complete': return 'healthy';
    case 'failed': case 'rejected': case 'orphaned': return 'critical';
    case 'shutdown': return 'degraded';
    case 'new': case 'pending': case 'assigned': case 'accepted': case 'preparing': case 'starting': return 'degraded';
    default: return 'unknown';
  }
}

/* ── the collectors ──────────────────────────────────────────────────────────── */

const CONTAINERS: DockerCollectorSpec[] = [
  {
    id: 'docker_containers', domain: 'containers', label: 'Containers', resourceType: 'container', path: '/containers/json?all=true',
    map: (c) => {
      const state = s(c.State);
      const netMap = pget(c, 'NetworkSettings.Networks');
      const networkRefs = netMap && typeof netMap === 'object'
        ? Object.values(netMap as Rec).flatMap((n) => rel('connected_to', s(pget(n, 'NetworkID'))))
        : [];
      const volumeRefs = arr(c.Mounts).flatMap((m) => (s((m as Rec).Type) === 'volume' ? rel('attached_to', s((m as Rec).Name)) : []));
      const names = arr<string>(c.Names).map((n) => String(n).replace(/^\//, ''));
      return {
        nativeId: s(c.Id) ?? '',
        name: names[0] || shortId(s(c.Id)) || 'container',
        status: s(c.Status) ?? state,
        health: containerHealth(state),
        tags: labelsOf(c.Labels),
        attributes: { image: s(c.Image), imageId: s(c.ImageID), state, status: s(c.Status), created: num(c.Created) },
        relationships: [
          ...rel('uses', s(c.ImageID)),
          ...networkRefs,
          ...volumeRefs,
        ],
      };
    },
  },
  {
    id: 'docker_images', domain: 'containers', label: 'Images', resourceType: 'image', path: '/images/json',
    map: (img) => {
      const tags = arr<string>(img.RepoTags).map(String).filter((t) => t && t !== '<none>:<none>');
      return {
        nativeId: s(img.Id) ?? '',
        name: tags[0] || shortId(s(img.Id)) || 'image',
        status: tags.length ? 'tagged' : 'dangling',
        health: 'healthy',
        tags: labelsOf(img.Labels),
        attributes: { size: num(img.Size), containers: num(img.Containers), repoTags: tags.join(',') || null, created: num(img.Created) },
      };
    },
  },
  {
    id: 'docker_plugins', domain: 'containers', label: 'Plugins', resourceType: 'plugin', path: '/plugins',
    map: (p) => ({
      nativeId: s(p.Id) ?? '',
      name: s(p.Name) || shortId(s(p.Id)) || 'plugin',
      status: p.Enabled === true ? 'enabled' : 'disabled',
      health: p.Enabled === true ? 'healthy' : 'degraded',
      attributes: { enabled: p.Enabled === true, description: s(pget(p, 'Config.Description')) },
    }),
  },
];

const COMPUTE: DockerCollectorSpec[] = [
  {
    id: 'docker_swarm_nodes', domain: 'compute', label: 'Swarm Nodes', resourceType: 'swarm_node', path: '/nodes',
    map: (n) => {
      const state = s(pget(n, 'Status.State'));
      const availability = s(pget(n, 'Spec.Availability'));
      const health: ResourceHealth = state === 'down' ? 'critical' : availability && availability !== 'active' ? 'degraded' : state === 'ready' ? 'healthy' : 'unknown';
      return {
        nativeId: s(n.ID) ?? '',
        name: s(pget(n, 'Description.Hostname')) || s(pget(n, 'Spec.Name')) || s(n.ID) || 'node',
        status: state,
        health,
        tags: labelsOf(pget(n, 'Spec.Labels')),
        attributes: {
          role: s(pget(n, 'Spec.Role')),
          availability,
          state,
          engineVersion: s(pget(n, 'Description.Engine.EngineVersion')),
          leader: pget(n, 'ManagerStatus.Leader') === true,
          reachability: s(pget(n, 'ManagerStatus.Reachability')),
        },
      };
    },
  },
  {
    id: 'docker_services', domain: 'containers', label: 'Swarm Services', resourceType: 'swarm_service', path: '/services',
    map: (svc) => {
      const replicated = pget(svc, 'Spec.Mode.Replicated');
      const desired = replicated ? num(pget(svc, 'Spec.Mode.Replicated.Replicas')) : null;
      const isGlobal = pget(svc, 'Spec.Mode.Global') != null;
      const running = num(pget(svc, 'ServiceStatus.RunningTasks'));
      const desiredTasks = num(pget(svc, 'ServiceStatus.DesiredTasks'));
      let health: ResourceHealth = 'unknown';
      if (running != null && desiredTasks != null) {
        health = desiredTasks === 0 ? 'unknown' : running >= desiredTasks ? 'healthy' : running > 0 ? 'degraded' : 'critical';
      }
      const secretRefs = arr(pget(svc, 'Spec.TaskTemplate.ContainerSpec.Secrets')).flatMap((x) => rel('uses', s((x as Rec).SecretID)));
      const configRefs = arr(pget(svc, 'Spec.TaskTemplate.ContainerSpec.Configs')).flatMap((x) => rel('uses', s((x as Rec).ConfigID)));
      const netRefs = [
        ...arr(pget(svc, 'Spec.TaskTemplate.Networks')).flatMap((x) => rel('connected_to', s((x as Rec).Target))),
        ...arr(pget(svc, 'Endpoint.VirtualIPs')).flatMap((x) => rel('connected_to', s((x as Rec).NetworkID))),
      ];
      return {
        nativeId: s(svc.ID) ?? '',
        name: s(pget(svc, 'Spec.Name')) || s(svc.ID) || 'service',
        status: isGlobal ? 'global' : `replicated ${running ?? '?'}/${desired ?? '?'}`,
        health,
        tags: labelsOf(pget(svc, 'Spec.Labels')),
        attributes: {
          mode: isGlobal ? 'global' : 'replicated',
          replicas: desired,
          running,
          image: s(pget(svc, 'Spec.TaskTemplate.ContainerSpec.Image')),
        },
        relationships: [...secretRefs, ...configRefs, ...dedupeRefs(netRefs)],
      };
    },
  },
  {
    id: 'docker_tasks', domain: 'containers', label: 'Swarm Tasks', resourceType: 'swarm_task', path: '/tasks',
    map: (t) => {
      const state = s(pget(t, 'Status.State'));
      const slot = num(t.Slot);
      return {
        nativeId: s(t.ID) ?? '',
        name: `${shortId(s(t.ServiceID)) || 'task'}.${slot ?? shortId(s(t.ID))}`,
        status: state,
        health: taskHealth(state),
        attributes: { serviceId: s(t.ServiceID), nodeId: s(t.NodeID), state, desiredState: s(t.DesiredState), slot },
        relationships: [
          ...rel('runs_on', s(t.NodeID)),
          ...rel('member_of', s(t.ServiceID)),
        ],
      };
    },
  },
];

const NETWORKING: DockerCollectorSpec[] = [
  {
    id: 'docker_networks', domain: 'networking', label: 'Networks', resourceType: 'network', path: '/networks',
    map: (n) => ({
      nativeId: s(n.Id) ?? '',
      name: s(n.Name) || shortId(s(n.Id)) || 'network',
      status: s(n.Driver),
      health: 'healthy',
      tags: labelsOf(n.Labels),
      attributes: { driver: s(n.Driver), scope: s(n.Scope), internal: n.Internal === true, attachable: n.Attachable === true, ingress: n.Ingress === true },
    }),
  },
];

const STORAGE: DockerCollectorSpec[] = [
  {
    id: 'docker_volumes', domain: 'storage', label: 'Volumes', resourceType: 'volume', path: '/volumes', listKey: 'Volumes',
    map: (v) => ({
      nativeId: s(v.Name) ?? '',
      name: s(v.Name) || 'volume',
      status: s(v.Scope) ?? 'local',
      health: 'healthy',
      tags: labelsOf(v.Labels),
      attributes: { driver: s(v.Driver), scope: s(v.Scope), mountpoint: s(v.Mountpoint) },
    }),
  },
  {
    // Docker NEVER returns a secret's value via the API — only metadata exists to surface. Emit name + labels only.
    id: 'docker_secrets', domain: 'storage', label: 'Secrets', resourceType: 'secret', path: '/secrets',
    map: (sec) => ({
      nativeId: s(sec.ID) ?? '',
      name: s(pget(sec, 'Spec.Name')) || s(sec.ID) || 'secret',
      status: 'managed',
      health: 'healthy',
      tags: labelsOf(pget(sec, 'Spec.Labels')),
      attributes: { createdAt: s(sec.CreatedAt), updatedAt: s(sec.UpdatedAt) },
    }),
  },
  {
    // A Config's `Spec.Data` (base64) IS returned by the list endpoint — DROP it; emit only name, labels, and a
    // byte-size COUNT (never the payload). The size is derived from the base64 length without decoding the data.
    id: 'docker_configs', domain: 'storage', label: 'Configs', resourceType: 'config', path: '/configs',
    map: (cfg) => {
      const b64 = s(pget(cfg, 'Spec.Data'));
      const bytes = b64 ? Math.floor((b64.replace(/=+$/, '').length * 3) / 4) : 0;
      return {
        nativeId: s(cfg.ID) ?? '',
        name: s(pget(cfg, 'Spec.Name')) || s(cfg.ID) || 'config',
        status: 'managed',
        health: 'healthy',
        tags: labelsOf(pget(cfg, 'Spec.Labels')),
        attributes: { createdAt: s(cfg.CreatedAt), bytes },
      };
    },
  },
];

/** Drop duplicate (type,target) relationship pairs — a service can list a network in both places. */
function dedupeRefs(refs: ResourceRelationship[]): ResourceRelationship[] {
  const seen = new Set<string>();
  const out: ResourceRelationship[] = [];
  for (const r of refs) {
    const k = `${r.type}:${r.targetId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

/** Every Docker collector, across the four Docker infrastructure domains (containers/compute/networking/storage). */
export const DOCKER_COLLECTORS: DomainCollector[] = [
  ...CONTAINERS,
  ...COMPUTE,
  ...NETWORKING,
  ...STORAGE,
].map(makeDockerCollector);
