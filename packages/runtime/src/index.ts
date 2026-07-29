/**
 * @neuropause/runtime — the NeuroPause Enterprise Runtime (NCEA 10.2C).
 *
 * One composition root that assembles the existing platform (cloud-core
 * primitives + registered services) into a single runtime: dependency injection,
 * ordered lifecycle, one event bus, unified health, observability, a scheduler,
 * and a plugin registry. Reusable by backend, desktop, cloud, and future
 * mobile/web — they all `createEnterpriseRuntime()` and register services into it.
 *
 * STATUS: PREVIEW foundation. Pure, in-memory composition — no server, database,
 * or TLS. Governance stays in NeuroPause OS; the runtime EXECUTES, it does not decide.
 */
export * from './constants';
export * from './config';
export * from './health';
export * from './events';
export * from './observability';
export * from './scheduler';
export * from './plugins';
export * from './registry';
export * from './lifecycle';
export * from './runtime';
