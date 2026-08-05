/**
 * Version 1.1 Program 1C (Operator Deployment) constants. Isolated module. Enumerates the wizard fields,
 * environment-validation checks, deployment states, evidence items, rollback triggers, documentation
 * guides, and the external systems/infrastructure the operator flow depends on.
 *
 * HONESTY: this package prepares operators to run the FIRST real production deployment using their own
 * infrastructure. It creates no infrastructure and claims no deployment. The validator STOPS at
 * 'PENDING - OPERATOR ACTION REQUIRED' when a dependency is unverified; the executor runs only after
 * approval AND successful validation and never fabricates success; nothing is Verified without real evidence.
 */
export const OD_VERSION = '1.1.0';

/** The sentinel the validator returns when a dependency is not verified — execution stops here. */
export const PENDING_OPERATOR_ACTION = 'PENDING - OPERATOR ACTION REQUIRED';

/** The one honest answer operator analytics gives when no real deployment has occurred. */
export const NO_DEPLOYMENT_DATA = 'No production deployment data available';

/** Build item 1 — the wizard fields collected from the operator. */
export const WIZARD_FIELDS = ['cloudProvider', 'region', 'domain', 'kubernetes', 'postgresql', 'redis', 'objectStorage', 'containerRegistry', 'secretsManager'] as const;
export type WizardField = (typeof WIZARD_FIELDS)[number];

/** Build item 2 — pre-deployment environment checks. */
export const VALIDATION_CHECKS = ['credentials', 'kubernetes-reachable', 'dns-available', 'tls-issuer-available', 'registry-reachable', 'storage-reachable'] as const;
export type ValidationCheck = (typeof VALIDATION_CHECKS)[number];

/** Build item 7 — operator dashboard states. No 'succeeded'/'verified' is reachable without real evidence. */
export const DEPLOY_STATES = ['pending', 'running', 'succeeded', 'failed', 'verified'] as const;
export type DeployState = (typeof DEPLOY_STATES)[number];

/** Build item 6 — the evidence a deployment must collect. */
export const EVIDENCE_ITEMS = ['terraform-output', 'rollout-logs', 'pod-status', 'certificates', 'database-health', 'monitoring', 'backups'] as const;
export type EvidenceItem = (typeof EVIDENCE_ITEMS)[number];

/** Build item 5 — the conditions that automatically generate a rollback plan. */
export const ROLLBACK_TRIGGERS = ['rollout-timeout', 'failed-pods', 'unhealthy-api', 'failed-migrations'] as const;
export type RollbackTrigger = (typeof ROLLBACK_TRIGGERS)[number];

/** Build item 8 — the operator documentation guides generated. */
export const DOC_GUIDES = [
  'Operator Deployment Guide',
  'Production Checklist',
  'Troubleshooting Guide',
  'Rollback Guide',
  'Validation Guide',
  'Evidence Guide',
] as const;
export type DocGuide = (typeof DOC_GUIDES)[number];

/** The external systems tracked as ADAPTER-VERIFIED rows in the evidence matrix. */
export const MATRIX_ADAPTERS = ['Cloud Credentials', 'Kubernetes API', 'Container Registry', 'DNS Provider', 'TLS Issuer'] as const;

/** Capabilities that require real, reachable infrastructure — represented until operators provide it. */
export const INFRASTRUCTURE_PENDING_CAPS = ['reachable-cluster', 'reachable-databases', 'reachable-registry', 'reachable-dns', 'production-rollout'] as const;
export type InfrastructurePendingCap = (typeof INFRASTRUCTURE_PENDING_CAPS)[number];
