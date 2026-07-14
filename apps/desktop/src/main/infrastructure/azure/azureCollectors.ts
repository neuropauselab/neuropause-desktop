/**
 * Azure DomainCollectors (P6.2). Each collector discovers ONE Azure resource type via the P6.0 `DomainCollector`
 * contract — it fetches one page of an Azure list API (ARM `management.azure.com` or Microsoft Graph) through
 * the bearer transport, maps each item into a `CloudResource` with its typed relationships, and returns a
 * `DiscoveryPage` carrying the Azure `nextLink` as the incremental cursor. The Discovery Engine drives paging,
 * persists the cursor, degrades a domain on 401/403/404, and sinks resources into the Resource Store + Graph.
 *
 * Azure vs AWS: discovery is SUBSCRIPTION-wide (not region-scoped) — an ARM list returns resources across all
 * regions, so each resource's own `location` becomes its region and there is no per-region fan-out. Sub-resources
 * that ARM only exposes per-parent (subnets, blob containers, file shares, SQL databases) are enumerated from
 * their parent list; subnets come inline in the VNet response (via `expand`), the rest iterate parents. The
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
import { azureListAll, azurePage } from './azureClient';
import type { DiscoveryHttp } from '@neuropause/shared';

const ARM = 'https://management.azure.com';
const GRAPH = 'https://graph.microsoft.com/v1.0';

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

interface AzureCollectorSpec {
  id: string;
  domain: InfrastructureDomain;
  label: string;
  resourceType: string;
  /** For a collector that emits more than one resource type (e.g. Web sites → function_app | app_service). */
  resourceTypes?: string[];
  resourceTypeOf?: (item: Rec) => string;
  fetchPage: (http: DiscoveryHttp, accountId: string, nextLink: string | null) => Promise<{ items: Rec[]; nextLink: string | null }>;
  /** Turn each raw list item into 0..N sub-items before mapping (e.g. a VNet → its inline subnets). */
  expand?: (item: Rec) => Rec[];
  map: (item: Rec) => MappedResource;
}

/** Build a `DomainCollector` from a spec — cursor handling, expansion, mapping, and `makeResource` are uniform. */
function makeAzureCollector(spec: AzureCollectorSpec): DomainCollector {
  return {
    id: spec.id,
    domain: spec.domain,
    label: spec.label,
    resourceTypes: spec.resourceTypes ?? [spec.resourceType],
    collect: async (ctx) => {
      const c = parseDiscoveryCursor(ctx.cursor);
      // Run-scoped nextLink: a fresh run restarts the snapshot (an Azure list is current-state).
      const nextLink = c && c.runAt === ctx.now ? (c.token ?? null) : null;
      const page = await spec.fetchPage(ctx.http, ctx.accountId, nextLink);
      const expanded = spec.expand ? page.items.flatMap((it) => spec.expand!(it)) : page.items;
      const resources = expanded.map((raw) => {
        const m = spec.map(raw);
        return makeResource({
          platformId: ctx.platformId,
          provider: 'azure',
          accountId: ctx.accountId,
          domain: spec.domain,
          resourceType: spec.resourceTypeOf ? spec.resourceTypeOf(raw) : spec.resourceType,
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
      });
      return { resources, cursor: page.nextLink ? toDiscoveryCursor({ token: page.nextLink, runAt: ctx.now }) : null, hasMore: !!page.nextLink };
    },
  };
}

/* ── shared helpers ──────────────────────────────────────────────────────────── */

const s = (v: unknown): string | null => (v == null ? null : String(v).trim() || null);
const rel = (type: ResourceRelationship['type'], targetId: string | null | undefined): ResourceRelationship[] =>
  targetId ? [{ type, targetId: String(targetId) }] : [];
const arr = <T = Rec>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : v == null ? [] : [v as T]);

/** The `.properties` bag of an ARM resource. */
const props = (item: Rec): Rec => (item.properties && typeof item.properties === 'object' ? (item.properties as Rec) : {});
/** ARM resource tags → a flat string map. */
function tagsOf(item: Rec): Record<string, string> {
  const out: Record<string, string> = {};
  const t = item.tags;
  if (t && typeof t === 'object') for (const [k, v] of Object.entries(t as Rec)) out[k] = v == null ? '' : String(v);
  return out;
}
/** Deep-get a dotted path in a nested JSON object (object keys only — no array indices). */
function pget(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const k of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Rec)[k];
  }
  return cur;
}
/** The parent resource id of an Azure sub-resource id (everything before `marker`). */
const parentOf = (id: string | null, marker: string): string | null => (id && id.includes(marker) ? id.split(marker)[0] : null);
/** ARM provisioning state → health. */
const armHealth = (state: string | null): ResourceHealth =>
  state === 'Succeeded' ? 'healthy' : state === 'Failed' ? 'critical' : state === 'Canceled' ? 'degraded' : 'unknown';

