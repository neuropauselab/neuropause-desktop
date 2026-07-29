/**
 * @neuropause/production — NeuroPause Enterprise Management System, Wave 14: the Enterprise
 * Production, Reliability & Deployment Platform. The final operational layer responsible for the
 * deployment, reliability, monitoring, recovery, and lifecycle management of every underlying
 * platform capability — composed on Waves 1–13 (unchanged).
 *
 * HONESTY BOUNDARY (see PRODUCTION_MATRIX):
 *   live-verified          — production runtime/registries, release management, upgrade planning,
 *                            backup registry, DR plans/drills, observability runtime, security
 *                            hardening, compliance verification, health monitoring, diagnostics,
 *                            upgrade assistant, installer, documentation, support, SDK, governance.
 *   adapter-verified       — Kubernetes/Docker/AWS/Azure/GCP/VMware/Hyper-V/monitoring (until configured).
 *   business-data-pending  — production metrics, customer deployments, upgrade/incident/perf history.
 *   infrastructure-pending — real HA clusters, multi-region failover, production DR, global replication.
 * No certification is claimed anywhere; real infrastructure is represented via validated descriptors.
 */
export * from './constants';
export * from './types';
export * from './governance';
export * from './adapters';
export * from './runtime';
export * from './deployment';
export * from './release';
export * from './upgradeStrategy';
export * from './backup';
export * from './disasterRecovery';
export * from './highAvailability';
export * from './observability';
export * from './security';
export * from './compliance';
export * from './performance';
export * from './chaos';
export * from './health';
export * from './diagnostics';
export * from './upgradeAssistant';
export * from './installer';
export * from './documentation';
export * from './support';
export * from './sdk';
export * from './evidence';
export * from './platform';
