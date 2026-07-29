/**
 * @neuropause/connectors — the Enterprise Connector & Automation Platform (NCEA 10.4).
 *
 * One governed connector runtime built on the Enterprise Runtime. Every external
 * system connects through it; every connector execution and automation runs
 * through the runtime's SINGLE event bus, audit chain, timeline, scheduler, and
 * metrics. Nothing bypasses governance; credentials never leave the vault.
 *
 * STATUS: PREVIEW foundation. Pure, in-memory. Ships production-ready adapter
 * INTERFACES + deterministic MOCKS; live integrations (OpenAI, GitHub, Slack,
 * Postgres, S3, …) require credentials + network and are NOT included here.
 */
export * from './constants';
export * from './vault';
export * from './auth';
export * from './sdk';
export * from './governance';
export * from './registry';
export * from './execution';
export * from './triggers';
export * from './automation';
export * from './observability';
export * from './catalog';
export * from './marketplace';
export * from './platform';