/* ── page fetchers ───────────────────────────────────────────────────────────── */

/** A subscription-wide ARM provider list: `/subscriptions/{sub}/providers/{path}?api-version=…`. */
const armList = (sub: string, path: string, apiVersion: string): string =>
  `${ARM}/subscriptions/${encodeURIComponent(sub)}/providers/${path}?api-version=${apiVersion}`;
/** Simple single-list ARM fetcher (follows nextLink for pagination). */
const simpleArm = (path: string, apiVersion: string) =>
  (http: DiscoveryHttp, accountId: string, nextLink: string | null) => azurePage(http, nextLink ?? armList(accountId, path, apiVersion));
/** Simple single-list Microsoft Graph fetcher (follows @odata.nextLink). */
const simpleGraph = (path: string) =>
  (http: DiscoveryHttp, _accountId: string, nextLink: string | null) => azurePage(http, nextLink ?? `${GRAPH}/${path}`);

/** A sub-resource fetcher: enumerate parents (subscription-wide) then each parent's children (one-shot per run,
 *  tagging each child with `__parent` = the parent id for the `hosted_by` relationship). */
function childrenOf(parentPath: string, parentApiVersion: string, childPath: string, childApiVersion: string) {
  return async (http: DiscoveryHttp, accountId: string): Promise<{ items: Rec[]; nextLink: string | null }> => {
    const parents = await azureListAll(http, armList(accountId, parentPath, parentApiVersion));
    const items: Rec[] = [];
    for (const p of parents) {
      const pid = s(p.id);
      if (!pid) continue;
      const children = await azureListAll(http, `${ARM}${pid}/${childPath}?api-version=${childApiVersion}`);
      for (const c of children) items.push({ ...c, __parent: pid });
    }
    return { items, nextLink: null };
  };
}

/* ── the collectors ──────────────────────────────────────────────────────────── */

const IDENTITY: AzureCollectorSpec[] = [
  {
    id: 'azure_entra_users', domain: 'identity', label: 'Entra Users', resourceType: 'entra_user',
    fetchPage: simpleGraph('users?$select=id,displayName,userPrincipalName,accountEnabled&$top=100'),
    map: (u) => ({ nativeId: s(u.id) ?? '', name: s(u.displayName) ?? s(u.userPrincipalName) ?? 'user', status: u.accountEnabled === false ? 'disabled' : 'enabled', health: u.accountEnabled === false ? 'degraded' : 'healthy', attributes: { upn: s(u.userPrincipalName) } }),
  },
  {
    id: 'azure_entra_groups', domain: 'identity', label: 'Entra Groups', resourceType: 'entra_group',
    fetchPage: simpleGraph('groups?$select=id,displayName,description,securityEnabled&$top=100'),
    map: (g) => ({ nativeId: s(g.id) ?? '', name: s(g.displayName) ?? 'group', attributes: { securityEnabled: g.securityEnabled === true, description: s(g.description) } }),
  },
  {
    id: 'azure_service_principals', domain: 'identity', label: 'Service Principals', resourceType: 'service_principal',
    fetchPage: simpleGraph('servicePrincipals?$select=id,appId,displayName,servicePrincipalType,accountEnabled&$top=100'),
    map: (sp) => ({ nativeId: s(sp.id) ?? s(sp.appId) ?? '', name: s(sp.displayName) ?? 'service principal', status: sp.accountEnabled === false ? 'disabled' : 'enabled', attributes: { appId: s(sp.appId), type: s(sp.servicePrincipalType) } }),
  },
];

