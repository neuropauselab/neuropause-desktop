/**
 * Wave 14 constants. Isolated module (no imports).
 */
export const PRODUCTION_VERSION = '0.0.0-preview.1';

/** The one honest answer production monitoring/analytics gives when no real data exists. */
export const NO_PRODUCTION_DATA = 'No production data available';

/** Module 1 — release channels. */
export const RELEASE_CHANNELS = ['stable', 'beta', 'edge', 'lts'] as const;
export type ReleaseChannel = (typeof RELEASE_CHANNELS)[number];

/** Module 1 — environment tiers. */
export const ENVIRONMENT_TIERS = ['development', 'staging', 'production', 'dr'] as const;
export type EnvironmentTier = (typeof ENVIRONMENT_TIERS)[number];

/** Module 2 — deployment platforms (external — adapter-verified until configured). */
export const DEPLOYMENT_PLATFORMS = ['kubernetes', 'docker', 'bare-metal', 'vmware', 'hyper-v', 'aws', 'azure', 'gcp', 'on-premise', 'hybrid'] as const;
export type DeploymentPlatform = (typeof DEPLOYMENT_PLATFORMS)[number];

/** Module 4 — zero-downtime upgrade strategies. */
export const UPGRADE_STRATEGIES = ['rolling', 'blue-green', 'canary', 'progressive'] as const;
export type UpgradeStrategy = (typeof UPGRADE_STRATEGIES)[number];

/** Module 5 — backup kinds. */
export const BACKUP_KINDS = ['tenant', 'workspace', 'database', 'configuration'] as const;
export type BackupKind = (typeof BACKUP_KINDS)[number];

/** Module 10 — compliance audit kinds. */
export const AUDIT_KINDS = ['security', 'configuration', 'dependency', 'license', 'infrastructure'] as const;
export type AuditKind = (typeof AUDIT_KINDS)[number];

/** Module 11 — performance test kinds. */
export const PERF_TESTS = ['load', 'stress', 'endurance'] as const;
export type PerfTest = (typeof PERF_TESTS)[number];

/** Module 12 — chaos experiment kinds. */
export const CHAOS_KINDS = ['failure-injection', 'network', 'node-failure', 'service-failure'] as const;
export type ChaosKind = (typeof CHAOS_KINDS)[number];

/** Module 13 — health domains. */
export const HEALTH_DOMAINS = ['platform', 'tenant', 'ai-workforce', 'workspace', 'business', 'infrastructure'] as const;
export type HealthDomain = (typeof HEALTH_DOMAINS)[number];

/** Module 16 — installer targets (artifacts represented — not built here). */
export const INSTALLER_TARGETS = ['windows', 'macos', 'linux', 'docker', 'kubernetes'] as const;
export type InstallerTarget = (typeof INSTALLER_TARGETS)[number];

/** Module 17 — documentation kinds. */
export const DOC_KINDS = ['administrator', 'user', 'api', 'sdk', 'deployment', 'disaster-recovery', 'security', 'operations'] as const;
export type DocKind = (typeof DOC_KINDS)[number];

/** Module 19 — production SDK extension kinds. */
export const PROD_SDK_KINDS = ['deployment', 'monitoring', 'health-check', 'diagnostics', 'installer', 'upgrade'] as const;
export type ProdSdkKind = (typeof PROD_SDK_KINDS)[number];

/** Module 22 — external deployment / monitoring providers (adapter-verified). */
export const DEPLOY_ADAPTER_CATALOG: Array<{ system: string; category: string }> = [
  { system: 'Kubernetes', category: 'orchestrator' },
  { system: 'Docker', category: 'container' },
  { system: 'AWS', category: 'cloud' },
  { system: 'Azure', category: 'cloud' },
  { system: 'Google Cloud', category: 'cloud' },
  { system: 'VMware', category: 'virtualization' },
  { system: 'Hyper-V', category: 'virtualization' },
  { system: 'Monitoring Provider', category: 'monitoring' },
];

/** Capabilities that require real infrastructure — represented via descriptors until configured. */
export const INFRASTRUCTURE_PENDING_CAPS = ['ha-clusters', 'multi-region-failover', 'production-dr', 'global-replication'] as const;
export type InfrastructurePendingCap = (typeof INFRASTRUCTURE_PENDING_CAPS)[number];
