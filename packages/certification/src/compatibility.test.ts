/**
 * Cross-package compatibility + upgrade / migration / rollback validation (NCEA
 * 16.0, Phase 6). Executed against real embedded Postgres: migrations apply, are
 * idempotent on re-run (upgrade-safe), reverse cleanly (down then forward), and a
 * backup→wipe→restore round-trip proves data-level rollback. Version consistency
 * across all platform packages is asserted. Actual recorded evidence, not claims.
 */
import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createPgliteDriver, MigrationRunner, SCHEMA, BackupManager, TableRepository, TenantRegistry, type Entity } from '@neuropause/persistence';
import { RUNTIME_VERSION } from '@neuropause/runtime';
import { AI_RUNTIME_VERSION } from '@neuropause/ai-runtime';
import { CONNECTORS_VERSION } from '@neuropause/connectors';
import { PERSISTENCE_VERSION } from '@neuropause/persistence';
import { WORKSPACE_VERSION } from '@neuropause/workspace';
import { CKDL_VERSION } from '@neuropause/ckdl';
import { SECURITY_VERSION } from '@neuropause/security';
import { OPERATIONS_VERSION } from '@neuropause/operations';
import { INTEGRATIONS_VERSION } from '@neuropause/integrations';
import { CERTIFICATION_VERSION } from './constants';

interface Ws extends Entity {
  id: string;
  name: string;
}

describe('Upgrade / migration / rollback validation (Phase 6, real Postgres)', () => {
  it('applies migrations, is idempotent on re-run, reverses cleanly, and reports no checksum drift', async () => {
    const clock = new ManualClock(0);
    const db = await createPgliteDriver();
    try {
      const runner = new MigrationRunner(db, clock);
      const applied = await runner.up(SCHEMA);
      expect(applied.length).toBe(SCHEMA.length); // all migrations applied

      expect(await runner.up(SCHEMA)).toEqual([]); // re-run is a no-op ⇒ upgrade-safe
      expect((await runner.verify(SCHEMA)).ok).toBe(true); // no checksum drift
      expect(await runner.compatible(1)).toBe(true);

      // reversibility — roll back the top three migrations, then forward again
      const rolled = await runner.down(SCHEMA, 3);
      expect(rolled.slice().sort((a, b) => a - b)).toEqual([4, 5, 6]);
      const forward = await runner.up(SCHEMA);
      expect(forward.slice().sort((a, b) => a - b)).toEqual([4, 5, 6]);
      expect((await runner.status(SCHEMA)).every((s) => s.applied && s.checksumOk)).toBe(true);
    } finally {
      await db.close();
    }
  });

  it('rolls back data via backup → wipe → restore with no loss', async () => {
    const clock = new ManualClock(0);
    const db = await createPgliteDriver();
    try {
      await new MigrationRunner(db, clock).up(SCHEMA);
      await new TenantRegistry(db, clock).create('acme', 'Acme');
      const repo = new TableRepository<Ws>(db, 'workspaces', clock);
      await repo.upsert('acme', { id: 'w1', name: 'Core' });
      await repo.upsert('acme', { id: 'w2', name: 'Research' });

      const backup = new BackupManager(db, clock);
      const bundle = await backup.full();
      expect(backup.verify(bundle)).toBe(true);

      await db.exec('DELETE FROM workspaces');
      expect(await repo.count('acme')).toBe(0);

      const result = await backup.restore(bundle);
      expect(result.rows).toBeGreaterThan(0);
      expect(await repo.count('acme')).toBe(2); // rollback restored exact state
      expect((await repo.get('acme', 'w1'))?.value.name).toBe('Core');
    } finally {
      await db.close();
    }
  });

  it('confirms one version line across every platform package (cross-package compatibility)', () => {
    const versions = [RUNTIME_VERSION, AI_RUNTIME_VERSION, CONNECTORS_VERSION, PERSISTENCE_VERSION, WORKSPACE_VERSION, CKDL_VERSION, SECURITY_VERSION, OPERATIONS_VERSION, INTEGRATIONS_VERSION, CERTIFICATION_VERSION];
    for (const v of versions) expect(v).toBe('0.0.0-preview.1');
    expect(new Set(versions).size).toBe(1); // one coherent release line
  });
});