const COMPUTE: AzureCollectorSpec[] = [
  {
    id: 'azure_virtual_machines', domain: 'compute', label: 'Virtual Machines', resourceType: 'virtual_machine',
    fetchPage: simpleArm('Microsoft.Compute/virtualMachines', '2023-07-01'),
    map: (vm) => {
      const p = props(vm);
      const state = s(p.provisioningState);
      return {
        nativeId: s(vm.id) ?? '', name: s(vm.name) ?? 'vm', region: s(vm.location), status: state, health: armHealth(state), tags: tagsOf(vm),
        attributes: { vmSize: s(pget(p, 'hardwareProfile.vmSize')), osType: s(pget(p, 'storageProfile.osDisk.osType')) },
        relationships: arr(pget(p, 'networkProfile.networkInterfaces')).flatMap((nic) => rel('connected_to', s((nic as Rec).id))),
      };
    },
  },
  {
    id: 'azure_vm_scale_sets', domain: 'compute', label: 'VM Scale Sets', resourceType: 'vm_scale_set',
    fetchPage: simpleArm('Microsoft.Compute/virtualMachineScaleSets', '2023-07-01'),
    map: (ss) => ({ nativeId: s(ss.id) ?? '', name: s(ss.name) ?? 'vmss', region: s(ss.location), status: s(props(ss).provisioningState), health: armHealth(s(props(ss).provisioningState)), tags: tagsOf(ss), attributes: { sku: s(pget(ss, 'sku.name')), capacity: Number(s(pget(ss, 'sku.capacity')) ?? 0) } }),
  },
];

const NETWORKING: AzureCollectorSpec[] = [
  {
    id: 'azure_virtual_networks', domain: 'networking', label: 'Virtual Networks', resourceType: 'virtual_network',
    fetchPage: simpleArm('Microsoft.Network/virtualNetworks', '2023-05-01'),
    map: (v) => ({ nativeId: s(v.id) ?? '', name: s(v.name) ?? 'vnet', region: s(v.location), status: s(props(v).provisioningState), health: armHealth(s(props(v).provisioningState)), tags: tagsOf(v), attributes: { addressSpace: arr<string>(pget(props(v), 'addressSpace.addressPrefixes')).join(',') } }),
  },
  {
    id: 'azure_subnets', domain: 'networking', label: 'Subnets', resourceType: 'subnet',
    fetchPage: simpleArm('Microsoft.Network/virtualNetworks', '2023-05-01'),
    expand: (vnet) => arr(pget(props(vnet), 'subnets')),
    map: (sn) => {
      const p = props(sn);
      const id = s(sn.id);
      return {
        nativeId: id ?? '', name: s(sn.name) ?? 'subnet', region: null, status: s(p.provisioningState), health: armHealth(s(p.provisioningState)),
        attributes: { addressPrefix: s(p.addressPrefix) },
        relationships: [
          ...rel('member_of', parentOf(id, '/subnets/')),
          ...rel('protected_by', s(pget(p, 'networkSecurityGroup.id'))),
          ...rel('uses', s(pget(p, 'routeTable.id'))),
        ],
      };
    },
  },
  {
    id: 'azure_network_security_groups', domain: 'networking', label: 'Network Security Groups', resourceType: 'network_security_group',
    fetchPage: simpleArm('Microsoft.Network/networkSecurityGroups', '2023-05-01'),
    map: (g) => ({ nativeId: s(g.id) ?? '', name: s(g.name) ?? 'nsg', region: s(g.location), status: s(props(g).provisioningState), health: armHealth(s(props(g).provisioningState)), tags: tagsOf(g), attributes: { rules: arr(pget(props(g), 'securityRules')).length } }),
  },
  {
    id: 'azure_route_tables', domain: 'networking', label: 'Route Tables', resourceType: 'route_table',
    fetchPage: simpleArm('Microsoft.Network/routeTables', '2023-05-01'),
    map: (t) => ({ nativeId: s(t.id) ?? '', name: s(t.name) ?? 'route-table', region: s(t.location), status: s(props(t).provisioningState), health: armHealth(s(props(t).provisioningState)), tags: tagsOf(t), attributes: { routes: arr(pget(props(t), 'routes')).length } }),
  },
  {
    id: 'azure_application_gateways', domain: 'networking', label: 'Application Gateways', resourceType: 'application_gateway',
    fetchPage: simpleArm('Microsoft.Network/applicationGateways', '2023-05-01'),
    map: (g) => ({
      nativeId: s(g.id) ?? '', name: s(g.name) ?? 'appgw', region: s(g.location), status: s(props(g).provisioningState), health: armHealth(s(props(g).provisioningState)), tags: tagsOf(g),
      attributes: { sku: s(pget(g, 'properties.sku.name')), tier: s(pget(g, 'properties.sku.tier')) },
      relationships: arr(pget(props(g), 'gatewayIPConfigurations')).flatMap((c) => rel('member_of', s(pget(c as Rec, 'properties.subnet.id')))),
    }),
  },
  {
    id: 'azure_load_balancers', domain: 'networking', label: 'Load Balancers', resourceType: 'load_balancer',
    fetchPage: simpleArm('Microsoft.Network/loadBalancers', '2023-05-01'),
    map: (lb) => ({ nativeId: s(lb.id) ?? '', name: s(lb.name) ?? 'lb', region: s(lb.location), status: s(props(lb).provisioningState), health: armHealth(s(props(lb).provisioningState)), tags: tagsOf(lb), attributes: { sku: s(pget(lb, 'sku.name')) } }),
  },
  {
    id: 'azure_network_interfaces', domain: 'networking', label: 'Network Interfaces', resourceType: 'network_interface',
    fetchPage: simpleArm('Microsoft.Network/networkInterfaces', '2023-05-01'),
    map: (nic) => ({
      nativeId: s(nic.id) ?? '', name: s(nic.name) ?? 'nic', region: s(nic.location), status: s(props(nic).provisioningState), health: armHealth(s(props(nic).provisioningState)), tags: tagsOf(nic),
      attributes: { privateIp: s(pget(arr(pget(props(nic), 'ipConfigurations'))[0], 'properties.privateIPAddress')) },
      relationships: [
        ...arr(pget(props(nic), 'ipConfigurations')).flatMap((c) => rel('member_of', s(pget(c as Rec, 'properties.subnet.id')))),
        ...rel('protected_by', s(pget(props(nic), 'networkSecurityGroup.id'))),
      ],
    }),
  },
];

