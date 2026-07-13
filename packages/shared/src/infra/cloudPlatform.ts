/**
 * The Cloud Platform abstraction (P6 — Cloud & Infrastructure Control Plane).
 *
 * A Cloud Platform is a NEW first-class abstraction — deliberately DISTINCT from a business-SaaS
 * `Connector`. Where a connector syncs records (messages, tasks, CRM objects) into the Unified Data Model,
 * a Cloud Platform DISCOVERS infrastructure resources (VMs, networks, clusters, IAM roles, databases) into
 * the Resource Graph. Both, however, run on the SAME production runtime — the Cloud Platform reuses the
 * connector runtime's OAuth engine, vault, workers, scheduling, retry, rate-gating, timeline, automation,
 * knowledge graph, diagnostics, memory and search. Nothing here duplicates those systems; this module only
 * declares the platform/domain model, its manifest, and the pure view helpers the Cloud Platform Center reads.
 *
 * Types-only + pure functions, Electron-free, so the main process, renderer, and tests share them.
 */

/** The kind of cloud / infrastructure platform. Open-ended — `custom` covers a bespoke platform. */
export type CloudProviderKind =
  | 'aws'
  | 'azure'
  | 'gcp'
  | 'kubernetes'
  | 'docker'
  | 'vmware'
  | 'cloudflare'
  | 'snowflake'
  | 'databricks'
  | 'oci'
  | 'digitalocean'
  | 'custom';

export const CLOUD_PROVIDER_KINDS: readonly CloudProviderKind[] = [
  'aws', 'azure', 'gcp', 'kubernetes', 'docker', 'vmware', 'cloudflare', 'snowflake', 'databricks', 'oci', 'digitalocean', 'custom',
] as const;

/**
 * An Infrastructure Domain — the functional slice of a platform a discovery collector targets. A platform
 * exposes one or more; capability (which a given account actually has) is discovered at RUNTIME from the
 * per-domain degrade, never hardcoded.
 */
export type InfrastructureDomain =
  | 'identity'
  | 'compute'
  | 'networking'
  | 'storage'
  | 'databases'
  | 'containers'
  | 'serverless'
  | 'messaging'
  | 'monitoring'
  | 'security'
  | 'cost'
  | 'billing'
  | 'certificates'
  | 'dns'
  | 'secrets';

export const INFRASTRUCTURE_DOMAINS: readonly InfrastructureDomain[] = [
  'identity', 'compute', 'networking', 'storage', 'databases', 'containers', 'serverless',
  'messaging', 'monitoring', 'security', 'cost', 'billing', 'certificates', 'dns', 'secrets',
] as const;

/** Presentation metadata for a domain (label + icon + one-line description). */
export interface InfrastructureDomainDef {
  id: InfrastructureDomain;
  label: string;
  description: string;
  /** An `IconName` from the renderer design system (kept as a plain string here to stay framework-free). */
  icon: string;
}

/** The canonical domain catalog — the Cloud Platform Center renders from this, no hardcoded strings in the UI. */
export const INFRASTRUCTURE_DOMAIN_CATALOG: Record<InfrastructureDomain, InfrastructureDomainDef> = {
  identity: { id: 'identity', label: 'Identity', description: 'IAM users, roles, groups, service principals, and policies.', icon: 'shield' },
  compute: { id: 'compute', label: 'Compute', description: 'Virtual machines, instances, nodes, and hosts.', icon: 'server' },
  networking: { id: 'networking', label: 'Networking', description: 'VPCs, subnets, load balancers, gateways, and peering.', icon: 'globe' },
  storage: { id: 'storage', label: 'Storage', description: 'Object stores, buckets, volumes, and file shares.', icon: 'database' },
  databases: { id: 'databases', label: 'Databases', description: 'Managed relational, NoSQL, cache, and warehouse databases.', icon: 'database' },
  containers: { id: 'containers', label: 'Containers', description: 'Clusters, nodes, pods, deployments, and services.', icon: 'layers' },
  serverless: { id: 'serverless', label: 'Serverless', description: 'Functions, workflows, and event-driven compute.', icon: 'cpu' },
  messaging: { id: 'messaging', label: 'Messaging', description: 'Queues, topics, streams, and event buses.', icon: 'activity' },
  monitoring: { id: 'monitoring', label: 'Monitoring', description: 'Metrics, logs, alarms, dashboards, and traces.', icon: 'gauge' },
  security: { id: 'security', label: 'Security', description: 'Security findings, posture, firewalls, and guard rails.', icon: 'shield' },
  cost: { id: 'cost', label: 'Cost', description: 'Cost allocation, budgets, and spend by resource.', icon: 'gauge' },
  billing: { id: 'billing', label: 'Billing', description: 'Accounts, invoices, and commitments.', icon: 'gauge' },
  certificates: { id: 'certificates', label: 'Certificates', description: 'TLS certificates and certificate authorities.', icon: 'shield' },
  dns: { id: 'dns', label: 'DNS', description: 'Hosted zones and DNS records.', icon: 'globe' },
  secrets: { id: 'secrets', label: 'Secrets', description: 'Secret stores, keys, and key vaults.', icon: 'shield' },
};

