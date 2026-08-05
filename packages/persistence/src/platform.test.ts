import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { rm } from 'node:fs/promises';
import { ManualClock } from '@neuropause/cloud-core';
import { createPgliteDriver, type PgliteDriver } from './pglite-driver';
import { createPersistenceLayer, type PersistenceLayer } from './platform';
import { FilesystemBlobStore } from './objectStore';

const BLOB_DIR = '/tmp/np-persist-platform-blobs';

describe('createPersistenceLayer (integration)', () => {
  let db: PgliteDriver;
  let p: PersistenceLayer;
  const clock = new ManualClock(0);
  beforeAll(async () => {
    await rm(BLOB_DIR, { recursive: true, force: true });
    db = await createPgliteDriver();
    p = createPersistenceLayer({ driver: db, clock, blobStore: new FilesystemBlobStore(BLOB_DIR) });
    await p.migrate();
  });
  afterAll(async () => {
    await db.close();
    await rm(BLOB_DIR, { recursive: true, force: true });
  });

  it('wires one durable layer end-to-end across every subsystem', async () => {
    await p.tenants().create('acme', 'Acme');

    // operational + knowledge via repositories
    await p.repositories().projects.upsert('acme', { id: 'p1', name: 'Launch', workspaceId: 'ws1', status: 'active' });
    await p.repositories().ckdlEvidence.upsert('acme', { id: 'ev1', type: 'human-input', source: 'sam' });
    expect((await p.repositories().projects.list('acme', { where: [{ field: 'status', value: 'active' }] }))).toHaveLength(1);

    // events
    await p.events().append('acme', { stream: 'ckdl', type: 'ckdl.activity', topic: 'ckdl', payload: { action: 'propose' } });
    expect(await p.events().count('acme')).toBe(1);

    // object storage (bytes on disk, metadata in Postgres)
    await p.objects().put('acme', 'exports/bundle.json', new TextEncoder().encode('{}'), { kind: 'export' });
    expect(await p.objects().stat('acme', 'exports/bundle.json')).toBeDefined();

    // cache (never the system of record)
    await p.cache().set('proj:p1', { cached: true }, 1000);
    expect(await p.cache().get('proj:p1')).toEqual({ cached: true });

    // backup round-trip through the layer
    const bundle = await p.backup().full({ tenant: 'acme' });
    expect(p.backup().verify(bundle)).toBe(true);

    expect(p.version).toContain('preview');
  });

  it('exposes the full persistence API', () => {
    for (const fn of [p.driver, p.migrations, p.repositories, p.events, p.objects, p.cache, p.backup, p.tenants]) {
      expect(typeof fn).toBe('function');
    }
  });
});