const STORAGE: AzureCollectorSpec[] = [
  {
    id: 'azure_storage_accounts', domain: 'storage', label: 'Storage Accounts', resourceType: 'storage_account',
    fetchPage: simpleArm('Microsoft.Storage/storageAccounts', '2023-01-01'),
    map: (a) => ({ nativeId: s(a.id) ?? '', name: s(a.name) ?? 'storage', region: s(a.location), status: s(props(a).provisioningState), health: s(props(a).provisioningState) === 'Succeeded' ? 'healthy' : 'unknown', tags: tagsOf(a), attributes: { kind: s(a.kind), sku: s(pget(a, 'sku.name')), accessTier: s(pget(a, 'properties.accessTier')) } }),
  },
  {
    id: 'azure_blob_containers', domain: 'storage', label: 'Blob Containers', resourceType: 'blob_container',
    fetchPage: childrenOf('Microsoft.Storage/storageAccounts', '2023-01-01', 'blobServices/default/containers', '2023-01-01'),
    map: (c) => ({ nativeId: s(c.id) ?? '', name: s(c.name) ?? 'container', attributes: { publicAccess: s(pget(props(c), 'publicAccess')) }, relationships: rel('hosted_by', s((c as Rec).__parent)) }),
  },
  {
    id: 'azure_file_shares', domain: 'storage', label: 'File Shares', resourceType: 'file_share',
    fetchPage: childrenOf('Microsoft.Storage/storageAccounts', '2023-01-01', 'fileServices/default/shares', '2023-01-01'),
    map: (f) => ({ nativeId: s(f.id) ?? '', name: s(f.name) ?? 'share', attributes: { quotaGiB: Number(s(pget(props(f), 'shareQuota')) ?? 0) }, relationships: rel('hosted_by', s((f as Rec).__parent)) }),
  },
];