/**
 * How a platform authenticates. This is a REFERENCE to an existing auth mechanism — a Cloud Platform NEVER
 * introduces a new OAuth/credential system; `oauth2` reuses the connector OAuth engine + vault, `api_key` /
 * `service_account` / `kubeconfig` / `iam_role` reuse the same encrypted vault store.
 */
export type CloudPlatformAuthKind = 'oauth2' | 'api_key' | 'service_account' | 'kubeconfig' | 'iam_role' | 'none';

/**
 * A Cloud Platform manifest — the infrastructure analog of `ConnectorManifest`. It declares a discoverable
 * platform WITHOUT being a connector (it is registered in the platform registry, not the adapter registry).
 */
export interface CloudPlatformManifest {
  /** Stable platform id, e.g. `aws`, `azure`, `kubernetes`. */
  id: string;
  name: string;
  provider: CloudProviderKind;
  description: string;
  website: string;
  docsUrl: string;
  brandColor: string;
  version: string;
  /** Which existing auth mechanism this platform reuses (never a new one). */
  authKind: CloudPlatformAuthKind;
  /** The infrastructure domains this platform can discover. */
  domains: InfrastructureDomain[];
  /** Whether many accounts / subscriptions / projects / clusters can connect under one platform. */
  multiAccount: boolean;
  /** The account-scope noun shown in the UI (Account / Subscription / Project / Cluster / Tenant). */
  accountNoun: string;
}

/** Lifecycle status of a connected platform account (mirrors the connector status vocabulary). */
export type CloudPlatformStatus =
  | 'unconfigured'
  | 'connected'
  | 'discovering'
  | 'degraded'
  | 'error'
  | 'disconnected';

/** Rolled-up health of a platform account (mirrors ConnectorHealth). */
export type CloudPlatformHealth = 'healthy' | 'degraded' | 'down' | 'unknown';

/* ── DTOs the Cloud Platform Center reads (shaped for the renderer, no live objects) ─────────────── */

/** A connected account / subscription / project under a platform. */
export interface CloudPlatformAccountDto {
  accountId: string;
  label: string;
  status: CloudPlatformStatus;
  health: CloudPlatformHealth;
  region: string | null;
  /** Last successful discovery (ISO) or null. */
  lastDiscoveryAt: string | null;
  /** Next scheduled discovery (ISO) or null. */
  nextDiscoveryAt: string | null;
  resourceCount: number;
  consecutiveFailures: number;
}

/** Per-domain discovery status for one account (the module-stat analog). */
export interface CloudDomainStat {
  domain: InfrastructureDomain;
  label: string;
  status: 'active' | 'unauthorized' | 'unprovisioned' | 'idle';
  resourceCount: number;
  reason: string | null;
  lastDiscoveryAt: string | null;
}

/** A platform card in the Cloud Platform Center. */
export interface CloudPlatformDto {
  id: string;
  name: string;
  provider: CloudProviderKind;
  description: string;
  brandColor: string;
  authKind: CloudPlatformAuthKind;
  configured: boolean;
  status: CloudPlatformStatus;
  health: CloudPlatformHealth;
  multiAccount: boolean;
  accountNoun: string;
  domains: InfrastructureDomain[];
  accounts: CloudPlatformAccountDto[];
  resourceCount: number;
}

/** The Cloud Platform Center rollup. */
export interface CloudPlatformStats {
  platforms: number;
  configured: number;
  connected: number;
  discovering: number;
  degraded: number;
  down: number;
  accounts: number;
  resources: number;
  domains: number;
}

/* ── Pure helpers ────────────────────────────────────────────────────────────── */

/** The presentation def for a domain (falls back to a titleized id for an unknown domain). */
export function domainDef(domain: InfrastructureDomain): InfrastructureDomainDef {
  return INFRASTRUCTURE_DOMAIN_CATALOG[domain] ?? { id: domain, label: titleize(domain), description: '', icon: 'server' };
}

/** Resolve a set of domains to their presentation defs, in catalog order. */
export function describeDomains(domains: InfrastructureDomain[]): InfrastructureDomainDef[] {
  const set = new Set(domains);
  return INFRASTRUCTURE_DOMAINS.filter((d) => set.has(d)).map(domainDef);
}

/** Project a manifest into a platform DTO shell (status/accounts/resources are overlaid by the runtime). */
export function manifestToPlatformDto(m: CloudPlatformManifest): CloudPlatformDto {
  return {
    id: m.id,
    name: m.name,
    provider: m.provider,
    description: m.description,
    brandColor: m.brandColor,
    authKind: m.authKind,
    configured: false,
    status: 'unconfigured',
    health: 'unknown',
    multiAccount: m.multiAccount,
    accountNoun: m.accountNoun,
    domains: m.domains,
    accounts: [],
    resourceCount: 0,
  };
}

/** Title-case a snake/kebab id for a fallback label. */
function titleize(id: string): string {
  return id
    .split(/[_-]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
