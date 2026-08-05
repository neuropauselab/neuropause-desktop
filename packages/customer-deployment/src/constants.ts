/**
 * Sprint 5 constants. Isolated module (no imports). Enumerates the deployment lifecycle, environment
 * tiers, federated identity providers, integration categories, user + AI-workforce roles, migration
 * and UAT states, readiness dimensions, and the Go/No-Go decision — plus the catalog of EXTERNAL
 * systems that stay adapter-verified until configured and verified, and the customer-infrastructure
 * capabilities that stay infrastructure-pending until provided. Nothing here contacts an external
 * system, imports proprietary customer data, fabricates a UAT approval, or declares GA.
 */
export const CUSTOMER_DEPLOYMENT_VERSION = '0.0.0-preview.1';

/** The one honest answer customer analytics gives when no real data exists. */
export const NO_CUSTOMER_DATA = 'No customer data available';

/** EPIC 1 — deployment lifecycle. 'deployed'/'live' are only reached through the gated workflow, never assumed. */
export const DEPLOYMENT_STATUS = ['registered', 'onboarding', 'configuring', 'validating', 'ready', 'deployed', 'hypercare', 'rolled-back', 'failed'] as const;
export type DeploymentStatus = (typeof DEPLOYMENT_STATUS)[number];

/** EPIC 1 — environment tiers a customer deployment can target. */
export const ENVIRONMENT_TIERS = ['sandbox', 'staging', 'pilot', 'production'] as const;
export type EnvironmentTier = (typeof ENVIRONMENT_TIERS)[number];

/** EPIC 4 — federated identity providers (represented; reuse the Sprint-2 identity platform when configured). */
export const IDENTITY_PROVIDERS = ['Microsoft Entra ID', 'Google Workspace', 'Okta', 'LDAP', 'Active Directory', 'OIDC', 'SAML'] as const;
export type IdentityProvider = (typeof IDENTITY_PROVIDERS)[number];

/** EPIC 5 — customer integration categories. Active only with customer credentials AND verification. */
export const INTEGRATION_CATEGORIES = ['erp', 'crm', 'hr', 'finance', 'manufacturing', 'healthcare', 'collaboration', 'storage', 'messaging'] as const;
export type IntegrationCategory = (typeof INTEGRATION_CATEGORIES)[number];

/** EPIC 5 — integration activation lifecycle. 'active' requires configuration AND verification. */
export const ACTIVATION_STATUS = ['represented', 'configured', 'verified', 'active', 'failed'] as const;
export type ActivationStatus = (typeof ACTIVATION_STATUS)[number];

/** EPIC 7 — provisioned user kinds. */
export const USER_ROLES = ['employee', 'administrator', 'manager', 'executive', 'ai-worker'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** EPIC 9 — AI workforce roles. Only licensed workers are enabled. */
export const AI_WORKFORCE_ROLES = ['executive', 'operations', 'sales', 'hr', 'finance', 'customer-success'] as const;
export type AiWorkforceRole = (typeof AI_WORKFORCE_ROLES)[number];

/** EPIC 6 — migration lifecycle. Dry-run only; real data is never fabricated. */
export const MIGRATION_STATUS = ['planned', 'validated', 'dry-run', 'ready', 'rolled-back'] as const;
export type MigrationStatus = (typeof MIGRATION_STATUS)[number];

/** EPIC 11 — UAT sign-off states. 'signed-off' requires a real recorded approver, never fabricated. */
export const UAT_STATUS = ['draft', 'in-progress', 'passed', 'failed', 'signed-off'] as const;
export type UatStatus = (typeof UAT_STATUS)[number];

/** EPIC 19 — production-readiness dimensions the Go/No-Go gate evaluates. */
export const READINESS_DIMENSIONS = ['infrastructure', 'security', 'integration', 'identity', 'performance', 'customer'] as const;
export type ReadinessDimension = (typeof READINESS_DIMENSIONS)[number];

/** EPIC 19 — the gate decision. Evidence-based; the ceiling is 'go' for a PILOT, never a GA declaration. */
export const GO_NO_GO = ['go', 'no-go'] as const;
export type GoNoGo = (typeof GO_NO_GO)[number];

/** EPIC 18 — rollback scopes. */
export const ROLLBACK_SCOPES = ['tenant', 'configuration', 'migration', 'deployment'] as const;
export type RollbackScope = (typeof ROLLBACK_SCOPES)[number];

/** EPIC 16 — the seven operations runbooks. */
export const RUNBOOK_GUIDES = ['deployment', 'customer-onboarding', 'administrator', 'user', 'ai-operations', 'troubleshooting', 'support'] as const;
export type RunbookGuide = (typeof RUNBOOK_GUIDES)[number];

/** The named external systems tracked as rows in the evidence matrix. */
export const MATRIX_ADAPTERS = ['Identity providers', 'ERP systems', 'CRM systems', 'Manufacturing systems', 'Healthcare systems', 'HR systems', 'Finance systems', 'Collaboration platforms'] as const;

/** Capabilities that require the customer's own production infrastructure — represented until provided. */
export const INFRASTRUCTURE_PENDING_CAPS = ['customer-production-infrastructure', 'customer-networking', 'customer-vpns', 'customer-certificates', 'customer-production-databases'] as const;
export type InfrastructurePendingCap = (typeof INFRASTRUCTURE_PENDING_CAPS)[number];

/**
 * EPIC 17 — the pilot customer profile is DATA, not code. Relife Ortho is represented as a
 * configuration profile (a generic enterprise profile any customer could take) — never as hard-coded
 * business logic, and containing NO proprietary customer data.
 */
export interface CustomerProfile {
  key: string;
  displayName: string;
  industry: string;
  businessModules: string[];
  industryModules: string[];
  aiWorkers: AiWorkforceRole[];
  integrationCategories: IntegrationCategory[];
  identityProvider: IdentityProvider;
}

/** A representative pilot profile. Purely configuration — swap it for any enterprise. */
export const RELIFE_ORTHO_PROFILE: CustomerProfile = {
  key: 'relife-ortho',
  displayName: 'Relife Ortho (pilot profile)',
  industry: 'orthopedic-device-manufacturing',
  businessModules: ['manufacturing', 'inventory', 'quality', 'sales', 'service'],
  industryModules: ['orthopedic-device-processes', 'device-traceability', 'field-service'],
  aiWorkers: ['operations', 'sales', 'customer-success'],
  integrationCategories: ['erp', 'manufacturing', 'crm'],
  identityProvider: 'Microsoft Entra ID',
};
