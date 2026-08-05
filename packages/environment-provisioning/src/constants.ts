/**
 * Version 1.1 Program 1C constants. Isolated module (no imports). Enumerates the operator inputs the
 * prerequisite gate requires, the provisioning phases, the provisioning status vocabulary, cloud
 * providers, acceptance checks — plus the external tools that stay adapter-verified and the real
 * infrastructure that stays infrastructure-pending.
 *
 * HONESTY: this package ORCHESTRATES provisioning using the Program 1B automation. It NEVER invents a
 * cloud account, DNS ownership, a certificate, a successful deployment, monitoring data, production
 * traffic, or customer usage. If a required operator input is missing it STOPS at
 * 'PENDING - OPERATOR INPUT REQUIRED'; the highest state it reaches is 'prepared' (approved + artifacts
 * ready) — real provisioning is the operator's out-of-band step, promoted only on real evidence.
 */
export const EP_VERSION = '1.1.0';

/** The one honest answer provisioning analytics gives when no real provisioning run exists. */
export const NO_PROVISIONING_DATA = 'No production provisioning data available';

/** The sentinel returned when a prerequisite is missing — execution stops here. */
export const PENDING_OPERATOR_INPUT = 'PENDING - OPERATOR INPUT REQUIRED';

/** The operator inputs required before any provisioning may be prepared. All are REFERENCES, never values. */
export const REQUIRED_INPUTS = ['cloudProvider', 'cloudCredentialsRef', 'domain', 'containerRegistryRef', 'dnsZoneRef', 'tlsAuthorityRef', 'secretsManagerRef', 'approval'] as const;
export type RequiredInput = (typeof REQUIRED_INPUTS)[number];

/** EPIC 1 — target cloud providers. */
export const CLOUD_PROVIDERS = ['aws', 'azure', 'gcp', 'self-hosted'] as const;
export type CloudProvider = (typeof CLOUD_PROVIDERS)[number];

/** The provisioning phases, in dependency order. */
export const PROVISIONING_PHASES = ['infrastructure', 'kubernetes', 'databases', 'dns-tls', 'secrets', 'deployment', 'monitoring'] as const;
export type ProvisioningPhase = (typeof PROVISIONING_PHASES)[number];

/**
 * Provisioning status. Note the ABSENCE of 'provisioned'/'succeeded': the highest state this orchestrator
 * reaches is 'prepared'. 'verified' is only reachable via real evidence (never set by this control plane).
 */
export const PROVISION_STATUS = ['pending', 'prepared', 'provisioning', 'failed', 'verified'] as const;
export type ProvisionStatus = (typeof PROVISION_STATUS)[number];

/** EPIC 9 — acceptance checks. */
export const ACCEPTANCE_CHECKS = ['api-health', 'database-health', 'redis', 'kubernetes-health', 'tls', 'identity', 'monitoring', 'logging', 'backup-verification'] as const;
export type AcceptanceCheck = (typeof ACCEPTANCE_CHECKS)[number];

/** EPIC 10 — the areas that require an evidence record before promotion. */
export const EVIDENCE_AREAS = ['terraform-apply', 'cluster-provisioning', 'database-provisioning', 'deployment', 'tls', 'monitoring', 'acceptance-tests'] as const;
export type EvidenceArea = (typeof EVIDENCE_AREAS)[number];

/** The external tools tracked as ADAPTER-VERIFIED rows in the evidence matrix. */
export const MATRIX_ADAPTERS = ['AWS', 'Azure', 'Google Cloud', 'Terraform', 'Helm', 'cert-manager'] as const;

/** Capabilities that require real cloud accounts/infrastructure — represented until operators provision. */
export const INFRASTRUCTURE_PENDING_CAPS = [
  'cloud-accounts',
  'provisioned-vpc',
  'provisioned-cluster',
  'provisioned-databases',
  'dns-zone',
  'tls-certificate',
  'production-deployment',
] as const;
export type InfrastructurePendingCap = (typeof INFRASTRUCTURE_PENDING_CAPS)[number];
