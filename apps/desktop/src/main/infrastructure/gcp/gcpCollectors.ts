/**
 * Google Cloud DomainCollectors (P6.3). Each collector discovers ONE GCP resource type via the P6.0
 * `DomainCollector` contract — it fetches one page of a GCP REST list (a plain list, or a Compute
 * `aggregatedList` across zones/regions) through the bearer transport, maps each item into a `CloudResource`
 * with its typed relationships, and returns a `DiscoveryPage` carrying the GCP `nextPageToken` as the
 * incremental cursor. The Discovery Engine drives paging, persists the cursor, degrades a domain on
 * 401/403/404, and sinks resources into the Resource Store + Graph.
 *
 * GCP specifics: discovery is PROJECT-wide (`accountId` = project id). Compute resources are zonal/regional, so
 * they use `aggregatedList` (all zones in one paged call — no per-zone fan-out). Relationships reference other
 * resources by selfLink; `relName` normalizes both sides to the relative resource name so they resolve. The
 * pagination token is run-scoped (a fresh run restarts the current-state snapshot; store-dedup makes re-walk the
 * correct incremental model, matching the P6.0 full-list pattern).
 */
import {
  makeResource,
  parseDiscoveryCursor,
  toDiscoveryCursor,
  type DomainCollector,
  type InfrastructureDomain,
  type ResourceAttributes,
  type ResourceHealth,
  type ResourceRelationship,
} from '@neuropause/shared';
import { gcpAggregated, gcpList, gcpListAll, relName } from './gcpClient';
import type { DiscoveryHttp } from '@neuropause/shared';

/* ── API base URLs ──────────────────────────────────────────────────────────── */
const COMPUTE = 'https://compute.googleapis.com/compute/v1';
const IAM = 'https://iam.googleapis.com/v1';
const STORAGE = 'https://storage.googleapis.com/storage/v1';
const SQL = 'https://sqladmin.googleapis.com/v1';
const SPANNER = 'https://spanner.googleapis.com/v1';
const GKE = 'https://container.googleapis.com/v1';
const RUN = 'https://run.googleapis.com/v2';
const FUNCTIONS = 'https://cloudfunctions.googleapis.com/v2';
const MONITORING = 'https://monitoring.googleapis.com/v3';
const LOGGING = 'https://logging.googleapis.com/v2';
const SECRETMANAGER = 'https://secretmanager.googleapis.com/v1';
const CERTMANAGER = 'https://certificatemanager.googleapis.com/v1';
const DNS = 'https://dns.googleapis.com/dns/v1';
const ARTIFACT = 'https://artifactregistry.googleapis.com/v1';

type Rec = Record<string, unknown>;
type MappedResource = {
  nativeId: string;
  name: string;
  status?: string | null;
  health?: ResourceHealth;
  region?: string | null;
  tags?: Record<string, string>;
  attributes?: ResourceAttributes;
  relationships?: ResourceRelationship[];
};

interface GcpCollectorSpec {
  id: string;
  domain: InfrastructureDomain;
  label: string;
  resourceType: string;
  /** The list base URL for a project (without `pageToken`). Required unless `fetchAll` is set. */
  baseUrl?: (project: string) => string;
  /** For a plain list: the array field name (`items` / `instances` / `secrets` / …). */
  listKey?: string;
  /** For a Compute aggregatedList: the per-scope resource-array key. */
  aggregated?: string;
  /** A custom one-shot fetcher (for APIs with no aggregate `-` location, e.g. Cloud Run + Certificate Manager,
   *  which must enumerate locations then list per-location). Returns all items; the page has no cursor. */
  fetchAll?: (http: DiscoveryHttp, project: string) => Promise<Rec[]>;
  map: (item: Rec) => MappedResource;
}

