import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { rm } from 'node:fs/promises';
import { ManualClock } from '@neuropause/cloud-core';
import { createPgliteDriver, type PgliteDriver } from './pglite-driver';
import { MigrationRunner } from './migrations';
import { SCHEMA } from './schema';
import { EventStore } from './eventStore';
import { FilesystemBlobStore, ObjectStorage, type BlobMetadata } from './objectStore';
import { TableRepository } from './repository';
import { InMemoryCache } from './cache';

const BLOB_DIR = '/tmp/np-persist-blobs';

describe('event store · object storage · cache', () => {
  let db: PgliteDriver;
  const clock = new ManualClock(0);
  beforeAll(async () => {
    await rm(BLOB_DIR, { recursive: true, force: true });
    db = await createPgliteDriver();
    await new MigrationRunner(db, clock).up(SCHEMA);
  });
  afterAll(async () => {
    await db.close();
    await rm(BLOB_DIR, { recursive: true, force: true });
  });

  it('appends, reads from a sequence, replays, and snapshots', async () => {
    const store = new EventStore(db, clock);
    for (let i = 0; i < 5; i++) await store.append('t1', { stream: 's', type: 'evt', topic: 'x', payload: { i } });
    expect(await store.count('t1')).toBe(5);
    const first = await store.read('t1', { stream: 's', limit: 2 });
    const rest = await store.read('t1', { stream: 's', fromSeq: first[1]!.seq });
    expect(rest).toHaveLength(3);
    let replayed = 0;
    await store.replay('t1', () => void (replayed += 1), { stream: 's' });
    expect(replayed).toBe(5);
    await store.snapshot('t1', 's', first[1]!.seq, { count: 2 });
    expect((await store.loadSnapshot('t1', 's'))?.state).toEqual({ count: 2 });
  });

  it('migrates old event versions forward via an upcaster', async () => {
    const store = new EventStore(db, clock);
    await store.append('t2', { stream: 's', type: 'legacy', topic: 'x', schemaVersion: 1, payload: { old: 'v' } });
    store.registerUpcaster('legacy', (payload, from) => (from < 2 ? { renamed: payload.old } : payload));
    const [e] = await store.read('t2', { stream: 's' });
    expect(e?.payload).toEqual({ renamed: 'v' });
  });

  it('stores bytes in the blob store with metadata-only in Postgres, tenant-safe', async () => {
    const objects = new ObjectStorage(new FilesystemBlobStore(BLOB_DIR), new TableRepository<BlobMetadata>(db, 'blob_metadata', clock), clock);
    const data = new TextEncoder().encode('report bytes');
    const meta = await objects.put('t1', 'reports/q3.txt', data, { kind: 'report', contentType: 'text/plain' });
    expect(meta.size).toBe(data.byteLength);
    expect(new TextDecoder().decode(await objects.get('t1', 'reports/q3.txt'))).toBe('report bytes');
    // tenant-safe: another tenant cannot read it
    expect(await objects.get('t2', 'reports/q3.txt')).toBeUndefined();
    expect((await objects.list('t1', 'report'))).toHaveLength(1);
  });

  it('cache: ttl expiry, locks, queues, rate limiting', async () => {
    const cache = new InMemoryCache(clock);
    await cache.set('k', { v: 1 }, 100);
    expect(await cache.get('k')).toEqual({ v: 1 });
    clock.advance(101);
    expect(await cache.get('k')).toBeUndefined(); // expired

    let inside = 0;
    let maxConcurrent = 0;
    await Promise.all(
      Array.from({ length: 4 }, () =>
        cache.withLock('lock', async () => {
          inside += 1;
          maxConcurrent = Math.max(maxConcurrent, inside);
          await Promise.resolve();
          inside -= 1;
        }),
      ),
    );
    expect(maxConcurrent).toBe(1); // serialized

    await cache.enqueue('q', 'a');
    await cache.enqueue('q', 'b');
    expect(cache.queueDepth('q')).toBe(2);
    expect(await cache.dequeue('q')).toBe('a');

    const limit = () => cache.rateLimit('r', 2, 1000);
    expect((await limit()).allowed).toBe(true);
    expect((await limit()).allowed).toBe(true);
    expect((await limit()).allowed).toBe(false); // over the window limit
  });
});
