/**
 * Sprint 2 constants. Isolated module (no imports).
 */
export const INFRA_VERSION = '0.0.0-preview.1';

/** The one honest answer telemetry/analytics gives when no real data exists. */
export const NO_INFRA_DATA = 'No infrastructure data available';

/** EPIC 1 — activation lifecycle. Starts 'pending'; 'active' requires a real signal, never fabricated. */
export const ACTIVATION_STATUS = ['pending', 'provisioning', 'active', 'failed', 'decommissioned'] as const;
export type ActivationStatus = (typeof ACTIVATION_STATUS)[number];

/** EPIC 2 — cluster environments. */
export const CLUSTER_ENVS = ['development', 'qa', 'staging', 'production', 'disaster-recovery'] as const;
export type ClusterEnv = (typeof CLUSTER_ENVS)[number];

/** EPIC 3 — cloud providers. */
export const CLOUD_PROVIDERS = ['aws', 'azure', 'gcp', 'digitalocean', 'hetzner', 'vmware', 'on-prem', 'hybrid'] as const;
export type CloudProvider = (typeof CLOUD_PROVIDERS)[number];

/** EPIC 4 — database / storage engines. */
export const DB_ENGINES = ['postgresql', 'redis', 'qdrant', 'object-storage', 'file-storage', 'cache-storage', 'blob-storage'] as const;
export type DbEngine = (typeof DB_ENGINES)[number];

/** EPIC 6 — enterprise identity protocols. */
export const IDENTITY_PROTOCOLS = ['oidc', 'oauth2.1', 'saml2.0', 'ldap', 'active-directory', 'entra-id', 'google-workspace', 'okta', 'scim'] as const;
export type IdentityProtocol = (typeof IDENTITY_PROTOCOLS)[number];

/** EPIC 10 — external secret backends. */
export const SECRET_BACKENDS = ['hashicorp-vault', 'azure-key-vault', 'aws-secrets-manager', 'google-secret-manager'] as const;
export type SecretBackend = (typeof SECRET_BACKENDS)[number];

/** EPIC 13 — telemetry metric kinds (collected only when live). */
export const METRIC_KINDS = ['deployment', 'infrastructure', 'container', 'api', 'database', 'memory', 'cpu', 'latency', 'availability', 'throughput', 'error-rate', 'storage', 'worker', 'ai-runtime', 'workspace', 'business'] as const;
export type MetricKind = (typeof METRIC_KINDS)[number];

/** EPIC 14 — alert severities. */
export const ALERT_SEVERITIES = ['critical', 'warning', 'health', 'info'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

/** EPIC 15 — log streams. */
export const LOG_STREAMS = ['centralized', 'audit', 'security', 'application', 'infrastructure', 'container', 'api', 'identity'] as const;
export type LogStream = (typeof LOG_STREAMS)[number];

/** EPIC 21 — external providers (clouds + Vault + identity providers), adapter-verified. */
export const PROVIDER_ADAPTER_CATALOG: Array<{ system: string; category: string }> = [
  { system: 'AWS', category: 'cloud' },
  { system: 'Azure', category: 'cloud' },
  { system: 'Google Cloud', category: 'cloud' },
  { system: 'DigitalOcean', category: 'cloud' },
  { system: 'Hetzner', category: 'cloud' },
  { system: 'VMware', category: 'virtualization' },
  { system: 'Vault', category: 'secrets' },
  { system: 'Entra ID', category: 'identity' },
  { system: 'Google Workspace', category: 'identity' },
  { system: 'Okta', category: 'identity' },
];

/** Capabilities that require real, provisioned infrastructure — represented until it exists. */
export const INFRASTRUCTURE_PENDING_CAPS = ['cloud-resources', 'clusters', 'dns', 'certificates', 'databases', 'load-balancers'] as const;
export type InfrastructurePendingCap = (typeof INFRASTRUCTURE_PENDING_CAPS)[number];
