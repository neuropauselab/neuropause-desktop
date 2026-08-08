/**
 * @neuropause/solution-packs — the Industry Solution Pack SDK (IP-01).
 * Pure TypeScript: manifest types + zod meta schema, pack validation, and a
 * lifecycle registry. Consumed by the desktop loader (IP-02) to layer industry
 * packs onto the certified enterprise core without touching the 104/13 lock.
 */
export * from './types';
export * from './validate';
export * from './registry';
