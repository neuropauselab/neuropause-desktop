import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { rm } from 'node:fs/promises';
import { ManualClock } from '@neuropause/cloud-core';
import { createPgliteDriver } from './pglite-driver';
import { createPersistenceLayer } from './platform';

/**
 * The core promise of Phase 12: data survives a restart. We write through the
 * persistence layer, CLOSE the database entirely, reopen the SAME on-disk data
 * directory in a fresh process-like driver, and confirm every record is still
 * there — operational rows, CKDL knowledge, and events. This is real durability
 * against a real Postgres engine, not a simulation.
 */
const DATA_DIR = '/tmp/np-persist-durability';

describe('durability — survives a full restart', () => {
  beforeAll(async () => {
    await rm(DATA_DIR, { recursive: true, force: true });
  });
  afterAll(async () => {
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  it('reopens the data directory with all data intact', async () => {
    // ── session 1: migrate + write, then close ──────────────────────────────
    const clock = new ManualClock(5000);
    const db1 = await createPgliteDriver(DATA_DIR);
    const p1 = createPersistenceLayer({ driver: db1, clock });
    await p1.migrate();
    await p1.tenants().create('acme', 'Acme Inc');
    await p1.repositories().workspaces.upsert('acme', { id: 'ws1', name: 'Core' });
    await p1.repositories().ckdlDecisions.upsert('acme', { id: 'dec1', purpose: 'Adopt Postgres', status: 'executed' });
    await p1.events().append('acme', { stream: 'runtime', type: 'lifecycle.started', topic: 'lifecycle', payload: { mode: 'test' } });
    await db1.close(); // full shutdown

    // ── session 2: reopen the SAME directory ────────────────────────────────
    const db2 = await createPgliteDriver(DATA_DIR);
    const p2 = createPersistenceLayer({ driver: db2, clock });
    expect(await p2.migrations().currentVersion()).toBeGreaterThan(0); // schema persisted
    expect((await p2.tenants().get('acme'))?.name).toBe('Acme Inc');
    expect((await p2.repositories().workspaces.get('acme', 'ws1'))?.value.name).toBe('Core');
    expect((await p2.repositories().ckdlDecisions.get('acme', 'dec1'))?.value.purpose).toBe('Adopt Postgres');
    const events = await p2.events().read('acme', { stream: 'runtime' });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('lifecycle.started');
    await db2.close();
  });
});
