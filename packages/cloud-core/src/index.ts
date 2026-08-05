/**
 * @neuropause/cloud-core — the shared cloud PLATFORM primitives.
 *
 * Extracted from apps/cloud in NCEA 10.2B so the platform is a reusable LIBRARY
 * consumable by the backend, the desktop runtime, and future surfaces — without
 * an app→app dependency. `apps/cloud` composes these into a service; the backend
 * consumes them via adapters (apps/backend/src/platform).
 *
 * STATUS: PREVIEW foundation. In-memory implementations behind interfaces; no
 * server, database, or TLS. Governance stays in NeuroPause OS — nothing here
 * decides; it coordinates.
 */
export * from './lib';
export * from './services/events';
export * from './services/sync';
export * from './services/audit';
export * from './services/notifications';
export * from './services/timeline';
export * from './services/gateway';
export * from './services/security';
export * from './services/observability';
