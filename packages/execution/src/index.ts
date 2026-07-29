/**
 * @neuropause/execution — NEMS Wave 5 Enterprise Execution & Universal Connector Platform.
 * Composes the existing platform into a production execution platform: a universal connector
 * runtime (22 connectors), a connector execution engine (policy → HITL → rate limit → circuit
 * breaker → retry/backoff/timeout → transport → observe → govern → evidence), an OAuth
 * lifecycle manager, a secret rotation platform, credential vault extensions, connector health
 * monitoring, a retry/recovery engine (dead-letter queues), a rate limiter, a webhook runtime
 * (real HMAC verification), an event streaming platform, a universal API gateway, connector
 * observability, enterprise policy enforcement, external execution governance, analytics, and
 * production dashboards.
 *
 * The execution pipeline is LIVE-VERIFIED over real HTTP against a local server (a real
 * execution occurs). The 22 SaaS connectors are ADAPTER-VERIFIED with live execution
 * INFRA-PENDING on operator OAuth — no external SaaS execution is claimed unless it actually
 * occurred. Everything tenant-aware, replayable, observable, policy-enforced; automation never
 * bypasses governance.
 */
export * from './constants';
export * from './types';
export * from './evidence';
export * from './connectors';
export * from './runtime';
export * from './governance';
export * from './policy';
export * from './observability';
export * from './reliability';
export * from './circuit';
export * from './vault';
export * from './oauth';
export * from './engine';
export * from './gateway';
export * from './health';
export * from './webhooks';
export * from './streaming';
export * from './analytics';
export * from './dashboards';
export * from './platform';
