/**
 * DR drill executed against REAL embedded Postgres. The persistence BackupManager
 * (Phase 12, already VERIFIED for backup/restore) is adapted to the operations
 * `BackupTarget`, and the DR orchestrator runs a genuine backup → DELETE → restore
 * → validate cycle over a real SQL engine. This is the honest, executed DR claim;
 * cluster PITR / cross-region failover remain INFRA-PENDING.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ManualClock, sha256Hex } from '@neuropause/cloud-core';
import { createPgliteDriver, type PgliteDriver, MigrationRunner, SCHEMA, BackupManager, TableRepository, TenantRegistry, type BackupBundle, type Entity } from '@neuropause/persistence';
import { DisasterRecovery, type BackupTarget } from './dr';

interface Ws extends Entity {
  id: string;
  name: string;
}

describe('Disaster Recovery against real embedded Postgres (Phase 5, VERIFIED)', () => {
  let db: PgliteDriver;
  const clock = new ManualClock(100);
  let repo: TableRepository<Ws>;

  beforeAll(async () => {
    db = await createPgliteDriver();
    await new MigrationRunner(db, clock).up(SCHEMA);
    repo = new TableRepository<Ws>(db, 'workspaces', clock);
    await new TenantRegistry(db, clock).create('acme', 'Acme');
  });
  afterAll(async () => {
    await db.close();
  });

  it('snapshots, wipes a real table, restores, and validates recovery', async () => {
    await repo.upsert('acme', { id: 'w1', name: 'Core' });
    await repo.upsert('acme', { id: 'w2', name: 'Research' });

    const backup = new BackupManager(db, clock);
    const target: BackupTarget<BackupBundle> = {
      backup: () => backup.full(),
      restore: async (b) => {
        await backup.restore(b);
      },
      verify: (b) => backup.verify(b),
      fingerprint: async () => {
        const r = await db.query<{ id: string; doc: unknown }>('SELECT id, doc FROM workspaces WHERE tenant_id = $1 ORDER BY id', ['acme']);
        return sha256Hex(JSON.stringify(r.rows));
      },
    };

    const dr = new DisasterRecovery(target, clock, { rpoMs: 60_000, rtoMs: 60_000 });
    const snapshot = await dr.takeSnapshot();
    expect(await repo.count('acme')).toBe(2);

    const report = await dr.drill({
      simulateLoss: async () => {
        await db.exec('DELETE FROM workspaces');
      },
      snapshot,
    });

    expect(report.backupVerified).toBe(true);
    expect(report.recovered).toBe(true);
    expect(report.ok).toBe(true);
    // the real rows are back
    expect(await repo.count('acme')).toBe(2);
    expect((await repo.get('acme', 'w1'))?.value.name).toBe('Core');
    expect((await repo.get('acme', 'w2'))?.value.name).toBe('Research');
  });
});
