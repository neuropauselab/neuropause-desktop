/**
 * Persistence composition root (NCEA 12.0). `createPersistenceLayer({ driver })`
 * assembles the ONE durable storage layer over a single SqlDriver: migrations,
 * the per-service repositories, the append-only event store, object storage,
 * cache, backup/recovery, and the tenant registry. `migrate()` brings the schema
 * to the latest version. There is one driver, one event store, one set of
 * repositories — no duplicate storage systems. Bytes go to the blob store, hot
 * data to the cache, everything else to Postgres; the driver is the source of truth.
 */
import { systemClock, type Clock } from '@neuropause/cloud-core';
import { PERSISTENCE_VERSION } from './constants';
import type { SqlDriver } from './driver';
import { MigrationRunner } from './migrations';
import { SCHEMA } from './schema';
import { createRepositories, type RepositorySet } from './repositories';
import { EventStore } from './eventStore';
import { ObjectStorage, type BlobStore, type BlobMetadata } from './objectStore';
import { TableRepository } from './repository';
import { InMemoryCache, type Cache } from './cache';
import { BackupManager } from './backup';
import { TenantRegistry } from './tenancy';

export interface PersistenceLayerOptions {
  driver: SqlDriver;
  clock?: Clock;
  blobStore?: BlobStore;
  cache?: Cache;
}

export interface PersistenceLayer {
  version: string;
  driver(): SqlDriver;
  migrations(): MigrationRunner;
  /** Apply the canonical schema to the latest version; returns versions applied. */
  migrate(): Promise<number[]>;
  repositories(): RepositorySet;
  events(): EventStore;
  objects(): ObjectStorage;
  cache(): Cache;
  backup(): BackupManager;
  tenants(): TenantRegistry;
}

export function createPersistenceLayer(options: PersistenceLayerOptions): PersistenceLayer {
  const clock = options.clock ?? systemClock;
  const driver = options.driver;
  const runner = new MigrationRunner(driver, clock);
  const repositories = createRepositories(driver, clock);
  const events = new EventStore(driver, clock);
  const cache = options.cache ?? new InMemoryCache(clock);
  const backup = new BackupManager(driver, clock);
  const tenants = new TenantRegistry(driver, clock);
  const objects = options.blobStore
    ? new ObjectStorage(options.blobStore, new TableRepository<BlobMetadata>(driver, 'blob_metadata', clock), clock)
    : undefined;

  return {
    version: PERSISTENCE_VERSION,
    driver: () => driver,
    migrations: () => runner,
    migrate: () => runner.up(SCHEMA),
    repositories: () => repositories,
    events: () => events,
    objects: () => {
      if (!objects) throw new Error('object storage is not configured (pass a blobStore)');
      return objects;
    },
    cache: () => cache,
    backup: () => backup,
    tenants: () => tenants,
  };
}
