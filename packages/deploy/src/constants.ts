/**
 * Sprint 1 constants. Isolated module (no imports).
 */
export const DEPLOY_VERSION = '0.0.0-preview.1';

/** The one honest answer deployment analytics gives when no real data exists. */
export const NO_DEPLOY_DATA = 'No deployment data available';

/** EPIC 1 — environments (no fake production). */
export const ENVIRONMENTS = ['development', 'qa', 'staging', 'production', 'disaster-recovery'] as const;
export type DeployEnvironment = (typeof ENVIRONMENTS)[number];

/** Deployment status — environments start not-deployed; production is never faked. */
export const DEPLOY_STATUS = ['not-deployed', 'planned', 'deploying', 'deployed', 'failed', 'rolled-back'] as const;
export type DeployStatus = (typeof DEPLOY_STATUS)[number];

/** Asset kinds catalogued by the foundation (all LIVE-VERIFIED real files). */
export const ASSET_KINDS = ['dockerfile', 'compose', 'k8s-manifest', 'helm-chart', 'helm-values', 'helm-template', 'iac-template', 'github-workflow', 'config', 'monitoring', 'secrets-policy', 'storage', 'network', 'documentation'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/** EPIC 5 — cloud/infrastructure providers (represented; never created). */
export const CLOUD_PROVIDERS = ['aws', 'azure', 'gcp', 'digitalocean', 'hetzner', 'vmware', 'on-prem'] as const;
export type CloudProvider = (typeof CLOUD_PROVIDERS)[number];

/** External infrastructure adapters — adapter-verified until configured. */
export const INFRA_ADAPTER_CATALOG: Array<{ system: string; category: string }> = [
  { system: 'AWS', category: 'cloud' },
  { system: 'Azure', category: 'cloud' },
  { system: 'Google Cloud', category: 'cloud' },
  { system: 'DigitalOcean', category: 'cloud' },
  { system: 'Hetzner', category: 'cloud' },
  { system: 'VMware', category: 'virtualization' },
  { system: 'Kubernetes', category: 'orchestrator' },
  { system: 'MinIO', category: 'object-store' },
  { system: 'Vault', category: 'secrets' },
];

/** Capabilities that require real infrastructure — represented via descriptors until it exists. */
export const INFRASTRUCTURE_PENDING_CAPS = ['real-clusters', 'real-cloud-resources', 'real-databases', 'real-monitoring', 'real-dns', 'real-tls', 'real-load-balancers'] as const;
export type InfrastructurePendingCap = (typeof INFRASTRUCTURE_PENDING_CAPS)[number];