const DATABASES: AzureCollectorSpec[] = [
  {
    id: 'azure_sql_servers', domain: 'databases', label: 'SQL Servers', resourceType: 'sql_server',
    fetchPage: simpleArm('Microsoft.Sql/servers', '2021-11-01'),
    map: (srv) => ({ nativeId: s(srv.id) ?? '', name: s(srv.name) ?? 'sql-server', region: s(srv.location), status: s(props(srv).state), health: s(props(srv).state) === 'Ready' ? 'healthy' : 'unknown', tags: tagsOf(srv), attributes: { fqdn: s(pget(props(srv), 'fullyQualifiedDomainName')), version: s(pget(props(srv), 'version')) } }),
  },
  {
    id: 'azure_sql_databases', domain: 'databases', label: 'SQL Databases', resourceType: 'sql_database',
    fetchPage: childrenOf('Microsoft.Sql/servers', '2021-11-01', 'databases', '2021-11-01'),
    map: (db) => {
      const state = s(pget(props(db), 'status'));
      return { nativeId: s(db.id) ?? '', name: s(db.name) ?? 'database', region: s(db.location), status: state, health: state === 'Online' ? 'healthy' : state === 'Paused' ? 'degraded' : 'unknown', tags: tagsOf(db), attributes: { sku: s(pget(db, 'sku.name')), tier: s(pget(db, 'sku.tier')) }, relationships: rel('hosted_by', s((db as Rec).__parent)) };
    },
  },
  {
    id: 'azure_cosmos_accounts', domain: 'databases', label: 'Cosmos DB Accounts', resourceType: 'cosmos_account',
    fetchPage: simpleArm('Microsoft.DocumentDB/databaseAccounts', '2023-04-15'),
    map: (a) => ({ nativeId: s(a.id) ?? '', name: s(a.name) ?? 'cosmos', region: s(a.location), status: s(props(a).provisioningState), health: armHealth(s(props(a).provisioningState)), tags: tagsOf(a), attributes: { kind: s(a.kind), consistency: s(pget(props(a), 'consistencyPolicy.defaultConsistencyLevel')) } }),
  },
];

const CONTAINERS: AzureCollectorSpec[] = [
  {
    id: 'azure_aks_clusters', domain: 'containers', label: 'AKS Clusters', resourceType: 'aks_cluster',
    fetchPage: simpleArm('Microsoft.ContainerService/managedClusters', '2023-09-01'),
    map: (c) => {
      const pools = arr(pget(props(c), 'agentPoolProfiles'));
      const subnet = pools.length ? s(pget(pools[0], 'vnetSubnetID')) : null;
      return { nativeId: s(c.id) ?? '', name: s(c.name) ?? 'aks', region: s(c.location), status: s(props(c).provisioningState), health: armHealth(s(props(c).provisioningState)), tags: tagsOf(c), attributes: { kubernetesVersion: s(pget(props(c), 'kubernetesVersion')), nodeResourceGroup: s(pget(props(c), 'nodeResourceGroup')) }, relationships: rel('uses', subnet) };
    },
  },
  {
    id: 'azure_container_apps', domain: 'containers', label: 'Container Apps', resourceType: 'container_app',
    fetchPage: simpleArm('Microsoft.App/containerApps', '2023-05-01'),
    map: (c) => ({ nativeId: s(c.id) ?? '', name: s(c.name) ?? 'container-app', region: s(c.location), status: s(props(c).provisioningState), health: armHealth(s(props(c).provisioningState)), tags: tagsOf(c), attributes: { fqdn: s(pget(props(c), 'configuration.ingress.fqdn')) } }),
  },
];

const SERVERLESS: AzureCollectorSpec[] = [
  {
    id: 'azure_web_sites', domain: 'serverless', label: 'Functions & App Service', resourceType: 'function_app',
    resourceTypes: ['function_app', 'app_service'],
    resourceTypeOf: (site) => (String(site.kind ?? '').includes('functionapp') ? 'function_app' : 'app_service'),
    fetchPage: simpleArm('Microsoft.Web/sites', '2022-09-01'),
    map: (site) => ({ nativeId: s(site.id) ?? '', name: s(site.name) ?? 'site', region: s(site.location), status: s(props(site).state), health: s(props(site).state) === 'Running' ? 'healthy' : s(props(site).state) === 'Stopped' ? 'degraded' : 'unknown', tags: tagsOf(site), attributes: { kind: s(site.kind), defaultHostName: s(pget(props(site), 'defaultHostName')) } }),
  },
];

