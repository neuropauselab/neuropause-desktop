/**
 * @neuropause/connectivity — NEMS Wave 2 Enterprise Connectivity Platform. Composes
 * the existing platform (runtime audit chain + event bus, security envelope-encryption
 * vault, persistence SqlDriver, connectors SDK/registry/executor/governance,
 * integrations transport/OAuth/reliability/sync/webhooks) into the NEMS connectivity
 * layer: a tenant-aware connector lifecycle, an encrypted credential platform, a
 * governed synchronization engine (retry queue + dead-letter queue + workers), seven
 * provider adapters (GitHub / Gmail / Calendar / Slack / Jira / Notion / PostgreSQL)
 * over a pluggable HTTP transport, unified enterprise search, and a connector dashboard.
 *
 * Every sync is audited + published; every credential is encrypted at rest; every
 * connector is tenant-aware. SaaS adapters are verified against SIMULATED provider
 * responses through the transport seam — live provider execution needs operator OAuth
 * credentials + network and is marked infra-pending, never fabricated. Only the
 * PostgreSQL connector is live-verified (real embedded Postgres).
 */
export * from './constants';
export * from './evidence';
export * from './credentials';
export * from './lifecycle';
export * from './httpConnector';
export * from './governance';
export * from './sync';
export * from './search';
export * from './dashboard';
export * from './providers/github';
export * from './providers/gmail';
export * from './providers/calendar';
export * from './providers/slack';
export * from './providers/jira';
export * from './providers/notion';
export * from './providers/postgres';
export * from './platform';
