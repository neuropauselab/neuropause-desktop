/**
 * Wave 6 constants. Isolated module (no imports).
 */
export const FEDERATION_VERSION = '0.0.0-preview.1';

/** Module 6 — deployment descriptor targets. Descriptors only; never applied. */
export const DEPLOYMENT_TARGETS = ['local', 'docker', 'kubernetes', 'air-gap', 'aws', 'azure', 'gcp'] as const;
export type DeploymentTarget = (typeof DEPLOYMENT_TARGETS)[number];

/** Deployment targets that touch real cloud/infra — descriptors are adapter-verified, real deploy is infra-pending. */
export const CLOUD_TARGETS: readonly DeploymentTarget[] = ['kubernetes', 'aws', 'azure', 'gcp'];

/** Module 7 — trust levels, ordered least → most. */
export const TRUST_LEVELS = ['none', 'read', 'share', 'full'] as const;
export type TrustLevel = (typeof TRUST_LEVELS)[number];

/** Module 8 — shareable artifact kinds. */
export const ARTIFACT_KINDS = ['workflow', 'policy', 'dashboard', 'playbook', 'connector', 'ai-agent'] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

/** Module 9 — marketplace listing kinds. */
export const MARKETPLACE_KINDS = ['package', 'plugin', 'connector', 'workflow', 'ai-agent', 'template'] as const;
export type MarketplaceKind = (typeof MARKETPLACE_KINDS)[number];

/** Module 14 — executive federation dashboard roles. */
export const FEDERATION_ROLES = ['CEO', 'CTO', 'CISO', 'Platform Operations', 'Cloud Operations', 'Partner Operations'] as const;
export type FederationRole = (typeof FEDERATION_ROLES)[number];
