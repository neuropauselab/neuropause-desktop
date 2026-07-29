/**
 * @neuropause/nems — the NeuroPause Enterprise Management System, Wave 1 Foundation
 * Platform. The production multi-tenant foundation of the internal operating system,
 * composed on the existing platform: ONE database (persistence SqlDriver), ONE
 * identity/authorization model (Phase-14 security), ONE audit chain + event bus
 * (runtime). Organizations, users, sessions (real scrypt login + MFA hooks),
 * dashboards, OKRs, and settings — all persisted, tenant-aware, and governed: every
 * mutation is audited on the one chain and published on the one bus. No demo data in
 * the runtime; no external integrations, AI agents, or billing (later waves).
 */
export * from './constants';
export * from './types';
export * from './schema';
export * from './audit';
export * from './events';
export * from './governance';
export * from './credentials';
export * from './organizations';
export * from './users';
export * from './identity';
export * from './dashboards';
export * from './okrs';
export * from './settings';
export * from './search';
export * from './ui';
export * from './platform';