const MONITORING: AzureCollectorSpec[] = [
  {
    id: 'azure_metric_alerts', domain: 'monitoring', label: 'Metric Alerts', resourceType: 'metric_alert',
    fetchPage: simpleArm('Microsoft.Insights/metricAlerts', '2018-03-01'),
    map: (a) => ({ nativeId: s(a.id) ?? '', name: s(a.name) ?? 'metric-alert', region: s(a.location), status: props(a).enabled === false ? 'disabled' : 'enabled', health: props(a).enabled === false ? 'degraded' : 'healthy', tags: tagsOf(a), attributes: { severity: Number(s(pget(props(a), 'severity')) ?? 0) } }),
  },
  {
    id: 'azure_activity_log_alerts', domain: 'monitoring', label: 'Activity Log Alerts', resourceType: 'activity_log_alert',
    fetchPage: simpleArm('Microsoft.Insights/activityLogAlerts', '2020-10-01'),
    map: (a) => ({ nativeId: s(a.id) ?? '', name: s(a.name) ?? 'activity-alert', region: s(a.location) ?? 'global', status: props(a).enabled === false ? 'disabled' : 'enabled', health: props(a).enabled === false ? 'degraded' : 'healthy', tags: tagsOf(a) }),
  },
];

const SECRETS: AzureCollectorSpec[] = [
  {
    id: 'azure_key_vaults', domain: 'secrets', label: 'Key Vaults', resourceType: 'key_vault',
    fetchPage: simpleArm('Microsoft.KeyVault/vaults', '2023-02-01'),
    map: (v) => ({ nativeId: s(v.id) ?? '', name: s(v.name) ?? 'vault', region: s(v.location), status: s(props(v).provisioningState), health: armHealth(s(props(v).provisioningState)), tags: tagsOf(v), attributes: { sku: s(pget(props(v), 'sku.name')), vaultUri: s(pget(props(v), 'vaultUri')), rbacAuthorization: pget(props(v), 'enableRbacAuthorization') === true } }),
  },
];

const CERTIFICATES: AzureCollectorSpec[] = [
  {
    id: 'azure_app_service_certificates', domain: 'certificates', label: 'App Service Certificates', resourceType: 'app_service_certificate',
    fetchPage: simpleArm('Microsoft.Web/certificates', '2022-09-01'),
    map: (c) => ({ nativeId: s(c.id) ?? '', name: s(c.name) ?? 'certificate', region: s(c.location), tags: tagsOf(c), attributes: { thumbprint: s(pget(props(c), 'thumbprint')), expiration: s(pget(props(c), 'expirationDate')), issuer: s(pget(props(c), 'issuer')) } }),
  },
];

const DNS: AzureCollectorSpec[] = [
  {
    id: 'azure_dns_zones', domain: 'dns', label: 'DNS Zones', resourceType: 'dns_zone',
    fetchPage: simpleArm('Microsoft.Network/dnsZones', '2018-05-01'),
    map: (z) => ({ nativeId: s(z.id) ?? '', name: s(z.name) ?? 'zone', region: s(z.location) ?? 'global', tags: tagsOf(z), attributes: { recordSets: Number(s(pget(props(z), 'numberOfRecordSets')) ?? 0), zoneType: s(pget(props(z), 'zoneType')) } }),
  },
];

/** Every Azure collector, across the infrastructure domains. */
export const AZURE_COLLECTORS: DomainCollector[] = [
  ...IDENTITY,
  ...COMPUTE,
  ...NETWORKING,
  ...STORAGE,
  ...DATABASES,
  ...CONTAINERS,
  ...SERVERLESS,
  ...MONITORING,
  ...SECRETS,
  ...CERTIFICATES,
  ...DNS,
].map(makeAzureCollector);
