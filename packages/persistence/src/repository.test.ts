import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createPgliteDriver, type PgliteDriver } from './pglite-driver';
import { MigrationRunner } from './migrations';
import { SCHEMA } from './schema';
import { TableRepository, OptimisticConcurrencyError, type Entity } from './repository';

interface Org extends Entity {
  id: string;
  name: string;
  orgId?: string;
}

describe('TableRepository (real Postgres, ACID + optimistic concurrency)', () => {
  let db: PgliteDriver;
  const clock = new ManualClock(1000);
  let repo: TableRepository<Org>;
  beforeAll(async () => {
    db = await createPgliteDriver();
    await new MigrationRunner(db, clock).up(SCHEMA);
    repo = new TableRepository<Org>(db, 'organizations', clock);
  });
  afterAll(async () => {
    await db.close();
  });

  it('inserts and reads back with metadata', async () => {
    await repo.insert('t1', { id: 'o1', name: 'Acme' });
    const got = await repo.get('t1', 'o1');
    expect(got?.value.name).toBe('Acme');
    expect(got?.version).toBe(1);
  });

  it('upsert is idempotent — references never duplicated', async () => {
    await repo.upsert('t1', { id: 'ref', name: 'first' });
    await repo.upsert('t1', { id: 'ref', name: 'second' });
    expect((await repo.get('t1', 'ref'))?.value.name).toBe('second');
    expect((await repo.get('t1', 'ref'))?.version).toBe(2); // updated, not a new row
    const all = await repo.list('t1', { where: [{ field: 'name', value: 'second' }] });
    expect(all).toHaveLength(1);
  });

  it('enforces optimistic concurrency', async () => {
    await repo.insert('t1', { id: 'oc', name: 'v1' });
    const updated = await repo.update('t1', { id: 'oc', name: 'v2' }, 1);
    expect(updated.version).toBe(2);
    await expect(repo.update('t1', { id: 'oc', name: 'stale' }, 1)).rejects.toBeInstanceOf(OptimisticConcurrencyError);
  });

  it('rolls back a failed transaction (ACID)', async () => {
    await db
      .transaction(async (tx) => {
        const txRepo = new TableRepository<Org>(tx, 'organizations', clock);
        await txRepo.insert('t1', { id: 'rollme', name: 'x' });
        throw new Error('boom');
      })
      .catch(() => undefined);
    expect(await repo.get('t1', 'rollme')).toBeUndefined();
  });

  it('soft-deletes and isolates tenants', async () => {
    await repo.insert('t1', { id: 'del', name: 'bye' });
    expect(await repo.softDelete('t1', 'del')).toBe(true);
    expect(await repo.get('t1', 'del')).toBeUndefined();
    // tenant isolation: same id under another tenant is independent / absent
    await repo.insert('tA', { id: 'shared', name: 'A-owned' });
    expect(await repo.get('tB', 'shared')).toBeUndefined();
    expect((await repo.get('tA', 'shared'))?.value.name).toBe('A-owned');
  });
});
