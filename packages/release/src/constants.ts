/**
 * Sprint 6 constants. Isolated module (no imports). Enumerates the release lifecycle, package targets,
 * marketplace channels, license tiers, documentation guides, playbooks, and RC validation areas — plus
 * the catalog of EXTERNAL distribution channels that stay adapter-verified until a real publication,
 * and the customer/commercial capabilities that stay business-data- or infrastructure-pending until
 * real production data and infrastructure exist. Nothing here publishes a listing, claims revenue or a
 * certification, fabricates an executive approval, or declares that GA has actually occurred in the
 * real world — it declares that v1.0 is packaged and GOVERNED for GA.
 */
export const RELEASE_VERSION = '1.0.0-rc.1';

/** The Version 1.0 GA target this sprint packages + governs. */
export const GA_VERSION_TARGET = '1.0.0';

/** The one honest answer release analytics gives when no real data exists. */
export const NO_RELEASE_DATA = 'No release data available';

/** EPIC 1 — release lifecycle. 'released' is reached only through the evidence-based GA gate, never assumed. */
export const RELEASE_STATUS = ['draft', 'release-candidate', 'validated', 'ga-approved', 'released', 'superseded', 'rolled-back'] as const;
export type ReleaseStatus = (typeof RELEASE_STATUS)[number];

/** EPIC 2 — production package targets. Artifacts are represented with real descriptors + checksums. */
export const PACKAGE_TARGETS = ['windows', 'macos', 'linux', 'docker', 'kubernetes', 'helm', 'offline-bundle'] as const;
export type PackageTarget = (typeof PACKAGE_TARGETS)[number];

/** EPIC 5 — release channels. */
export const RELEASE_CHANNELS = ['stable', 'lts', 'beta'] as const;
export type ReleaseChannel = (typeof RELEASE_CHANNELS)[number];

/** EPIC 5 — patch kinds tracked by the release-management registries. */
export const PATCH_KINDS = ['hotfix', 'patch', 'security'] as const;
export type PatchKind = (typeof PATCH_KINDS)[number];

/** EPIC 11 — external distribution channels. Represented; NEVER claimed live until actually published. */
export const MARKETPLACE_CHANNELS = ['github-releases', 'private-enterprise-repo', 'azure-marketplace', 'aws-marketplace', 'docker-registry'] as const;
export type MarketplaceChannel = (typeof MARKETPLACE_CHANNELS)[number];

/** EPIC 12 — commercial license tiers. */
export const LICENSE_TIERS = ['trial', 'community', 'professional', 'enterprise'] as const;
export type LicenseTier = (typeof LICENSE_TIERS)[number];

/** EPIC 3 — the subsystems the release-candidate validation covers. */
export const RC_VALIDATION_AREAS = [
  'infrastructure',
  'security',
  'identity',
  'integrations',
  'ai-runtime',
  'business',
  'workspace',
  'workforce',
  'operations',
  'commercial',
] as const;
export type RcValidationArea = (typeof RC_VALIDATION_AREAS)[number];

/** EPIC 4 — GA gate decision. Evidence-based; a real named executive approver is required, never fabricated. */
export const GA_DECISION = ['go', 'no-go'] as const;
export type GaDecision = (typeof GA_DECISION)[number];

/** EPIC 9 — the eleven enterprise documentation guides. */
export const DOC_GUIDES = [
  'administrator',
  'deployment',
  'user',
  'api-reference',
  'sdk',
  'operations-manual',
  'security-manual',
  'disaster-recovery',
  'troubleshooting',
  'upgrade',
  'customer-success',
] as const;
export type DocGuide = (typeof DOC_GUIDES)[number];

/** EPIC 16 — production operations playbooks. */
export const PLAYBOOK_KINDS = ['operations', 'support', 'release', 'incident', 'maintenance', 'upgrade'] as const;
export type PlaybookKind = (typeof PLAYBOOK_KINDS)[number];

/** EPIC 7 — support ticket lifecycle. */
export const TICKET_STATUS = ['open', 'triaged', 'escalated', 'resolved', 'closed'] as const;
export type TicketStatus = (typeof TICKET_STATUS)[number];

/** The named external channels tracked as rows in the evidence matrix. */
export const MATRIX_ADAPTERS = ['GitHub Releases', 'Private Enterprise Repositories', 'Azure Marketplace', 'AWS Marketplace', 'Docker Registry'] as const;

/** Capabilities that require external infrastructure/publication — represented until they occur. */
export const INFRASTRUCTURE_PENDING_CAPS = ['external-marketplace-publication', 'customer-production-environments', 'regional-deployments', 'cdn-distribution'] as const;
export type InfrastructurePendingCap = (typeof INFRASTRUCTURE_PENDING_CAPS)[number];
