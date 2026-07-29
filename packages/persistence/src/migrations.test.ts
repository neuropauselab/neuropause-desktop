import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createPgliteDriver, type PgliteDriver } from './pglite-driver';
import { MigrationRunner, migrationChecksum, type Migration } from './migrations';
import { SCHEMA } from './schema';

describe('MigrationRunner (real embedded Postgres)', () => {
  let db: PgliteDriver;
  beforeAll(async () => {
    db = await createPgliteDriver();
  });
  afterAll(async () => {
    await db.close();
  });

  it('applies the full schema, is idempotent, and reports status', async () => {
    const runner = new MigrationRunner(db, new ManualClock(0));
    const applied = await runner.up(SCHEMA);
    expect(applied).toEqual(SCHEMA.map((m) => m.version));
    expect(await runner.up(SCHEMA)).toEqual([]); // re-run = no-op (repeatable)
    expect(await runner.currentVersion()).toBe(SCHEMA[SCHEMA.length - 1]!.version);
    const status = await runner.status(SCHEMA);
    expect(status.every((s) => s.applied && s.checksumOk)).toBe(true);
    // the tables actually exist
    const t = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'organizations'");
    expect(t.rows[0]?.n).toBe(1);
  });

  it('verifies integrity and detects checksum drift', async () => {
    const runner = new MigrationRunner(db, new ManualClock(0));
    expect((await runner.verify(SCHEMA)).ok).toBe(true);
    // simulate a migration whose definition changed after being applied
    const tampered = SCHEMA.map((m) => (m.version === 2 ? { ...m, up: m.up + ' -- changed' } : m));
    const v = await runner.verify(tampered);
    expect(v.ok).toBe(false);
    expect(v.issues[0]).toMatch(/checksum drift/);
    expect(migrationChecksum(tampered[1] as Migration)).not.toBe(migrationChecksum(SCHEMA[1] as Migration));
  });

  it('rolls back reversibly to a target version and forward again', async () => {
    const runner = new MigrationRunner(db, new ManualClock(0));
    const rolled = await runner.down(SCHEMA, 3); // undo 4,5,6
    expect(rolled).toEqual([6, 5, 4]);
    expect(await runner.currentVersion()).toBe(3);
    // the events table is gone after rollback
    const gone = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'events'");
    expect(gone.rows[0]?.n).toBe(0);
    // re-apply forward
    expect(await runner.up(SCHEMA)).toEqual([4, 5, 6]);
    const back = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'events'");
    expect(back.rows[0]?.n).toBe(1);
  });

  it('gates on a minimum compatible version', async () => {
    const runner = new MigrationRunner(db, new ManualClock(0));
    expect(await runner.compatible(6)).toBe(true);
    expect(await runner.compatible(99)).toBe(false);
  });
});