/** Append a query param to a URL that may already carry `?` (e.g. Storage's `?project=`). */
function appendParam(url: string, key: string, value: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(value)}`;
}

/** Build a `DomainCollector` from a spec — cursor handling, mapping, and `makeResource` are uniform. */
function makeGcpCollector(spec: GcpCollectorSpec): DomainCollector {
  return {
    id: spec.id,
    domain: spec.domain,
    label: spec.label,
    resourceTypes: [spec.resourceType],
    collect: async (ctx) => {
      const toResource = (raw: Rec) => {
        const m = spec.map(raw);
        return makeResource({
          platformId: ctx.platformId,
          provider: 'gcp',
          accountId: ctx.accountId,
          domain: spec.domain,
          resourceType: spec.resourceType,
          region: m.region ?? null,
          now: ctx.now,
          nativeId: m.nativeId,
          name: m.name,
          status: m.status,
          health: m.health,
          tags: m.tags,
          attributes: m.attributes,
          relationships: m.relationships,
        });
      };
      // Custom per-location fetchers enumerate everything in one run (no aggregate wildcard to page).
      if (spec.fetchAll) {
        const items = await spec.fetchAll(ctx.http, ctx.accountId);
        return { resources: items.map(toResource), cursor: null, hasMore: false };
      }
      const c = parseDiscoveryCursor(ctx.cursor);
      // Run-scoped page token: a fresh run restarts the snapshot (a GCP list is current-state).
      const token = c && c.runAt === ctx.now ? (c.token ?? null) : null;
      const base = spec.baseUrl!(ctx.accountId);
      const url = token ? appendParam(base, 'pageToken', token) : base;
      const { items, nextPageToken } = spec.aggregated
        ? await gcpAggregated(ctx.http, url, spec.aggregated)
        : await gcpList(ctx.http, url, spec.listKey ?? 'items');
      return { resources: items.map(toResource), cursor: nextPageToken ? toDiscoveryCursor({ token: nextPageToken, runAt: ctx.now }) : null, hasMore: !!nextPageToken };
    },
  };
}

/**
 * List a resource across ALL of a project's locations, for APIs that REJECT the `locations/-` aggregate wildcard
 * (Cloud Run v2, Certificate Manager): enumerate the service's locations, then list the resource per location.
 * One-shot per run. Heavier than a single aggregate call (documented perf note); region-scoping / a worker pool
 * is the enhancement.
 */
async function listPerLocation(http: DiscoveryHttp, base: string, project: string, resourceSeg: string, listKey: string): Promise<Rec[]> {
  const locations = await gcpListAll(http, `${base}/projects/${encodeURIComponent(project)}/locations`, 'locations');
  const out: Rec[] = [];
  for (const loc of locations) {
    const locId = s((loc as Rec).locationId) ?? lastSeg((loc as Rec).name);
    if (!locId) continue;
    out.push(...(await gcpListAll(http, `${base}/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(locId)}/${resourceSeg}`, listKey)));
  }
  return out;
}

/* ── shared helpers ──────────────────────────────────────────────────────────── */

const s = (v: unknown): string | null => (v == null ? null : String(v).trim() || null);
const rel = (type: ResourceRelationship['type'], targetId: string | null | undefined): ResourceRelationship[] =>
  targetId ? [{ type, targetId: String(targetId) }] : [];
const arr = <T = Rec>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : v == null ? [] : [v as T]);
/** Last path segment of a selfLink / URL (e.g. a zone/region/machineType tail). */
const lastSeg = (url: unknown): string | null => (url == null ? null : String(url).split('/').pop() || null);
/** GCP `labels` map → a flat string map (the GCP analog of tags). */
function labelsOf(item: Rec): Record<string, string> {
  const out: Record<string, string> = {};
  const l = item.labels;
  if (l && typeof l === 'object') for (const [k, v] of Object.entries(l as Rec)) out[k] = v == null ? '' : String(v);
  return out;
}
/** Deep-get a dotted path in a nested JSON object (object keys only). */
function pget(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const k of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Rec)[k];
  }
  return cur;
}
/** The location segment of a relative resource name (`projects/p/locations/{loc}/…`). */
const locFromName = (name: unknown): string | null => (name == null ? null : /\/locations\/([^/]+)/.exec(`/${String(name)}`)?.[1] ?? null);

/* ── the collectors ──────────────────────────────────────────────────────────── */

const IDENTITY: GcpCollectorSpec[] = [
  {
    id: 'gcp_service_accounts', domain: 'identity', label: 'Service Accounts', resourceType: 'service_account',
    baseUrl: (p) => `${IAM}/projects/${encodeURIComponent(p)}/serviceAccounts`, listKey: 'accounts',
    map: (a) => ({ nativeId: s(a.name) ?? s(a.uniqueId) ?? '', name: s(a.displayName) ?? s(a.email) ?? 'service account', status: a.disabled === true ? 'disabled' : 'enabled', health: a.disabled === true ? 'degraded' : 'healthy', attributes: { email: s(a.email), uniqueId: s(a.uniqueId) } }),
  },
  {
    id: 'gcp_iam_roles', domain: 'identity', label: 'Custom IAM Roles', resourceType: 'iam_role',
    baseUrl: (p) => `${IAM}/projects/${encodeURIComponent(p)}/roles`, listKey: 'roles',
    map: (r) => ({ nativeId: s(r.name) ?? '', name: s(r.title) ?? lastSeg(r.name) ?? 'role', status: s(r.stage), health: s(r.deleted) === 'true' ? 'degraded' : 'healthy', attributes: { stage: s(r.stage), description: s(r.description) } }),
  },
];

const COMPUTE_DOMAIN: GcpCollectorSpec[] = [
  {
    id: 'gcp_compute_instances', domain: 'compute', label: 'Compute Engine Instances', resourceType: 'compute_instance',
    baseUrl: (p) => `${COMPUTE}/projects/${encodeURIComponent(p)}/aggregated/instances`, aggregated: 'instances',
    map: (vm) => {
      const state = s(vm.status);
      const nic0 = arr(vm.networkInterfaces)[0] as Rec | undefined;
      return {
        nativeId: relName(s(vm.selfLink)) ?? s(vm.name) ?? '', name: s(vm.name) ?? 'instance', region: lastSeg(vm.zone), status: state,
        health: state === 'RUNNING' ? 'healthy' : state === 'TERMINATED' || state === 'STOPPING' || state === 'STOPPED' ? 'degraded' : state === 'SUSPENDED' ? 'degraded' : 'unknown',
        tags: labelsOf(vm),
        attributes: { machineType: lastSeg(vm.machineType), zone: lastSeg(vm.zone), cpuPlatform: s(vm.cpuPlatform) },
        relationships: [
          ...rel('member_of', relName(s(nic0?.network))),
          ...rel('uses', relName(s(nic0?.subnetwork))),
        ],
      };
    },
  },
  {
    id: 'gcp_instance_group_managers', domain: 'compute', label: 'Managed Instance Groups', resourceType: 'instance_group_manager',
    baseUrl: (p) => `${COMPUTE}/projects/${encodeURIComponent(p)}/aggregated/instanceGroupManagers`, aggregated: 'instanceGroupManagers',
    map: (m) => ({ nativeId: relName(s(m.selfLink)) ?? s(m.name) ?? '', name: s(m.name) ?? 'mig', region: lastSeg(m.zone) ?? lastSeg(m.region), attributes: { targetSize: Number(s(m.targetSize) ?? 0), instanceTemplate: lastSeg(m.instanceTemplate) } }),
  },
];

const NETWORKING: GcpCollectorSpec[] = [
  {
    id: 'gcp_vpc_networks', domain: 'networking', label: 'VPC Networks', resourceType: 'vpc_network',
    baseUrl: (p) => `${COMPUTE}/projects/${encodeURIComponent(p)}/global/networks`, listKey: 'items',
    map: (n) => ({ nativeId: relName(s(n.selfLink)) ?? s(n.name) ?? '', name: s(n.name) ?? 'network', region: 'global', attributes: { autoCreateSubnetworks: n.autoCreateSubnetworks === true, routingMode: s(pget(n, 'routingConfig.routingMode')) } }),
  },
  {
    id: 'gcp_subnetworks', domain: 'networking', label: 'Subnetworks', resourceType: 'subnetwork',
    baseUrl: (p) => `${COMPUTE}/projects/${encodeURIComponent(p)}/aggregated/subnetworks`, aggregated: 'subnetworks',
    map: (sn) => ({ nativeId: relName(s(sn.selfLink)) ?? s(sn.name) ?? '', name: s(sn.name) ?? 'subnet', region: lastSeg(sn.region), attributes: { ipCidrRange: s(sn.ipCidrRange), privateGoogleAccess: sn.privateIpGoogleAccess === true }, relationships: rel('member_of', relName(s(sn.network))) }),
  },
  {
    id: 'gcp_firewalls', domain: 'networking', label: 'Firewall Rules', resourceType: 'firewall',
    baseUrl: (p) => `${COMPUTE}/projects/${encodeURIComponent(p)}/global/firewalls`, listKey: 'items',
    map: (f) => ({ nativeId: relName(s(f.selfLink)) ?? s(f.name) ?? '', name: s(f.name) ?? 'firewall', region: 'global', status: f.disabled === true ? 'disabled' : 'enabled', attributes: { direction: s(f.direction), priority: Number(s(f.priority) ?? 0) }, relationships: rel('uses', relName(s(f.network))) }),
  },
  {
    id: 'gcp_routes', domain: 'networking', label: 'Routes', resourceType: 'route',
    baseUrl: (p) => `${COMPUTE}/projects/${encodeURIComponent(p)}/global/routes`, listKey: 'items',
    map: (r) => ({ nativeId: relName(s(r.selfLink)) ?? s(r.name) ?? '', name: s(r.name) ?? 'route', region: 'global', attributes: { destRange: s(r.destRange), priority: Number(s(r.priority) ?? 0) }, relationships: rel('uses', relName(s(r.network))) }),
  },
  {
    id: 'gcp_forwarding_rules', domain: 'networking', label: 'Load Balancers (Forwarding Rules)', resourceType: 'forwarding_rule',
    baseUrl: (p) => `${COMPUTE}/projects/${encodeURIComponent(p)}/aggregated/forwardingRules`, aggregated: 'forwardingRules',
    map: (fr) => ({ nativeId: relName(s(fr.selfLink)) ?? s(fr.name) ?? '', name: s(fr.name) ?? 'forwarding-rule', region: lastSeg(fr.region) ?? 'global', attributes: { ipAddress: s(fr.IPAddress), scheme: s(fr.loadBalancingScheme), portRange: s(fr.portRange) }, relationships: rel('uses', relName(s(fr.network))) }),
  },
];

const STORAGE_DOMAIN: GcpCollectorSpec[] = [
  {
    id: 'gcp_storage_buckets', domain: 'storage', label: 'Cloud Storage Buckets', resourceType: 'storage_bucket',
    baseUrl: (p) => `${STORAGE}/b?project=${encodeURIComponent(p)}`, listKey: 'items',
    map: (b) => ({ nativeId: s(b.name) ?? '', name: s(b.name) ?? 'bucket', region: s(b.location), tags: labelsOf(b), attributes: { storageClass: s(b.storageClass), locationType: s(b.locationType), versioning: pget(b, 'versioning.enabled') === true } }),
  },
];

const DATABASES: GcpCollectorSpec[] = [
  {
    id: 'gcp_cloudsql_instances', domain: 'databases', label: 'Cloud SQL Instances', resourceType: 'cloudsql_instance',
    baseUrl: (p) => `${SQL}/projects/${encodeURIComponent(p)}/instances`, listKey: 'items',
    map: (db) => {
      const state = s(db.state);
      return { nativeId: s(db.name) ?? '', name: s(db.name) ?? 'sql', region: s(db.region), status: state, health: state === 'RUNNABLE' ? 'healthy' : state === 'SUSPENDED' || state === 'STOPPED' ? 'degraded' : state === 'FAILED' ? 'critical' : 'unknown', attributes: { databaseVersion: s(db.databaseVersion), tier: s(pget(db, 'settings.tier')), connectionName: s(db.connectionName) } };
    },
  },
  {
    id: 'gcp_spanner_instances', domain: 'databases', label: 'Spanner Instances', resourceType: 'spanner_instance',
    baseUrl: (p) => `${SPANNER}/projects/${encodeURIComponent(p)}/instances`, listKey: 'instances',
    map: (i) => ({ nativeId: s(i.name) ?? '', name: s(i.displayName) ?? lastSeg(i.name) ?? 'spanner', region: lastSeg(i.config), status: s(i.state), health: s(i.state) === 'READY' ? 'healthy' : 'unknown', attributes: { nodeCount: Number(s(i.nodeCount) ?? 0), config: lastSeg(i.config) } }),
  },
];

const CONTAINERS: GcpCollectorSpec[] = [
  {
    id: 'gcp_gke_clusters', domain: 'containers', label: 'GKE Clusters', resourceType: 'gke_cluster',
    baseUrl: (p) => `${GKE}/projects/${encodeURIComponent(p)}/locations/-/clusters`, listKey: 'clusters',
    map: (c) => ({
      nativeId: relName(s(c.selfLink)) ?? s(c.name) ?? '', name: s(c.name) ?? 'cluster', region: s(c.location), status: s(c.status),
      health: s(c.status) === 'RUNNING' ? 'healthy' : s(c.status) === 'DEGRADED' ? 'degraded' : s(c.status) === 'ERROR' ? 'critical' : 'unknown',
      attributes: { nodeCount: Number(s(c.currentNodeCount) ?? 0), version: s(c.currentMasterVersion), endpoint: s(c.endpoint) },
      relationships: [
        ...rel('uses', relName(s(pget(c, 'networkConfig.network')))),
        ...rel('uses', relName(s(pget(c, 'networkConfig.subnetwork')))),
      ],
    }),
  },
  {
    id: 'gcp_artifact_repositories', domain: 'containers', label: 'Artifact Registry', resourceType: 'artifact_repository',
    baseUrl: (p) => `${ARTIFACT}/projects/${encodeURIComponent(p)}/locations/-/repositories`, listKey: 'repositories',
    map: (r) => ({ nativeId: s(r.name) ?? '', name: lastSeg(r.name) ?? 'repository', region: locFromName(r.name), tags: labelsOf(r), attributes: { format: s(r.format), mode: s(r.mode) } }),
  },
];

const SERVERLESS: GcpCollectorSpec[] = [
  {
    // Cloud Run v2 rejects the `locations/-` wildcard — enumerate locations then list per-location.
    id: 'gcp_cloud_run_services', domain: 'serverless', label: 'Cloud Run Services', resourceType: 'cloud_run_service',
    fetchAll: (http, p) => listPerLocation(http, RUN, p, 'services', 'services'),
    map: (svc) => ({ nativeId: s(svc.name) ?? '', name: lastSeg(svc.name) ?? 'service', region: locFromName(svc.name), status: s(pget(svc, 'terminalCondition.type')), health: pget(svc, 'terminalCondition.state') === 'CONDITION_SUCCEEDED' ? 'healthy' : 'unknown', tags: labelsOf(svc), attributes: { uri: s(svc.uri), ingress: s(svc.ingress) } }),
  },
  {
    id: 'gcp_cloud_functions', domain: 'serverless', label: 'Cloud Functions', resourceType: 'cloud_function',
    baseUrl: (p) => `${FUNCTIONS}/projects/${encodeURIComponent(p)}/locations/-/functions`, listKey: 'functions',
    map: (fn) => ({ nativeId: s(fn.name) ?? '', name: lastSeg(fn.name) ?? 'function', region: locFromName(fn.name), status: s(fn.state), health: s(fn.state) === 'ACTIVE' ? 'healthy' : s(fn.state) === 'FAILED' ? 'critical' : 'unknown', tags: labelsOf(fn), attributes: { runtime: s(pget(fn, 'buildConfig.runtime')), environment: s(fn.environment) } }),
  },
];

const MONITORING_DOMAIN: GcpCollectorSpec[] = [
  {
    id: 'gcp_alert_policies', domain: 'monitoring', label: 'Alert Policies', resourceType: 'alert_policy',
    baseUrl: (p) => `${MONITORING}/projects/${encodeURIComponent(p)}/alertPolicies`, listKey: 'alertPolicies',
    map: (a) => ({ nativeId: s(a.name) ?? '', name: s(a.displayName) ?? lastSeg(a.name) ?? 'alert', status: a.enabled === false ? 'disabled' : 'enabled', health: a.enabled === false ? 'degraded' : 'healthy', attributes: { combiner: s(a.combiner), conditions: arr(a.conditions).length } }),
  },
  {
    id: 'gcp_log_metrics', domain: 'monitoring', label: 'Log-based Metrics', resourceType: 'log_metric',
    baseUrl: (p) => `${LOGGING}/projects/${encodeURIComponent(p)}/metrics`, listKey: 'metrics',
    map: (m) => ({ nativeId: `projects/metrics/${s(m.name) ?? ''}`, name: s(m.name) ?? 'log-metric', attributes: { description: s(m.description), metricKind: s(pget(m, 'metricDescriptor.metricKind')) } }),
  },
];

const SECRETS: GcpCollectorSpec[] = [
  {
    id: 'gcp_secrets', domain: 'secrets', label: 'Secrets', resourceType: 'secret',
    baseUrl: (p) => `${SECRETMANAGER}/projects/${encodeURIComponent(p)}/secrets`, listKey: 'secrets',
    map: (sec) => ({ nativeId: s(sec.name) ?? '', name: lastSeg(sec.name) ?? 'secret', tags: labelsOf(sec), attributes: { replication: s(pget(sec, 'replication.automatic') !== undefined ? 'automatic' : 'user-managed'), rotationEnabled: pget(sec, 'rotation') != null } }),
  },
];

const CERTIFICATES: GcpCollectorSpec[] = [
  {
    // Certificate Manager rejects the `locations/-` wildcard — enumerate locations then list per-location.
    id: 'gcp_certificates', domain: 'certificates', label: 'Certificate Manager Certificates', resourceType: 'certificate',
    fetchAll: (http, p) => listPerLocation(http, CERTMANAGER, p, 'certificates', 'certificates'),
    map: (c) => ({ nativeId: s(c.name) ?? '', name: lastSeg(c.name) ?? 'certificate', region: locFromName(c.name), tags: labelsOf(c), attributes: { scope: s(c.scope), type: pget(c, 'managed') != null ? 'managed' : 'self-managed', expireTime: s(c.expireTime) } }),
  },
];

const DNS_DOMAIN: GcpCollectorSpec[] = [
  {
    id: 'gcp_dns_zones', domain: 'dns', label: 'Cloud DNS Managed Zones', resourceType: 'managed_zone',
    baseUrl: (p) => `${DNS}/projects/${encodeURIComponent(p)}/managedZones`, listKey: 'managedZones',
    map: (z) => ({ nativeId: `projects/managedZones/${s(z.name) ?? ''}`, name: s(z.dnsName) ?? s(z.name) ?? 'zone', attributes: { dnsName: s(z.dnsName), visibility: s(z.visibility), zoneName: s(z.name) } }),
  },
];

/** Every GCP collector, across the infrastructure domains. */
export const GCP_COLLECTORS: DomainCollector[] = [
  ...IDENTITY,
  ...COMPUTE_DOMAIN,
  ...NETWORKING,
  ...STORAGE_DOMAIN,
  ...DATABASES,
  ...CONTAINERS,
  ...SERVERLESS,
  ...MONITORING_DOMAIN,
  ...SECRETS,
  ...CERTIFICATES,
  ...DNS_DOMAIN,
].map(makeGcpCollector);
