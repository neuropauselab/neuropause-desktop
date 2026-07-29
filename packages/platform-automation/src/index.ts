/**
 * @neuropause/platform-automation — NeuroPause Enterprise Management System, Version 1.1 Program 1B:
 * Production Infrastructure Automation.
 *
 * An additive package that composes Waves 1-14, Sprints 1-6, Launch Workstreams 1-5, and Version 1.1
 * Program 1A, unchanged, into a governed infrastructure-automation layer: an automation engine (registry,
 * planner, dependency resolver, dry-run, rollback planner) with a side-effect-free Preview mode and an
 * approval-gated Execute mode that only prepares operator packages; Terraform, Kubernetes, database,
 * DNS/TLS, secrets, monitoring, backup, and CI/CD generators; a validation runtime; an evidence
 * generator; an operations dashboard; and governance. The engine, every generator, the validation
 * runtime, the evidence generator, the dashboard, and governance are LIVE-VERIFIED in-process; Terraform
 * providers, Vault, cloud secret managers, GitHub Actions, and cert-manager are ADAPTER-VERIFIED;
 * production automation runs, deployment metrics, and operational KPIs are BUSINESS-DATA-PENDING; and
 * cloud accounts, Kubernetes clusters, DNS zones, TLS certificates, and production networks are
 * INFRASTRUCTURE-PENDING. Preview never modifies infrastructure; Execute never creates cloud resources,
 * deploys clusters, configures production secrets, publishes DNS, issues certificates, promotes evidence,
 * or claims a successful deployment. Every execution is recorded on the one governance chain with a replay id.
 */
export * from './constants';
export * from './serialize';
export * from './types';
export * from './governance';
export * from './engine';
export * from './terraform';
export * from './kubernetes';
export * from './database';
export * from './dnsTls';
export * from './secrets';
export * from './monitoring';
export * from './backup';
export * from './cicd';
export * from './validation';
export * from './evidenceCollector';
export * from './opsDashboard';
export * from './sdk';
export * from './evidence';
export * from './platform';
