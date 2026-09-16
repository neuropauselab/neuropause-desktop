import { describe, expect, it } from 'vitest';
import {
  MigrationEngine,
  shouldRelaunchAfterMigration,
  type MigrationDefinition,
  type MigrationEngineDeps,
} from './migrationEngine';

function makeDeps(overrides: Partial<MigrationEngineDeps> = {}): {
  deps: MigrationEngineDeps;
  state: { version: number; applied: string[]; backups: number; restores: number };
} {
  const state = { version: 0, applied: [] as string[], backups: 0, restores: 0 };
  const deps: MigrationEngineDeps = {
    getCurrentVersion: async () => state.version,
    setCurrentVersion: async (v) => {
      state.version = v;
    },
    definitions: [],
    backup: async () => {
      state.backups += 1;
      return `backup-${state.backups}`;
    },
    restore: async () => {
      state.restores += 1;
    },
    context: { dataDir: '/tmp', log: () => undefined },
    now: () => 1_000,
    ...overrides,
  };
  return { deps, state };
}

const def = (id: string, toVersion: number, up: () => void): MigrationDefinition => ({
  id,
  domain: 'configuration',
  toVersion,
  up,
});

describe('MigrationEngine', () => {
  it('reports up-to-date status when no migration is pending', async () => {
    const { deps } = makeDeps({ definitions: [], getCurrentVersion: async () => 1 });
    const status = await new MigrationEngine(deps).status();
    expect(status).toMatchObject({ currentVersion: 1, targetVersion: 0, pending: 0, upToDate: true });
  });

  it('runs pending migrations in ascending version order and stamps the version', async () => {
    const order: string[] = [];
    const { deps, state } = makeDeps({
      definitions: [
        def('c', 3, () => order.push('c')),
        def('a', 1, () => order.push('a')),
        def('b', 2, () => order.push('b')),
      ],
    });
    const report = await new MigrationEngine(deps).run();
    expect(order).toEqual(['a', 'b', 'c']);
    expect(report.ok).toBe(true);
    expect(report.fromVersion).toBe(0);
    expect(report.toVersion).toBe(3);
    expect(state.version).toBe(3);
    expect(report.steps.map((s) => s.status)).toEqual(['applied', 'applied', 'applied']);
  });

  it('takes exactly one backup before running', async () => {
    const { deps, state } = makeDeps({ definitions: [def('a', 1, () => undefined), def('b', 2, () => undefined)] });
    await new MigrationEngine(deps).run();
    expect(state.backups).toBe(1);
  });

  it('does not execute or back up on a dry run', async () => {
    let ran = false;
    const { deps, state } = makeDeps({ definitions: [def('a', 1, () => (ran = true))] });
    const report = await new MigrationEngine(deps).run({ dryRun: true });
    expect(ran).toBe(false);
    expect(state.backups).toBe(0);
    expect(state.version).toBe(0);
    expect(report.steps[0].status).toBe('pending');
  });

  it('restores the backup and reverts the version when a step fails', async () => {
    const { deps, state } = makeDeps({
      definitions: [
        def('a', 1, () => undefined),
        def('b', 2, () => {
          throw new Error('boom');
        }),
        def('c', 3, () => undefined),
      ],
    });
    const report = await new MigrationEngine(deps).run();
    expect(report.ok).toBe(false);
    expect(report.recovered).toBe(true);
    expect(state.restores).toBe(1);
    expect(state.version).toBe(0); // reverted to the pre-migration version
    const statuses = report.steps.map((s) => s.status);
    expect(statuses).toEqual(['applied', 'failed', 'rolledBack']);
  });

  it('only considers migrations newer than the current version', async () => {
    const ran: string[] = [];
    const { deps } = makeDeps({
      getCurrentVersion: async () => 2,
      definitions: [
        def('old', 1, () => ran.push('old')),
        def('current', 2, () => ran.push('current')),
        def('new', 3, () => ran.push('new')),
      ],
    });
    await new MigrationEngine(deps).run();
    expect(ran).toEqual(['new']);
  });
});

describe('shouldRelaunchAfterMigration (Gate 11 — migrations run after stores load)', () => {
  it('an UPGRADE that transformed data relaunches so stores reload migrated bytes', async () => {
    // v1 → v2, one transforming step applied.
    const { deps } = makeDeps({
      getCurrentVersion: async () => 1,
      definitions: [def('0002', 2, () => undefined)],
    });
    const report = await new MigrationEngine(deps).run();
    expect(report.ok).toBe(true);
    expect(report.fromVersion).toBe(1);
    expect(shouldRelaunchAfterMigration(report)).toBe(true);
  });

  it('a FRESH install (fromVersion 0) does NOT relaunch on first boot', async () => {
    // No prior version: stamps baseline + 0002, but there is no already-loaded
    // data of consequence to be staled — a first-boot restart would be noise.
    const { deps } = makeDeps({
      getCurrentVersion: async () => 0,
      definitions: [def('0001', 1, () => undefined), def('0002', 2, () => undefined)],
    });
    const report = await new MigrationEngine(deps).run();
    expect(report.fromVersion).toBe(0);
    expect(shouldRelaunchAfterMigration(report)).toBe(false);
  });

  it('a no-op boot (already up to date) does not relaunch', async () => {
    const { deps } = makeDeps({ getCurrentVersion: async () => 2, definitions: [def('0002', 2, () => undefined)] });
    const report = await new MigrationEngine(deps).run();
    expect(report.steps).toHaveLength(0);
    expect(shouldRelaunchAfterMigration(report)).toBe(false);
  });

  it('a baseline-only stamp (toVersion 1) does not relaunch — nothing was transformed', async () => {
    const { deps } = makeDeps({ getCurrentVersion: async () => 0, definitions: [def('0001', 1, () => undefined)] });
    const report = await new MigrationEngine(deps).run();
    expect(shouldRelaunchAfterMigration(report)).toBe(false);
  });

  it('a FAILED (recovered) migration never relaunches — the data was restored', async () => {
    const { deps } = makeDeps({
      getCurrentVersion: async () => 1,
      definitions: [
        def('0002', 2, () => {
          throw new Error('boom');
        }),
      ],
    });
    const report = await new MigrationEngine(deps).run();
    expect(report.ok).toBe(false);
    expect(shouldRelaunchAfterMigration(report)).toBe(false);
  });
});
