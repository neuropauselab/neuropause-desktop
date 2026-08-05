/**
 * Launch Workstream 1 constants. Isolated module (no imports). Enumerates the cloud providers, cluster
 * environments, Kubernetes resource kinds, database engines, API services/protocols, network
 * components, identity methods, AI providers, storage kinds, pipelines, monitoring stack, deployment
 * strategies, and validation areas — plus the catalog of EXTERNAL providers that stay adapter-verified
 * until configured, and the real infrastructure that stays infrastructure-pending until provisioned.
 *
 * HONESTY: this package is the operational CONTROL PLANE (software). It NEVER claims that the target
 * domain is live, that a cluster is running, that a database is provisioned, or that a certificate is
 * issued — those are infrastructure-pending until a real, verified provisioning occurs.
 */
export const PLATFORM_OPS_VERSION = '1.0.0-rc.1';

/** The intended public domain. REPRESENTED as a target — it is NOT live until real infrastructure serves it. */
export const TARGET_DOMAIN = 'app.neuropause033.com';

/** The one honest answer platform-ops analytics gives when no real infrastructure/data exists. */
export const NO_INFRA_DATA = 'No infrastructure data available';

/** EPIC 1 — supported cloud providers. Represented until real credentials + a real account are configured. */
export const CLOUD_PROVIDERS = ['aws', 'azure', 'gcp', 'self-hosted-kubernetes'] as const;
export type CloudProvider = (typeof CLOUD_PROVIDERS)[number];

/** EPIC 1 — environment tiers. */
export const ENVIRONMENT_TIERS = ['development', 'staging', 'production', 'disaster-recovery'] as const;
export type EnvironmentTier = (typeof ENVIRONMENT_TIERS)[number];

/** EPIC 1 — environment/cluster lifecycle. 'active' requires a real cluster reporting — never assumed. */
export const ENV_STATUS = ['declared', 'provisioning', 'active', 'degraded', 'decommissioned'] as const;
export type EnvStatus = (typeof ENV_STATUS)[number];

/** EPIC 2 — the Kubernetes resource kinds represented as descriptors. */
export const K8S_RESOURCE_KINDS = [
  'namespace',
  'deployment',
  'service',
  'ingress',
  'statefulset',
  'persistent-volume',
  'network-policy',
  'pod-security',
  'resource-quota',
  'horizontal-pod-autoscaler',
  'pod-disruption-budget',
] as const;
export type K8sResourceKind = (typeof K8S_RESOURCE_KINDS)[number];

/** EPIC 3 — production database engines. */
export const DB_ENGINES = ['postgresql', 'redis', 'qdrant'] as const;
export type DbEngine = (typeof DB_ENGINES)[number];

/** EPIC 4 — API services. */
export const API_SERVICES = ['api-gateway', 'authentication', 'ai-runtime', 'integration', 'commercial', 'operations', 'admin'] as const;
export type ApiService = (typeof API_SERVICES)[number];

/** EPIC 4 — API protocols. */
export const API_PROTOCOLS = ['rest', 'graphql', 'websocket'] as const;
export type ApiProtocol = (typeof API_PROTOCOLS)[number];

/** EPIC 5 — production networking components. */
export const NETWORK_COMPONENTS = ['dns', 'tls', 'https', 'reverse-proxy', 'cdn', 'load-balancer', 'waf', 'rate-limiter'] as const;
export type NetworkComponent = (typeof NETWORK_COMPONENTS)[number];

/** EPIC 6 — identity activation methods. */
export const IDENTITY_METHODS = ['email', 'google', 'microsoft', 'mfa'] as const;
export type IdentityMethod = (typeof IDENTITY_METHODS)[number];

/** EPIC 7 — AI runtime providers. */
export const AI_PROVIDERS = ['ollama', 'openai', 'anthropic', 'gemini', 'azure-openai'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

/** EPIC 8 — storage kinds. */
export const STORAGE_KINDS = ['object', 'file', 'backup', 'log', 'artifact'] as const;
export type StorageKind = (typeof STORAGE_KINDS)[number];

/** EPIC 9 — CI/CD pipelines. */
export const PIPELINE_KINDS = ['build', 'test', 'release', 'rollback', 'hotfix'] as const;
export type PipelineKind = (typeof PIPELINE_KINDS)[number];

/** EPIC 10 — the monitoring stack. Represented until real endpoints are configured. */
export const MONITORING_STACK = ['prometheus', 'grafana', 'loki', 'opentelemetry'] as const;
export type MonitoringComponent = (typeof MONITORING_STACK)[number];

/** EPIC 14 — deployment strategies. */
export const DEPLOY_STRATEGIES = ['one-click', 'rolling', 'canary', 'blue-green', 'rollback'] as const;
export type DeployStrategy = (typeof DEPLOY_STRATEGIES)[number];

/** EPIC 15 — production validation areas. Only measured results are reported. */
export const VALIDATION_AREAS = ['infrastructure', 'apis', 'identity', 'ai-runtime', 'database', 'monitoring', 'storage', 'networking'] as const;
export type ValidationArea = (typeof VALIDATION_AREAS)[number];

/** EPIC 16 — the seven operations manuals. */
export const MANUAL_KINDS = ['infrastructure', 'kubernetes', 'devops', 'operations', 'incident', 'backup', 'recovery'] as const;
export type ManualKind = (typeof MANUAL_KINDS)[number];

/** The named external providers tracked as rows in the evidence matrix. */
export const MATRIX_ADAPTERS = ['AWS', 'Azure', 'Google Cloud', 'PostgreSQL', 'Redis', 'Qdrant', 'AI providers', 'Monitoring stack', 'Vault', 'CDN / WAF providers'] as const;

/** Capabilities that require REAL provisioned infrastructure — represented until it exists. */
export const INFRASTRUCTURE_PENDING_CAPS = ['live-domain', 'running-kubernetes-clusters', 'provisioned-production-databases', 'issued-tls-certificates', 'production-load-balancers', 'production-object-storage'] as const;
export type InfrastructurePendingCap = (typeof INFRASTRUCTURE_PENDING_CAPS)[number];
