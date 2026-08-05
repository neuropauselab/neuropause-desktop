/**
 * @neuropause/deploy — NeuroPause Enterprise Management System, Production Execution Program,
 * Sprint 1: the Enterprise Production Foundation. Composes Waves 1–14 (unchanged) into a real,
 * validated, evidence-first deployment foundation — a catalog of production deployment assets
 * (Docker, Kubernetes, Helm, IaC, GitHub Actions, configuration, monitoring, backup, secrets,
 * network, storage, documentation) plus the TypeScript foundation that indexes, validates, and
 * governs them by REUSING the Wave 7 cloud-ops, Wave 12 operations, Wave 13 commercial, Wave 14
 * production, and security platforms.
 *
 * HONESTY BOUNDARY (see DEPLOY_MATRIX):
 *   live-verified          — the real deployment assets + the foundation that governs them.
 *   adapter-verified       — AWS/Azure/GCP/DigitalOcean/Hetzner/VMware/Kubernetes/MinIO/Vault.
 *   business-data-pending  — deployment/production/release/runtime metrics, customer deployments.
 *   infrastructure-pending — real clusters/cloud/databases/monitoring/DNS/TLS/load-balancers.
 * Infrastructure is NEVER classified live; assets are represented, not created.
 */
export * from './constants';
export * from './types';
export * from './governance';
export * from './adapters';
export * from './assets';
export * from './assetPlatforms';
export * from './environment';
export * from './infrastructure';
export * from './secretsPlatform';
export * from './observability';
export * from './backupFoundation';
export * from './securityBootstrap';
export * from './releaseManagement';
export * from './evidence';
export * from './platform';
