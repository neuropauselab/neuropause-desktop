/**
 * @neuropause/persistence — the Enterprise Persistence Platform (NCEA 12.0).
 *
 * The ONE durable storage layer that converts NeuroPause from an in-memory
 * platform into one that survives restart, crash, upgrade, backup, restore, and
 * failover. A single SqlDriver seam (validated against real embedded Postgres;
 * networked PostgreSQL in production) backs per-service repositories, an
 * append-only event store, object storage (bytes out of Postgres), a cache
 * (never the system of record), versioned + reversible migrations, backup &
 * recovery, and tenant-isolated multi-tenancy.
 *
 * STATUS: PREVIEW foundation. The relational engine, schema, migrations,
 * transactions, optimistic concurrency, event replay, backup/restore round-trip,
 * and restart-durability are VERIFIED here against PGlite (embedded Postgres).
 * Networked Postgres, Redis, S3 object storage, cluster PITR/failover, and
 * RLS-under-roles are production drivers/procedures behind these interfaces and
 * are NOT exercised in-container.
 */
export * from './constants';
export * from './driver';
export * from './pglite-driver';
export * from './migrations';
export * from './schema';
export * from './repository';
export * from './repositories';
export * from './eventStore';
export * from './objectStore';
export * from './cache';
export * from './backup';
export * from './tenancy';
export * from './platform';
