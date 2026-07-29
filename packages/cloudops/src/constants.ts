/**
 * Wave 7 constants. Isolated module (no imports).
 */
export const CLOUDOPS_VERSION = '0.0.0-preview.1';

/** Module 1 — cloud provider descriptor kinds. Adapters/descriptors only; never connected. */
export const CLOUD_PROVIDERS = ['kubernetes', 'aws', 'azure', 'gcp', 'on-prem'] as const;
export type CloudProvider = (typeof CLOUD_PROVIDERS)[number];

/** Module 2 — environment tiers, ordered least → most production-like. */
export const ENVIRONMENTS = ['development', 'testing', 'qa', 'staging', 'production'] as const;
export type EnvironmentTier = (typeof ENVIRONMENTS)[number];

/** Module 3 — deployable workload kinds. */
export const WORKLOAD_KINDS = ['application', 'service', 'job', 'cronjob', 'worker', 'api'] as const;
export type WorkloadKind = (typeof WORKLOAD_KINDS)[number];

/** Module 4 — Kubernetes resource kinds we can DESCRIBE (never apply). */
export const K8S_KINDS = [
  'Namespace',
  'Deployment',
  'StatefulSet',
  'DaemonSet',
  'Service',
  'ConfigMap',
  'Secret',
  'Ingress',
  'HorizontalPodAutoscaler',
  'NetworkPolicy',
  'PersistentVolumeClaim',
] as const;
export type K8sKind = (typeof K8S_KINDS)[number];

/** Module 5 — GitOps engine adapters (shapes only). */
export const GITOPS_ENGINES = ['argocd', 'flux'] as const;
export type GitOpsEngine = (typeof GITOPS_ENGINES)[number];

/** Module 7 — external secret backends (adapter shapes; no real synchronization). */
export const SECRET_BACKENDS = ['hashicorp-vault', 'aws-secrets-manager', 'azure-key-vault', 'gcp-secret-manager'] as const;
export type SecretBackend = (typeof SECRET_BACKENDS)[number];

/** Module 8 — release/rollout strategies. Workflow validated; never executed. */
export const RELEASE_STRATEGIES = ['rolling', 'blue-green', 'canary', 'recreate', 'progressive'] as const;
export type ReleaseStrategy = (typeof RELEASE_STRATEGIES)[number];

/** Module 9 — infrastructure policy kinds. Evaluated in-process against descriptors. */
export const POLICY_KINDS = [
  'resource-limits',
  'security-context',
  'namespace-isolation',
  'deployment-approval',
  'required-labels',
  'image-policy',
  'compliance',
] as const;
export type PolicyKind = (typeof POLICY_KINDS)[number];

/** Module 10 — observability backend adapters (shapes only; no live telemetry). */
export const OBSERVABILITY_BACKENDS = ['prometheus', 'grafana', 'loki', 'tempo', 'opentelemetry'] as const;
export type ObservabilityBackend = (typeof OBSERVABILITY_BACKENDS)[number];

export const OBSERVABILITY_SIGNALS = ['metrics', 'logs', 'tracing', 'alerts', 'dashboards'] as const;
export type ObservabilitySignal = (typeof OBSERVABILITY_SIGNALS)[number];

/** Module 11 — backup & disaster-recovery plan kinds (simulation only). */
export const RECOVERY_PLAN_KINDS = ['backup', 'restore', 'snapshot', 'recovery', 'disaster-recovery', 'failover'] as const;
export type RecoveryPlanKind = (typeof RECOVERY_PLAN_KINDS)[number];

/** Module 13 — cloud operations dashboard roles. */
export const CLOUDOPS_ROLES = ['CEO', 'CTO', 'Platform Engineering', 'Cloud Operations', 'SRE', 'Security'] as const;
export type CloudOpsRole = (typeof CLOUDOPS_ROLES)[number];
