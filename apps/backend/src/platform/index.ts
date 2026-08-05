/**
 * Backend ↔ shared platform adapters (NCEA 10.2B). The backend consumes
 * cloud-core through these thin, additive adapters — one implementation of each
 * platform capability, reused rather than reimplemented.
 */
export * from './events';
export * from './response';
export * from './secretGuard';
export * from './audit';
export * from './notifications';
