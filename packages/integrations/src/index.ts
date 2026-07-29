/**
 * @neuropause/integrations — the Enterprise Integration & Live Provider Platform
 * (NCEA 13.0). Production-capable adapters that implement the EXISTING interfaces
 * (ai-runtime AiProvider, connector SDK, persistence SqlDriver, runtime event bus,
 * connector Secret Vault) — no duplicate runtime, provider framework, connector
 * runtime, vault, or persistence layer.
 *
 * STATUS: every integration carries an explicit evidence level. Request/response
 * construction, streaming parsing, OAuth flows, webhook-signature crypto,
 * reliability primitives, sync + checkpoint persistence (real Postgres), and the
 * Postgres connector are VERIFIED / ADAPTER-VERIFIED here. LIVE calls to OpenAI,
 * GitHub, Slack, Salesforce, Redis, S3, and the rest need credentials + network
 * and are INFRA-PENDING — named as such, never fabricated. See the Integration
 * Matrix (`matrix.ts`).
 */
export * from './constants';
export * from './http';
export * from './reliability';
export * from './providers';
export * from './oauth';
export * from './connectors';
export * from './db';
export * from './vaultCredentials';
export * from './webhooks';
export * from './sync';
export * from './observability';
export * from './matrix';
export * from './platform';
