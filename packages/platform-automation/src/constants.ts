/**
 * Version 1.1 Program 1B constants. Isolated module (no imports). Enumerates the automation domains,
 * execution modes, cloud providers, environments, secret backends, monitoring stack, CI/CD stages,
 * validation targets, and artifact kinds — plus the external tools that stay adapter-verified and the
 * real infrastructure that stays infrastructure-pending.
 *
 * HONESTY: this package GENERATES and PLANS infrastructure automation. It NEVER creates cloud resources,
 * deploys clusters, configures production secrets, publishes DNS, issues certificates, promotes evidence,
 * or claims a successful deployment. Preview never modifies infrastructure; Execute requires explicit
 * operator approval and still only PREPARES the operator execution package — real execution is out-of-band.
 */
export const PA_VERSION = '1.1.0';

/** The one honest answer automation analytics gives when no real production automation run exists. */
export const NO_AUTOMATION_DATA = 'No production automation data available';

/** EPIC 1 — execution modes. Preview is strictly side-effect-free. */
export const EXECUTION_MODES = ['preview', 'execute'] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

/**
 * EPIC 1 — automation run status. Note the ABSENCE of 'deployed'/'succeeded': the highest state this
 * control plane reaches is 'prepared' (approved + operator package emitted). Real success is recorded
 * out-of-band via the evidence-promotion process.
 */
export const AUTOMATION_STATUS = ['registered', 'planned', 'previewed', 'approved', 'prepared', 'rolled-back', 'failed'] as const;
export type AutomationStatus = (typeof AUTOMATION_STATUS)[number];

/** EPIC 2 — Terraform target providers. */
export const CLOUD_PROVIDERS = ['aws', 'azure', 'gcp', 'self-hosted'] as const;
export type CloudProvider = (typeof CLOUD_PROVIDERS)[number];

/** EPIC 2 — deployment environments. */
export const ENVIRONMENTS = ['production', 'staging', 'development'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

/** EPIC 6 — secret backends (adapter-verified until an operator wires a real one). */
export const SECRET_BACKENDS = ['hashicorp-vault', 'aws-secrets-manager', 'azure-key-vault', 'google-secret-manager', 'external-secrets-operator'] as const;
export type SecretBackend = (typeof SECRET_BACKENDS)[number];

/** EPIC 7 — the monitoring stack whose deployment descriptors are generated. */
export const MONITORING_STACK = ['prometheus', 'grafana', 'loki', 'opentelemetry', 'alertmanager'] as const;
export type MonitoringComponent = (typeof MONITORING_STACK)[number];

/** EPIC 7 — dashboard targets. */
export const DASHBOARD_TARGETS = ['infrastructure', 'kubernetes', 'database', 'ai-runtime', 'apis'] as const;
export type DashboardTarget = (typeof DASHBOARD_TARGETS)[number];

/** EPIC 9 — CI/CD stages generated as GitHub Actions jobs. */
export const CICD_STAGES = ['build', 'test', 'security-scan', 'sbom', 'container-signing', 'deployment-validation', 'rollback-validation'] as const;
export type CicdStage = (typeof CICD_STAGES)[number];

/** EPIC 10 — production validation targets. */
export const VALIDATION_TARGETS = ['kubernetes', 'apis', 'databases', 'identity', 'monitoring', 'logging', 'tls', 'storage'] as const;
export type ValidationTarget = (typeof VALIDATION_TARGETS)[number];

/** The kinds of artifact the generators emit. */
export const ARTIFACT_KINDS = ['terraform', 'kubernetes', 'github-actions', 'monitoring', 'dns-tls', 'secrets', 'database', 'backup'] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

/** The external tools tracked as ADAPTER-VERIFIED rows in the evidence matrix. */
export const MATRIX_ADAPTERS = ['Terraform Providers', 'Vault', 'Cloud Secret Managers', 'GitHub Actions', 'cert-manager'] as const;

/** Capabilities that require real cloud accounts/infrastructure — represented until operators execute. */
export const INFRASTRUCTURE_PENDING_CAPS = ['cloud-accounts', 'kubernetes-clusters', 'dns-zones', 'tls-certificates', 'production-networks'] as const;
export type InfrastructurePendingCap = (typeof INFRASTRUCTURE_PENDING_CAPS)[number];
