/**
 * @neuropause/platform-operations — NeuroPause Enterprise Management System, Launch Workstream 1:
 * Enterprise Production Infrastructure & Platform Operations.
 *
 * An additive package that composes Waves 1-14 and Sprints 1-6, unchanged, into the production
 * operations CONTROL PLANE: cloud/cluster inventory, Kubernetes/database/API/networking/storage/
 * monitoring descriptor registries, identity activation, AI-runtime operations, CI/CD, an operations
 * center, backup/recovery, production security, deployment automation, validation, documentation, and
 * an executive operations dashboard. Control-plane runtimes, descriptor registries, deployment
 * automation, validation, operations center, governance, and documentation are LIVE-VERIFIED; cloud
 * providers, database engines, AI providers, the monitoring stack, Vault, and CDN/WAF are ADAPTER-
 * VERIFIED; real production traffic/customer-sessions/AI-usage/query-load/metrics are BUSINESS-DATA-
 * PENDING; and the live domain (app.neuropause033.com), running clusters, provisioned databases, issued
 * TLS certificates, production load balancers, and production object storage are INFRASTRUCTURE-PENDING.
 * No live infrastructure or live domain is ever claimed unless configured and verified. Every operation
 * is audited on the one chain with a replay id.
 */
export * from './constants';
export * from './types';
export * from './governance';
export * from './cloudEnvironment';
export * from './kubernetes';
export * from './databases';
export * from './apiPlatform';
export * from './networking';
export * from './identityActivation';
export * from './aiOps';
export * from './storage';
export * from './cicd';
export * from './monitoring';
export * from './operationsCenter';
export * from './backupRecovery';
export * from './productionSecurity';
export * from './deploymentAutomation';
export * from './validation';
export * from './documentation';
export * from './executiveDashboard';
export * from './sdk';
export * from './evidence';
export * from './platform';
