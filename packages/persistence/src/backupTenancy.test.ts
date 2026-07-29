import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createPgliteDriver, type PgliteDriver } from './pglite-driver';
import { MigrationRunner } from './migrations';
import { SCHEMA } from './schema';
import { BackupManager } from './backup';
import { TableRepository, type Entity } from './repository';
import { TenantRegistry, TenantScopedRepository } from './tenancy';

interface Ws extends Entity {
  id: string;
  name: string;
}

describe('backup/recovery + multi-tenant', () => {
  let db: PgliteDriver;
  const clock = new ManualClock(100);
  let repo: TableRepository<Ws>;
  beforeAll(async () => {
    db = await createPgliteDriver();
    await new MigrationRunner(db, clock).up(SCHEMA);
    repo = new TableRepository<Ws>(db, 'workspaces', clock);
  });
  afterAll(async () => {
    await db.close();
  });

  it('round-trips a full backup: backup → wipe → restore → identical', async () => {
    await new TenantRegistry(db, clock).create('acme', 'Acme');
    await repo.upsert('acme', { id: 'w1', name: 'Core' });
    await repo.upsert('acme', { id: 'w2', name: 'Research' });
    const backup = new BackupManager(db, clock);
    const bundle = await backup.full();
    expect(backup.verify(bundle)).toBe(true);

    // wipe
    await db.exec('DELETE FROM workspaces');
    expect(await repo.count('acme')).toBe(0);

    // restore
    const result = await backup.restore(bundle);
    expect(result.rows).toBeGreaterThan(0);
    expect(await repo.count('acme')).toBe(2);
    expect((await repo.get('acme', 'w1'))?.value.name).toBe('Core');
  });

  it('rejects a tampered backup on restore (checksum)', async () => {
    const backup = new BackupManager(db, clock);
    const bundle = await backup.full();
    const tampered = { ...bundle, tables: { ...bundle.tables, workspaces: [{ tenant_id: 'x', id: 'evil', doc: {}, version: 1, created_at: 0, updated_at: 0, deleted_at: null }] } };
    await expect(backup.restore(tampered)).rejects.toThrow(/integrity check failed/);
  });

  it('produces an incremental backup of only changed rows', async () => {
    clock.set(100);
    await repo.upsert('acme', { id: 'old', name: 'old' });
    clock.set(500);
    await repo.upsert('acme', { id: 'new', name: 'new' });
    const inc = await new BackupManager(db, clock).incremental(300);
    const ids = (inc.tables.workspaces ?? []).map((r) => (r as { id: string }).id);
    expect(ids).toContain('new');
    expect(ids).not.toContain('old');
  });

  it('isolates tenants and supports tenant-scoped backup', async () => {
    const tenants = new TenantRegistry(db, clock);
    await tenants.create('globex', 'Globex');
    const acme = new TenantScopedRepository(repo, 'acme');
    const globex = new TenantScopedRepository(repo, 'globex');
    await globex.upsert({ id: 'gsecret', name: 'Globex only' });
    // cross-tenant read is impossible through the scoped repo
    expect(await acme.get('gsecret')).toBeUndefined();
    expect((await globex.get('gsecret'))?.value.name).toBe('Globex only');

    // tenant-scoped backup contains only that tenant's rows
    const backup = new BackupManager(db, clock);
    const globexBundle = await backup.full({ tenant: 'globex' });
    const wsRows = (globexBundle.tables.workspaces ?? []) as Array<{ tenant_id: string }>;
    expect(wsRows.length).toBeGreaterThan(0);
    expect(wsRows.every((r) => r.tenant_id === 'globex')).toBe(true);
  });
});
