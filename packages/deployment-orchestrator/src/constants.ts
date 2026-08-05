/**
 * Launch Workstream 5 constants. Isolated module (no imports). Enumerates the deployment lifecycle,
 * environment types, government/public-sector profile templates, rollout modes, partner types, training
 * tracks, launch-readiness domains, and Launch-Operations-Center dashboards — plus the external systems
 * that stay adapter-verified and the customer/government infrastructure that stays infrastructure-pending.
 *
 * HONESTY: this package is the deployment-orchestration & launch CONTROL PLANE (software). It models
 * deployment READINESS, not claimed deployment. It NEVER claims an enterprise, government, or public-
 * sector deployment; procurement approval; a signed contract; production revenue; or marketplace
 * publication — those are represented until actually completed and verified.
 */
export const DO_VERSION = '1.0.0';

/** The one honest answer launch analytics gives when no real customer/deployment data exists. */
export const NO_CUSTOMER_DATA = 'No customer or deployment data available';

/**
 * EPIC 1 — deployment lifecycle. A deployment reaches 'rollout-ready' when its plan is validated and
 * approved — this is READINESS, never a claim that a real production deployment occurred.
 */
export const DEPLOYMENT_STATUS = ['registered', 'validated', 'approved', 'rollout-ready', 'rolled-back', 'retired'] as const;
export type DeploymentStatus = (typeof DEPLOYMENT_STATUS)[number];

/** EPIC 1 — environment types. 'production-target' is represented; no real production environment exists. */
export const ENVIRONMENT_TYPES = ['development', 'staging', 'pre-production', 'production-target'] as const;
export type EnvironmentType = (typeof ENVIRONMENT_TYPES)[number];

/** EPIC 3 — government & public-sector deployment profile TEMPLATES (templates only, never a real deployment). */
export const GOVERNMENT_PROFILES = [
  'National Ministry',
  'State Department',
  'Municipal Corporation',
  'Healthcare Authority',
  'Education Department',
  'Public Utility',
  'Law Enforcement',
  'Smart City',
] as const;
export type GovernmentProfile = (typeof GOVERNMENT_PROFILES)[number];

/** EPIC 4 — enterprise rollout modes. */
export const ROLLOUT_MODES = ['single-tenant', 'multi-tenant', 'regional', 'global'] as const;
export type RolloutMode = (typeof ROLLOUT_MODES)[number];

/** EPIC 5 — GA go/no-go decisions. */
export const GA_DECISIONS = ['go', 'no-go', 'conditional-go'] as const;
export type GaDecision = (typeof GA_DECISIONS)[number];

/** EPIC 7 — commercial pipeline stages. Contracts and revenue are never fabricated. */
export const COMMERCIAL_STAGES = ['opportunity', 'proposal', 'quote', 'contract', 'license-activation', 'renewal'] as const;
export type CommercialStage = (typeof COMMERCIAL_STAGES)[number];

/** EPIC 8 — partner ecosystem types (represented until agreements exist). */
export const PARTNER_TYPES = ['system-integrator', 'consulting', 'technology', 'marketplace', 'training'] as const;
export type PartnerType = (typeof PARTNER_TYPES)[number];

/** EPIC 11 — training tracks (represented until assets are created). */
export const TRAINING_TRACKS = ['administrator', 'customer', 'partner', 'government-operator'] as const;
export type TrainingTrack = (typeof TRAINING_TRACKS)[number];

/** EPIC 13 — launch-readiness domains validated for business launch. */
export const LAUNCH_DOMAINS = [
  'platform',
  'infrastructure',
  'customer-experience',
  'enterprise-connectivity',
  'trust-platform',
  'operations',
  'documentation',
  'training',
  'support',
] as const;
export type LaunchDomain = (typeof LAUNCH_DOMAINS)[number];

/** EPIC 10 — Launch-Operations-Center dashboards (verified operational data only). */
export const LAUNCH_DASHBOARDS = [
  'deployment-pipeline',
  'platform-readiness',
  'customer-readiness',
  'government-readiness',
  'commercial-readiness',
  'support-readiness',
  'executive-status',
] as const;
export type LaunchDashboard = (typeof LAUNCH_DASHBOARDS)[number];

/** EPIC 12 — the launch guides generated (outlines/metadata; no external content is fabricated). */
export const LAUNCH_GUIDES = [
  'Enterprise Deployment Guide',
  'Government Deployment Guide',
  'Public Sector Guide',
  'Partner Guide',
  'Customer Success Guide',
  'Operations Handbook',
  'Hypercare Handbook',
  'Launch Playbook',
] as const;
export type LaunchGuide = (typeof LAUNCH_GUIDES)[number];

/** The named external systems tracked as ADAPTER-VERIFIED rows in the evidence matrix. */
export const MATRIX_ADAPTERS = ['CRM', 'ERP', 'Identity Providers', 'Email Providers', 'Payment Providers', 'Marketplace APIs'] as const;

/** Capabilities that require real customer/government infrastructure — represented until they exist. */
export const INFRASTRUCTURE_PENDING_CAPS = [
  'customer-production-environments',
  'government-production-networks',
  'national-cloud-infrastructure',
  'production-rollouts',
  'marketplace-publication',
] as const;
export type InfrastructurePendingCap = (typeof INFRASTRUCTURE_PENDING_CAPS)[number];
