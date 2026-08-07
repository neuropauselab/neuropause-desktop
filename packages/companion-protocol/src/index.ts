/**
 * @neuropause/companion-protocol — the shared security + framing layer of the
 * NeuroPause Mobile companion (M1-02). Consumed by the desktop Companion
 * Gateway (main process) and the mobile app. Pure TypeScript; Hermes-portable
 * (the only host requirement is WebCrypto randomness for @noble's randomBytes —
 * present in Node ≥19 and provided on React Native via the standard polyfill).
 */
export * from './errors';
export * from './bytes';
export * from './version';
export * from './envelope';
export * from './pairing';
export * from './replay';
export * from './wire';
