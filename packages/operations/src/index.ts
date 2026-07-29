/**
 * @neuropause/operations — the Enterprise Reliability & Operations Platform
 * (NCEA 15.0). The ONE operations plane composed on the existing runtime: a global
 * health registry, centralized reliability policies (circuit breaker / retry /
 * timeout reused from integrations, plus bulkheads, fallback, and failure
 * classification), service-coordination interfaces, durable job & queue reliability
 * on the existing scheduler, disaster-recovery drills over the persistence backup
 * manager, distributed tracing + a unified dashboard on the one metrics registry, a
 * performance/load framework, deployment strategies, operational security wired to
 * Phase 14, and incident management wired to the one audit chain.
 *
 * STATUS: deterministic logic, real crypto/backup drills (incl. against real
 * embedded Postgres), and real memory/CPU sampling are VERIFIED. Real multi-node
 * clustering, production-scale load generation, cluster/cross-region DR, live
 * deployment orchestration, and telemetry export are INFRA-PENDING — named as such,
 * never fabricated. See the Operational Readiness Matrix (`matrix.ts`).
 */
export * from './constants';
export * from './opsAudit';
export * from './health';
export * from './reliability';
export * from './coordination';
export * from './jobs';
export * from './dr';
export * from './tracing';
export * from './observability';
export * from './performance';
export * from './deployment';
export * from './opsSecurity';
export * from './incidents';
export * from './matrix';
export * from './platform';
