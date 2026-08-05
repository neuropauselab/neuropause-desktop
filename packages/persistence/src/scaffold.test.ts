import { describe, it, expect } from 'vitest';
import { PERSISTENCE_VERSION, createPgliteDriver } from './index';

describe('@neuropause/persistence scaffold', () => {
  it('runs real embedded Postgres (PGlite) under the test runner', async () => {
    expect(PERSISTENCE_VERSION).toContain('preview');
    const db = await createPgliteDriver(); // in-memory
    await db.exec('CREATE TABLE probe (id int primary key, v text)');
    await db.query('INSERT INTO probe (id, v) VALUES ($1, $2)', [1, 'ok']);
    const res = await db.query<{ v: string }>('SELECT v FROM probe WHERE id = $1', [1]);
    expect(res.rows[0]?.v).toBe('ok');
    // real transaction rollback
    await db
      .transaction(async (tx) => {
        await tx.query('INSERT INTO probe (id, v) VALUES ($1, $2)', [2, 'x']);
        throw new Error('rollback');
      })
      .catch(() => undefined);
    const count = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM probe');
    expect(count.rows[0]?.n).toBe(1); // the rolled-back insert did not persist
    await db.close();
  });
});
